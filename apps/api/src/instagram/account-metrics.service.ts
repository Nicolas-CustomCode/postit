import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import {
  ACCOUNT_INSIGHT_METRICS,
  type AccountInsightMetric,
  type AccountMetricValues,
} from "@repo/shared";
import { decryptSecret } from "../common/crypto";
import {
  dayFromDatabase,
  dayLabel,
  dayToDatabase,
  daysBefore,
  daysBetween,
  dayWindow,
  type DayLabel,
} from "../domain/metrics/day-window";
import { PrismaService } from "../prisma/prisma.service";
import { InstagramClient, MetaRefusedError } from "./client";
import { INSTAGRAM_CONFIG, type InstagramConfig } from "./instagram.config";
import { InstagramProfileService } from "./profile.service";

/**
 * A coleta diária das métricas da conta (RF-G06; docs/09,
 * "coletar-metricas-conta-instagram").
 *
 * **Por que existe antes de qualquer tela:** a Meta guarda só **90 dias**. Cada
 * dia sem coletar é histórico que se perde para sempre. A tela vem na Fase 5;
 * os dados precisam começar a ser guardados antes.
 *
 * **Por que uma chamada por dia.** O docs/08 pede `metric_type=total_value`, e
 * isso devolve **um número agregado da janela inteira**, não uma série. Das seis
 * métricas, só `reach` existe em série temporal — as outras cinco só existem em
 * `total_value` ([IG User Insights][1]). Como a tabela quer uma linha por dia, o
 * único caminho é pedir um dia de cada vez. São 3 chamadas por conta por dia na
 * rotina.
 *
 * Mora no `InstagramModule`, e não em `publishing/`, porque o comando
 * `admin:collect-metrics` chama o mesmo método e o CLI não pode importar
 * publicação nem filas (AGENTS.md, regra 1).
 *
 * [1]: https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights
 */

/** A Meta pode atrasar os números em até 48 h, então a janela relida é de 3 dias. */
const OVERLAP_DAYS = 3;

/**
 * A janela que a coleta enxerga para trás.
 *
 * A Meta guarda *"up to 90 days"*, então 90 seria o teto — mas cada dia custa
 * uma chamada, e 90 numa execução só arriscaria o prazo da tarefa. Trinta traz
 * um mês de histórico para uma conta recém-conectada e ainda dá quase três
 * semanas de margem para completar uma lacuna antes de a Meta descartar o dado
 * (item V-19 do docs/08).
 */
const BACKFILL_DAYS = 30;

export interface MetricsCollectionOutcome {
  readonly accounts: number;
  /** Linhas de dia gravadas ou atualizadas. */
  readonly days: number;
  /** Contas que falharam de um jeito que vale repetir. */
  readonly recoverable: number;
  readonly fatal: number;
}

