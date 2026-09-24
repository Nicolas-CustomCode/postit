import type { Queue } from "pg-boss";
import {
  ACCOUNT_METRICS_QUEUE,
  DISPATCH_QUEUE,
  MAINTENANCE_QUEUE,
  NOTIFY_QUEUE,
  POST_METRICS_QUEUE,
  PUBLISH_DEAD_LETTER_QUEUE,
  PUBLISH_QUEUE,
  TOKEN_REFRESH_QUEUE,
} from "./queue-names";

/**
 * 3 tentativas no total (docs/09, tabela das filas): a execução original mais
 * duas repetições.
 *
 * `retryBackoff` não é detalhe: a causa mais provável de falha é a Meta recusando
 * por limite de uso, e repetir logo em seguida bateria no mesmo limite. Com a
 * espera dobrando, a tentativa seguinte cai num momento diferente.
 */
const THREE_ATTEMPTS = { retryLimit: 2, retryBackoff: true } as const;

/**
 * Todas as filas do worker, **na ordem em que precisam nascer**.
 *
 * A fila de falhas vem antes da de publicação porque o pg-boss recusa
 * `deadLetter` apontando para fila que ainda não existe.
 */
export const QUEUE_DEFINITIONS: readonly Queue[] = [
  { name: TOKEN_REFRESH_QUEUE, ...THREE_ATTEMPTS },
  { name: ACCOUNT_METRICS_QUEUE, ...THREE_ATTEMPTS },
  // Uma tentativa só (docs/09): o que sobrar hoje a faxina de amanhã pega.
  { name: MAINTENANCE_QUEUE, retryLimit: 0 },

  /*
   * Sem repetição: a próxima volta do cron, um minuto depois, já é a repetição.
   *
   * **Não** é `exclusive`. Uma varredura travada seguraria todas as seguintes até
   * expirar, e cada postagem vencida nesse meio-tempo iria para `FALHOU` por
   * atraso. Duas varreduras simultâneas já são inofensivas pela trava otimista
   * (camada 3 de idempotência).
   */
  { name: DISPATCH_QUEUE, retryLimit: 0, expireInSeconds: 120 },

  { name: PUBLISH_DEAD_LETTER_QUEUE, ...THREE_ATTEMPTS },

  {
    name: PUBLISH_QUEUE,

    /*
     * ⚠️ Camada 1 de idempotência. No pg-boss 12, o `singletonKey` **sozinho não
     * impede nada**: numa fila `standard`, duas tarefas com a mesma chave entram as
     * duas. Só as políticas criam o índice único — e a `exclusive` é a que serve:
     * uma tarefa por chave enquanto ela está criada, em retentativa ou ativa, e
     * libera depois de concluída ou falhada, que é o que o reagendamento de uma
     * `FALHOU` precisa. Provado em `boss-policy.integration.spec.ts` (item V-13).
     *
     * A política só vale na criação da fila: o pg-boss não a muda depois. Por isso
     * o `BossService` confere a política de cada fila ao subir.
     */
    policy: "exclusive",

    // 5 execuções, esperando de 1 a 15 min entre elas (docs/09, "Retentativa").
    retryLimit: 4,
    retryDelay: 60,
    retryBackoff: true,
    retryDelayMax: 900,

    /*
     * O pg-boss dá a execução por travada depois disto e **inicia outra com a
     * primeira ainda rodando** — ele só aborta o `signal`, não pode matar a
     * promessa. Um carrossel de 10 com 5 min de espera por container cabe folgado
     * em 30 min; o arrendamento da postagem segura o resto.
     */
    expireInSeconds: 1800,

    /*
     * Worker morto no meio (queda, `kill -9`) é notado em cerca de um minuto, e não
     * só quando o `expireInSeconds` vencer. O pg-boss renova o sinal sozinho
     * enquanto o tratador roda.
     */
    heartbeatSeconds: 60,

    deadLetter: PUBLISH_DEAD_LETTER_QUEUE,
  },

  { name: POST_METRICS_QUEUE, ...THREE_ATTEMPTS },
  // Uma tentativa: a tarefa manda para todos os aparelhos da pessoa, e repetir
  // reenviaria a quem já recebeu. A falha fica contada na inscrição (ADR 0017).
  { name: NOTIFY_QUEUE, retryLimit: 0 },
];
