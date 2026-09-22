/**
 * Os tempos do motor de publicação (docs/09).
 *
 * Injetados por token, como as outras configs: os testes rodam o publicador com
 * esperas de milissegundos, sem relógio falso — o `pg` trava com timers falsos.
 */
export const PUBLISHING_CONFIG = Symbol("PUBLISHING_CONFIG");

export interface PublishingConfig {
  /** Entre duas consultas do estado de um container. A Meta pede uma por minuto (docs/08). */
  readonly statusPollIntervalMs: number;
  /** Quanto esperar a Meta se decidir antes de conferir um publish sem resposta (docs/09). */
  readonly reconcileWaitMs: number;
  /**
   * Quanto dura o arrendamento a cada renovação. Precisa cobrir, com folga, a mais
   * longa das esperas entre duas renovações: o publish (40 s), a espera da
   * reconciliação mais a consulta, ou um intervalo de polling.
   */
  readonly leaseMs: number;
  /**
   * Só nos testes de tela: varre também a cada tantos segundos, para o e2e não
   * esperar a volta do cron de um minuto. Nulo em qualquer outro ambiente.
   */
  readonly dispatchTickMs: number | null;
}

export const DEFAULT_PUBLISHING_CONFIG: PublishingConfig = {
  statusPollIntervalMs: 60_000,
  reconcileWaitMs: 30_000,
  leaseMs: 180_000,
  dispatchTickMs: null,
};