@Injectable()
export class InstagramAccountMetricsService {
  private readonly logger = new Logger("Instagram");

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: InstagramClient,
    private readonly profiles: InstagramProfileService,
    @Inject(INSTAGRAM_CONFIG) private readonly config: InstagramConfig,
  ) {}

  /**
   * Coleta o que falta de cada conta conectada.
   *
   * **Não lança**, devolve o que aconteceu — quem decide repetir é o tratador da
   * fila, que conhece o contrato do pg-boss. E falha de coleta **nunca vira
   * alarme** (docs/09): o dado é secundário, e a sobreposição de 3 dias cobre um
   * dia perdido sozinha.
   */
  async collectDue(now: Date): Promise<MetricsCollectionOutcome> {
    const contas = await this.prisma.db.account.findMany({
      where: {
        active: true,
        network: "INSTAGRAM",
        // Token morto só produziria recusa 190 todo dia, para sempre.
        tokenExpiresAt: { gt: now },
      },
      select: {
        id: true,
        externalId: true,
        username: true,
        timezone: true,
        tokenEncrypted: true,
      },
      orderBy: { username: "asc" },
    });

    const resultado = { accounts: contas.length, days: 0, recoverable: 0, fatal: 0 };

    for (const conta of contas) {
      const parcial = await this.collectAccount(conta, now);
      resultado.days += parcial.days;
      if (parcial.failure === "recoverable") resultado.recoverable += 1;
      else if (parcial.failure === "fatal") resultado.fatal += 1;
    }

    this.logger.log(
      `Métricas de conta: ${resultado.accounts} contas, ${resultado.days} dias gravados, ` +
        `${resultado.recoverable} a repetir, ${resultado.fatal} sem recuperação.`,
    );

    return resultado;
  }

  private async collectAccount(
    conta: AccountToCollect,
    now: Date,
  ): Promise<{ days: number; failure: "recoverable" | "fatal" | null }> {
    let token: string;
    try {
      token = decryptSecret(conta.tokenEncrypted, this.config.encryptionKey, "instagram-token");
    } catch {
      this.logger.error(`O token guardado da conta ${conta.username} não pôde ser lido.`);
      return { days: 0, failure: "fatal" };
    }

    const hoje = dayLabel(now, conta.timezone);
    const pendentes = await this.pendingDays(conta, hoje);
    if (pendentes.length === 0) return { days: 0, failure: null };

    // O perfil é um retrato de agora: vale só para a linha de hoje. Uma leitura
    // por conta, não uma por dia.
    const perfil = await this.readProfile(token, conta.username);

    let gravados = 0;
    for (const dia of pendentes) {
      let insights: Partial<Record<AccountInsightMetric, number>>;
      try {
        insights = await this.readInsights(conta, token, dia);
      } catch (error) {
        /*
         * Aborta esta conta na primeira recusa, em vez de insistir nos dias que
         * faltam. Se a causa for limite de uso — o motivo mais provável quando o
         * retroativo dispara 30 dias de uma vez —, continuar só afundaria mais.
         * Os dias já gravados ficam: a execução seguinte cobre o resto, porque
         * ela procura lacunas.
         */
        this.logger.warn(
          `Parei a coleta de ${conta.username} no dia ${dia}: ${error instanceof Error ? error.name : "desconhecido"}`,
        );
        return { days: gravados, failure: isRecoverable(error) ? "recoverable" : "fatal" };
      }

      const valores: AccountMetricValues = {
        insights,
        ...(dia === hoje && perfil !== null ? { profile: perfil } : {}),
      };

      // Grava dia a dia, e não tudo no fim: assim o progresso sobrevive a uma
      // repetição da tarefa no meio do caminho.
      await this.save(conta.id, dia, valores, now);
      gravados += 1;
    }

    return { days: gravados, failure: null };
  }

  /**
   * Quais dias ainda faltam.
   *
   * ⚠️ **Procura lacunas na janela inteira**, e não "a conta já tem alguma
   * linha". Se o retroativo parar no meio — limite de uso, Meta fora do ar —, o
   * critério ingênuo veria linhas existindo, voltaria para os 3 dias da
   * sobreposição e **os dias do meio sumiriam para sempre** depois de 90 dias.
   * É exatamente o que esta tabela existe para impedir.
   *
   * **O limite é o que a Meta guarda, não quando a conta foi conectada.** Ela
   * mantém 90 dias de métricas da conta independentemente do nosso app, então o
   * retroativo de uma conta conectada hoje traz dados reais de antes da conexão
   * — é exatamente para isso que ele existe. Parar em `criadoEm` jogaria fora o
   * histórico que a Meta ainda tem.
   */
  private async pendingDays(conta: AccountToCollect, hoje: DayLabel): Promise<DayLabel[]> {
    const inicio = daysBefore(hoje, BACKFILL_DAYS - 1);
    const janela = daysBetween(inicio, hoje);

    const existentes = new Set(
      (
        await this.prisma.db.accountMetric.findMany({
          where: { accountId: conta.id, day: { gte: dayToDatabase(inicio) } },
          select: { day: true },
        })
      ).map((linha) => dayFromDatabase(linha.day)),
    );

    /*
     * Duas razões para um dia entrar, e é a combinação que faz a coisa toda
     * funcionar sem um "modo primeira coleta" à parte:
     *
     * - está na **sobreposição** dos últimos 3 dias → sempre relido, porque a
     *   Meta ainda pode mexer nos números (até 48 h de atraso);
     * - **falta** na janela → seja porque a conta é nova (30 dias de uma vez),
     *   seja porque uma coleta anterior parou no meio.
     *
     * Na rotina isso dá 3 dias: os 27 mais antigos já existem e são filtrados.
     */
    const sobreposicao = new Set(daysBetween(daysBefore(hoje, OVERLAP_DAYS - 1), hoje));
    return janela.filter((dia) => sobreposicao.has(dia) || !existentes.has(dia));
  }

  /** O perfil não é essencial: sem ele a linha do dia sai só com os insights. */
  private async readProfile(
    token: string,
    username: string,
  ): Promise<AccountMetricValues["profile"] | null> {
    try {
      const perfil = await this.profiles.read(token, "uso");
      return semNulos({
        followers_count: perfil.followersCount,
        follows_count: perfil.followsCount,
        media_count: perfil.mediaCount,
      });
    } catch {
      this.logger.warn(`Não li o perfil de ${username}; a coleta segue só com os insights.`);
      return null;
    }
  }

  /**
   * Os insights de um dia.
   *
   * Tenta as seis métricas juntas e, se a Meta recusar com `code: 100`, refaz
   * **uma por uma**. A documentação dela diz que métrica indisponível volta como
   * conjunto vazio, não como erro — mas o docs/08 registra que ela se contradiz,
   * e que campo inexistente derruba a chamada inteira com esse mesmo código.
   * Contas com menos de 100 seguidores não têm algumas destas métricas, então
   * **este caminho provavelmente é o normal**, não a exceção.
   *
   * ⚠️ O código numérico é lido do `MetaRefusedError` **antes** de traduzir:
   * `translateRefusal` devolve um erro de usuário e descarta o número. Traduzir
   * primeiro também faria a mensagem "reconecte a conta" aparecer por causa de
   * uma métrica que a conta não tem — mandando reconectar uma conta perfeita.
   */
  private async readInsights(
    conta: AccountToCollect,
    token: string,
    dia: DayLabel,
  ): Promise<Partial<Record<AccountInsightMetric, number>>> {
    try {
      return await this.fetchInsights(conta, token, dia, ACCOUNT_INSIGHT_METRICS);
    } catch (error) {
      if (!(error instanceof MetaRefusedError) || error.meta.code !== 100) throw error;

      this.logger.log(`A Meta recusou as métricas juntas de ${conta.username} em ${dia}; tentando uma a uma.`);

      const parcial: Partial<Record<AccountInsightMetric, number>> = {};
      for (const metrica of ACCOUNT_INSIGHT_METRICS) {
        try {
          Object.assign(parcial, await this.fetchInsights(conta, token, dia, [metrica]));
        } catch (individual) {
          // Recusa da métrica sozinha = a conta não a tem. Fica ausente, que é o
          // que a tela precisa para dizer "indisponível" em vez de "zero".
          if (individual instanceof MetaRefusedError && individual.meta.code === 100) continue;
          throw individual;
        }
      }
      return parcial;
    }
  }

  private async fetchInsights(
    conta: AccountToCollect,
    token: string,
    dia: DayLabel,
    metricas: readonly AccountInsightMetric[],
  ): Promise<Partial<Record<AccountInsightMetric, number>>> {
    const { since, until } = dayWindow(dia, conta.timezone);

    const resposta = await this.client.get<InsightsResponse>(`/${conta.externalId}/insights`, token, {
      metric: metricas.join(","),
      period: "day",
      metric_type: "total_value",
      since: String(since),
      until: String(until),
    });

    return readInsightValues(resposta);
  }

  /**
   * Grava a linha do dia, **mesclando** com o que já estava lá.
   *
   * O `||` do `jsonb` faz merge raso de um nível: gravar `{insights}` preserva o
   * `profile` que foi lido no dia certo, e vice-versa. É um statement só — ler,
   * mesclar em JavaScript e escrever seria três idas ao banco, e o cron das 6h
   * com o comando manual rodando junto perderia uma das escritas.
   *
   * O `id` vai explícito porque a coluna não tem `DEFAULT` no banco: o `uuid(7)`
   * do Prisma é gerado no cliente, e este INSERT não passa por ele.
   */
  private async save(accountId: string, dia: DayLabel, valores: AccountMetricValues, now: Date): Promise<void> {
    await this.prisma.db.$executeRaw`
      INSERT INTO "MetricaConta" ("id", "contaId", "dia", "valores", "coletadoEm")
      VALUES (${randomUUID()}::uuid, ${accountId}::uuid, ${dayToDatabase(dia)}::date,
              ${JSON.stringify(valores)}::jsonb, ${now})
      ON CONFLICT ("contaId", "dia") DO UPDATE
      SET "valores" = "MetricaConta"."valores" || EXCLUDED."valores",
          "coletadoEm" = EXCLUDED."coletadoEm"
    `;
  }
}

