/**
 * Converter entre horário civil e instante, num fuso IANA (ADR 0006).
 *
 * **O único lugar do projeto que faz o caminho de volta.** `Intl` converte
 * instante → relógio, e não oferece o contrário; métricas e agendamento
 * precisam dos dois, e duas implementações divergiriam no dia da transição —
 * que é o único dia em que isso importa.
 *
 * Regra pura: sem Nest, sem Prisma, sem rede.
 *
 * ⚠️ **Por que não basta chutar e corrigir.** A forma óbvia — tratar o relógio
 * como se fosse UTC, medir o deslocamento ali e descontar, repetindo — é uma
 * iteração de ponto fixo. Ela converge, e por isso engana: **devolve um
 * instante com cara de resposta boa mesmo quando o relógio pedido não existe**,
 * e na hora repetida escolhe uma ocorrência conforme a aritmética cair. Medido:
 * a mesma implementação devolve a primeira ocorrência em Nova York e a segunda
 * em Lisboa.
 *
 * O que funciona é **cercar e conferir**: gerar os dois instantes possíveis e
 * perguntar a cada um se ele mostra o relógio pedido. Aí os três desfechos —
 * nenhum, um, dois — saem de uma regra só, em vez de três ramos escritos à mão.
 */

/** Um dia civil, como `2026-09-15`. */
export type DayLabel = string;
/** Um relógio de parede, como `18:30`. Sem segundos: é o que o campo entrega. */
export type TimeLabel = string;

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 86_400_000;

export interface ZonedCivil {
  /**
   * Os instantes em que aquele relógio acontece naquele fuso, em ordem.
   *
   * Vazio quando o relógio pulou a hora; dois quando ela aconteceu duas vezes.
   * O ADR 0006 manda ficar com a **primeira**, e é o que `[0]` já é.
   */
  readonly instants: readonly Date[];
  /**
   * Só faz sentido quando `instants` é vazio: o instante em que aquele relógio
   * voltaria a existir. É o que a meia-noite de um dia que começa às 01:00 quer.
   */
  readonly afterGap: Date;
}

/**
 * Quanto aquele fuso está adiantado em relação ao UTC, naquele instante.
 *
 * Positivo a leste de Greenwich. Sai de ler o relógio no fuso e interpretá-lo de
 * volta como se fosse UTC: a diferença é o deslocamento.
 */
export function zoneOffsetMs(instant: Date, timeZone: string): number {
  return civilAsUtc(instant, timeZone) - instant.getTime();
}

/**
 * O relógio daquele fuso, lido **como se fosse UTC**.
 *
 * É a moeda comum deste arquivo: permite comparar um relógio pedido com um
 * relógio obtido sem montar e desmontar texto.
 */
export function civilAsUtc(instant: Date, timeZone: string): number {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(instant)
      .map((parte) => [parte.type, parte.value]),
  ) as Record<string, string>;

  return Date.UTC(
    Number(partes["year"]),
    Number(partes["month"]) - 1,
    Number(partes["day"]),
    // `hour12: false` devolve 24 para a meia-noite em alguns ambientes, e
    // Date.UTC trataria isso como o dia seguinte.
    Number(partes["hour"]) % 24,
    Number(partes["minute"]),
    Number(partes["second"]),
  );
}

/**
 * Quando aquele relógio acontece naquele fuso.
 *
 * O coração do arquivo. Dois candidatos, tirados dos deslocamentos de **um dia
 * antes e um dia depois**, e cada um conferido de volta.
 *
 * ⚠️ **Um dia de cada lado não é chute, é cerco.** O instante verdadeiro é
 * `relógio − deslocamento`, e deslocamento IANA vive entre −12 h e +14 h: o
 * alvo está necessariamente dentro de ±24 h. Como nenhum fuso tem duas
 * transições no mesmo dia, o deslocamento certo é forçosamente um dos dois
 * medidos. Medir no próprio alvo — que é o que a forma ingênua faz — cai do lado
 * errado da transição e devolve a segunda ocorrência.
 */
export function possibleInstants(day: DayLabel, time: TimeLabel, timeZone: string): ZonedCivil {
  const alvo = civilTarget(day, time);

  const antes = zoneOffsetMs(new Date(alvo - DAY_MS), timeZone);
  const depois = zoneOffsetMs(new Date(alvo + DAY_MS), timeZone);

  const candidatos = [...new Set([alvo - antes, alvo - depois])].sort((a, b) => a - b);
  // Um candidato só é real se, lido de volta no fuso, mostra o relógio pedido.
  const validos = candidatos.filter((instante) => civilAsUtc(new Date(instante), timeZone) === alvo);

  return {
    instants: validos.map((instante) => new Date(instante)),
    // No buraco, o maior candidato é o instante em que o relógio volta a andar:
    // é ele que a meia-noite de um dia que começa às 01:00 procura.
    afterGap: new Date(candidatos[candidatos.length - 1] ?? alvo),
  };
}

/**
 * O relógio pedido, como número, com o rótulo validado.
 *
 * ⚠️ **`Date.UTC` não recusa 31 de fevereiro** — normaliza para março, em
 * silêncio. Sem esta conferência, a validação da volta aprovaria o dia
 * normalizado e a pessoa agendaria para um dia que não pediu.
 */
function civilTarget(day: DayLabel, time: TimeLabel): number {
  assertDayLabel(day);
  assertTimeLabel(time);

  const [ano, mes, dia] = day.split("-").map(Number) as [number, number, number];
  const [hora, minuto] = time.split(":").map(Number) as [number, number];

  const alvo = Date.UTC(ano, mes - 1, dia, hora, minuto);
  const conferencia = new Date(alvo);

  if (
    conferencia.getUTCFullYear() !== ano ||
    conferencia.getUTCMonth() !== mes - 1 ||
    conferencia.getUTCDate() !== dia
  ) {
    throw new Error(`Dia civil que não existe no calendário: "${day}"`);
  }

  return alvo;
}

/** O dia e a hora daquele instante, naquele fuso — para preencher os campos. */
export function civilFieldsIn(instant: Date, timeZone: string): { day: DayLabel; time: TimeLabel } {
  const comoUtc = new Date(civilAsUtc(instant, timeZone));
  return {
    day: comoUtc.toISOString().slice(0, 10),
    time: comoUtc.toISOString().slice(11, 16),
  };
}

export function isDayLabel(value: string): boolean {
  return DAY_PATTERN.test(value);
}

export function assertDayLabel(day: string): void {
  if (!DAY_PATTERN.test(day)) throw new Error(`Dia civil em formato inesperado: "${day}"`);
}

function assertTimeLabel(time: string): void {
  if (!TIME_PATTERN.test(time)) throw new Error(`Hora em formato inesperado: "${time}"`);
}
