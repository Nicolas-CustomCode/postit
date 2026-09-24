import type { WorkerEnv } from "../config/env";

/**
 * A configuração do push, lida uma vez no boot do worker (ADR 0017).
 *
 * `vapid: null` é **push desligado**: faltou alguma das três variáveis. O worker
 * sobe normalmente e o sino continua recebendo tudo — melhor do que derrubar a
 * publicação por causa de um aviso.
 */
export const PUSH_CONFIG = Symbol("PUSH_CONFIG");

export interface PushConfig {
  readonly vapid: { readonly publicKey: string; readonly privateKey: string; readonly subject: string } | null;
  readonly sweepMs: number;
  /** O prazo de inatividade da sessão, o mesmo da API. */
  readonly idleDays: number;
}

export function pushConfigFrom(env: WorkerEnv): PushConfig {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  return {
    vapid: publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null,
    sweepMs: env.PUSH_SWEEP_SECONDS * 1000,
    idleDays: env.SESSION_IDLE_DAYS,
  };
}
