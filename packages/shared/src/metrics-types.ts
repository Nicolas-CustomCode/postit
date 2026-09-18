/**
 * As métricas da conta, e o formato em que elas ficam guardadas (RF-G06).
 *
 * As listas são a fonte: é delas que a API monta o `metric=` da chamada à Meta,
 * e é delas que a tela de evolução (RF-G07, Fase 5) vai saber **o que pode
 * faltar**. Uma lista só, nos dois lados, para não desencontrarem.
 *
 * ⚠️ **Os nomes são os que a Meta usa**, e não os do nosso vocabulário. É a
 * exceção que o ADR 0023 já prevê para nomes vindos da API dela: `reach`,
 * `total_interactions`, `followers_count`. Traduzir aqui só criaria um
 * dicionário a mais para manter quando a Meta mudar o conjunto.
 */

/**
 * O que a conta é **hoje**: um retrato, não um histórico.
 *
 * Não dá para saber quantos seguidores a conta tinha anteontem — a Meta não
 * guarda isso. Por isso estes três entram só na linha do dia em que foram
 * lidos, e a releitura dos dias anteriores não os toca.
 */
export const ACCOUNT_PROFILE_FIELDS = ["followers_count", "follows_count", "media_count"] as const;
export type AccountProfileField = (typeof ACCOUNT_PROFILE_FIELDS)[number];

/**
 * O que aconteceu **naquele dia** (docs/08, "Insights da conta").
 *
 * ⚠️ `impressions` foi descontinuada pela Meta em 21/04/2025 — o substituto é
 * `views`. Não devolva a antiga à lista.
 */
export const ACCOUNT_INSIGHT_METRICS = [
  "reach",
  "views",
  "accounts_engaged",
  "total_interactions",
  "follows_and_unfollows",
  "profile_links_taps",
] as const;
export type AccountInsightMetric = (typeof ACCOUNT_INSIGHT_METRICS)[number];

/**
 * O conteúdo da coluna `valores` de `MetricaConta`.
 *
 * **Todo campo é opcional, e isso é a regra mais importante daqui.** Métrica que
 * a Meta não forneceu fica **ausente**, nunca zero: a Meta devolve conjunto
 * vazio para o que não existe, e contas com menos de 100 seguidores não têm
 * algumas delas. A tela precisa dizer "indisponível", que é coisa diferente de
 * "aconteceu zero vez" (RF-G07).
 *
 * `Partial` em vez de convenção escrita num comentário: assim quem for ler um
 * valor é obrigado pelo compilador a tratar a ausência.
 */
export interface AccountMetricValues {
  readonly profile?: Partial<Record<AccountProfileField, number>>;
  readonly insights?: Partial<Record<AccountInsightMetric, number>>;
}
