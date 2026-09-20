import {
  dayFromDatabase,
  dayLabel,
  dayToDatabase,
  daysBefore,
  daysBetween,
  dayWindow,
  nextDay,
} from "./day-window";

/**
 * O dia civil da conta e os limites dele (docs/08, "Métricas da conta").
 *
 * Regras puras: rodam sem banco e sem rede. Os casos de fuso são os que o
 * docs/09 lista como obrigatórios — transição de horário de verão, e contas em
 * fusos diferentes.
 */
describe("dia civil da conta", () => {
  const SP = "America/Sao_Paulo";
  const TOKYO = "Asia/Tokyo";
  const NY = "America/New_York";

  describe("dayLabel — o dia de um instante, no fuso da conta", () => {
    it("usa o fuso da conta, não o do processo", () => {
      // 02:00 UTC do dia 16 ainda é dia 15 em São Paulo (UTC-3), e já é dia 16
      // em Tóquio (UTC+9). O mesmo instante, dois dias diferentes.
      const instante = new Date("2026-09-16T02:00:00.000Z");

      expect(dayLabel(instante, SP)).toBe("2026-09-15");
      expect(dayLabel(instante, TOKYO)).toBe("2026-09-16");
    });

    it("faz a volta: o começo de um dia rotula aquele mesmo dia", () => {
      for (const fuso of [SP, TOKYO, NY]) {
        const { since } = dayWindow("2026-09-15", fuso);
        expect(dayLabel(new Date(since * 1000), fuso)).toBe("2026-09-15");
      }
    });
  });

  describe("dayWindow — os limites do dia", () => {
    const horas = ({ since, until }: { since: number; until: number }) => (until - since) / 3600;

    it("um dia comum tem 24 horas, e começa às 03:00 UTC em São Paulo", () => {
      const janela = dayWindow("2026-09-15", SP);

      expect(new Date(janela.since * 1000).toISOString()).toBe("2026-09-15T03:00:00.000Z");
      expect(horas(janela)).toBe(24);
    });

    it("num fuso a leste, o dia começa no dia anterior em UTC", () => {
      const janela = dayWindow("2026-09-15", TOKYO);

      expect(new Date(janela.since * 1000).toISOString()).toBe("2026-09-14T15:00:00.000Z");
      expect(horas(janela)).toBe(24);
    });

    /*
     * Os dois casos que matam a implementação ingênua. Quem calcula o fim como
     * `since + 86400` erra uma hora nesses dois dias por ano — e erra em
     * silêncio, gravando no dia errado (ADR 0006).
     */
    it("o dia que entra no horário de verão tem 23 horas", () => {
      expect(horas(dayWindow("2026-03-08", NY))).toBe(23);
    });

    it("o dia que sai do horário de verão tem 25 horas", () => {
      expect(horas(dayWindow("2026-11-01", NY))).toBe(25);
    });

    it("dias seguidos se encostam, sem buraco nem sobreposição", () => {
      // Inclui a virada do horário de verão: é onde um buraco apareceria.
      for (const dia of ["2026-03-07", "2026-03-08", "2026-10-31", "2026-11-01"]) {
        expect(dayWindow(dia, NY).until).toBe(dayWindow(nextDay(dia), NY).since);
      }
    });

    /*
     * ⚠️ O caso que o teste acima NÃO pega: Santiago muda o relógio à
     * meia-noite, e o dia 6 de setembro de 2026 começa às 01:00 local. A
     * implementação antiga devolvia 23:00 do dia 5 — a janela inteira uma hora
     * deslocada —, e "dias seguidos se encostam" continuava passando porque os
     * dois lados erravam juntos. Corrigido em 20/09/2026, com `possibleInstants`.
     */
    it("num dia que começa às 01:00, a janela começa às 01:00", () => {
      const SANTIAGO = "America/Santiago";
      const janela = dayWindow("2026-09-06", SANTIAGO);

      expect(new Date(janela.since * 1000).toISOString()).toBe("2026-09-06T04:00:00.000Z");
      // E o dia encurta: 23 horas, não 24.
      expect(horas(janela)).toBe(23);
    });

    it("recusa rótulo fora do formato, em vez de inventar uma data", () => {
      expect(() => dayWindow("15/09/2026", SP)).toThrow();
      expect(() => dayWindow("2026-9-5", SP)).toThrow();
    });
  });

  describe("aritmética de dias", () => {
    it("atravessa a virada do mês e do ano", () => {
      expect(nextDay("2026-09-30")).toBe("2026-10-01");
      expect(nextDay("2026-12-31")).toBe("2027-01-01");
      expect(daysBefore("2026-03-01", 1)).toBe("2026-02-28");
    });

    it("daysBetween inclui os dois extremos", () => {
      expect(daysBetween("2026-09-13", "2026-09-15")).toEqual(["2026-09-13", "2026-09-14", "2026-09-15"]);
      expect(daysBetween("2026-09-15", "2026-09-15")).toEqual(["2026-09-15"]);
    });

    // Uma conta criada hoje pede retroativo que termina antes de começar. Sem
    // este caso, o laço rodaria para sempre em vez de devolver nada.
    it("daysBetween devolve vazio quando o começo é depois do fim", () => {
      expect(daysBetween("2026-09-16", "2026-09-15")).toEqual([]);
    });
  });

  /*
   * A borda do Prisma. A coluna é `@db.Date`, e o Prisma serializa um Date JS
   * pela parte de data EM UTC — então um Date montado no fuso local gravaria o
   * dia anterior. Estes testes são a única defesa contra isso.
   */
  describe("conversão para o banco", () => {
    it("grava sempre meia-noite UTC", () => {
      expect(dayToDatabase("2026-09-15").toISOString()).toBe("2026-09-15T00:00:00.000Z");
    });

    it("faz a volta sem perder o dia", () => {
      expect(dayFromDatabase(dayToDatabase("2026-09-15"))).toBe("2026-09-15");
    });
  });
});

/**
 * O mesmo, com o relógio do processo em fusos opostos.
 *
 * Sem isto, um erro de fuso passa nesta máquina — que está em Brasília — e
 * aparece só na CI, que roda em UTC. `Pacific/Kiritimati` é UTC+14, o extremo
 * oposto: se alguma conta acidental usar o fuso do processo, um dos dois quebra.
 */
describe("o fuso do processo não influencia o resultado", () => {
  const original = process.env.TZ;
  afterAll(() => {
    process.env.TZ = original;
  });

  for (const fusoDoProcesso of ["America/Sao_Paulo", "Pacific/Kiritimati", "UTC"]) {
    it(`com TZ=${fusoDoProcesso}`, () => {
      process.env.TZ = fusoDoProcesso;

      expect(dayToDatabase("2026-09-15").toISOString()).toBe("2026-09-15T00:00:00.000Z");
      expect(new Date(dayWindow("2026-09-15", "America/Sao_Paulo").since * 1000).toISOString()).toBe(
        "2026-09-15T03:00:00.000Z",
      );
      expect(dayLabel(new Date("2026-09-16T02:00:00.000Z"), "America/Sao_Paulo")).toBe("2026-09-15");
    });
  }
});
