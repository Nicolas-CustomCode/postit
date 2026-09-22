/**
 * As filas do projeto e seus agendamentos (docs/09, "As filas").
 *
 * Os nomes são em português porque são dado no banco, não identificador de
 * código — mesma regra das tabelas (ADR 0023). Quem os lê no painel de saúde é
 * uma pessoa, não o compilador.
 *
 * ⚠️ Mudar um nome depois de rodar em produção deixa órfãs as tarefas já
 * gravadas com o nome antigo. Nome de fila é contrato com o banco.
 */

/** Renova o token de quem já passou de 30 dias (docs/09, "renovar-tokens-instagram"). */
export const TOKEN_REFRESH_QUEUE = "renovar-tokens-instagram";

/**
 * Cron **em UTC** — o pg-boss usa UTC quando nenhum fuso é informado, e é isso
 * que queremos (ADR 0006). Não passe `tz`.
 *
 * 3h UTC é meia-noite em Brasília: fora de qualquer janela de publicação, e
 * nenhuma conta depende do horário em que o token foi renovado.
 */
export const TOKEN_REFRESH_CRON = "0 3 * * *";

/** Coleta as métricas de cada conta, relendo os últimos 3 dias (docs/09). */
export const ACCOUNT_METRICS_QUEUE = "coletar-metricas-conta-instagram";

/**
 * 6h UTC, três horas depois da renovação de token: as duas tarefas diárias não
 * disputam a mesma janela nem a mesma cota da Meta.
 *
 * O horário é em UTC, mas o **dia** que cada linha representa é o da conta, no
 * fuso dela — quem decide isso é o `domain/metrics/day-window.ts`, não o cron.
 */
export const ACCOUNT_METRICS_CRON = "0 6 * * *";

/** Varre as postagens vencidas e entrega cada uma ao publicador (docs/09, "O despachante"). */
export const DISPATCH_QUEUE = "despachar";

/**
 * A cada minuto, em UTC. O pg-boss confere os agendamentos a cada 30 segundos,
 * então a varredura roda mais ou menos uma vez por minuto — e olha um minuto
 * adiante para compensar (docs/09).
 */
export const DISPATCH_CRON = "* * * * *";

/** Cria os containers e publica uma postagem (docs/09, "O publicador"). */
export const PUBLISH_QUEUE = "publicar-instagram";

/**
 * Para onde o pg-boss move a tarefa de publicação que esgotou as tentativas: o
 * tratador marca `FALHOU` e avisa (docs/09, "O que acontece ao esgotar").
 */
export const PUBLISH_DEAD_LETTER_QUEUE = "publicar-instagram-falhas";

/**
 * As leituras de métrica de uma publicação, com início atrasado (docs/09,
 * "Coleta de métricas"). O publicador cria as tarefas desde a 1d; quem as
 * consome chega na Fase 5.
 */
export const POST_METRICS_QUEUE = "coletar-metricas-instagram";

/** Envia o push de uma notificação aos aparelhos dos destinatários (ADR 0017). */
export const NOTIFY_QUEUE = "notificar";