interface AccountToCollect {
  readonly id: string;
  /** O id que a Meta usa para esta conta — é ele que vai no caminho de insights. */
  readonly externalId: string;
  readonly username: string;
  readonly timezone: string;
  readonly tokenEncrypted: string;
}

interface InsightsResponse {
  readonly data?: readonly {
    readonly name?: string;
    readonly total_value?: { readonly value?: number };
  }[];
}

/**
 * Lê os escalares da resposta, e só eles.
 *
 * **Métrica sem `total_value.value` não vira chave.** Algumas voltam só com
 * `breakdowns`, e `follows_and_unfollows` costuma ser uma delas. Deixar
 * `undefined` entrar no objeto funcionaria por acidente — o `JSON.stringify`
 * descarta —, mas aqui é explícito: ausente é ausente, zero é zero, e a tela
 * precisa distinguir os dois (RF-G07).
 */
function readInsightValues(resposta: InsightsResponse): Partial<Record<AccountInsightMetric, number>> {
  const valores: Partial<Record<AccountInsightMetric, number>> = {};

  for (const item of resposta.data ?? []) {
    const nome = item.name;
    const valor = item.total_value?.value;
    if (nome === undefined || typeof valor !== "number") continue;
    if (!(ACCOUNT_INSIGHT_METRICS as readonly string[]).includes(nome)) continue;

    valores[nome as AccountInsightMetric] = valor;
  }

  return valores;
}

/** Descarta o que veio nulo: a coluna guarda ausência como chave que não existe. */
function semNulos(campos: Record<string, number | null>): Record<string, number> {
  return Object.fromEntries(Object.entries(campos).filter(([, valor]) => valor !== null)) as Record<
    string,
    number
  >;
}

/** Só rede e indisponibilidade valem repetir; recusa da Meta não melhora sozinha. */
function isRecoverable(error: unknown): boolean {
  return !(error instanceof MetaRefusedError);
}
