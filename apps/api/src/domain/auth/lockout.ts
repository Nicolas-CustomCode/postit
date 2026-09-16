/**
 * Proteção contra tentativas repetidas (ADR 0013, seção 5).
 *
 * Duas camadas independentes:
 *  - CONTA, com chave no e-mail: conta senha errada e código errado;
 *  - IP: conta qualquer falha, inclusive e-mail inexistente.
 *
 * **Nunca há bloqueio permanente**: seria entregar de graça ao atacante uma
 * forma de derrubar o acesso do dono. Reincidir dentro de 24 h dobra o tempo.
 */

export type BlockType = "ACCOUNT" | "IP";

export interface LockoutConfig {
  /** Janela em que as falhas são contadas. */
  readonly windowMinutes: number;
  readonly accountAttempts: number;
  readonly accountMinutes: number;
  readonly ipAttempts: number;
  readonly ipMinutes: number;
  /** Duração quando já houve bloqueio recente. */
  readonly repeatMinutes: number;
  /** Quanto tempo atrás ainda conta como reincidência. */
  readonly repeatWindowHours: number;
}

export interface BlockDecision {
  /** 1 primeiro bloqueio, 2 reincidência — é o que a coluna `nivel` guarda. */
  readonly level: 1 | 2;
  readonly until: Date;
}

const MINUTE_MS = 60 * 1000;

/** Início da janela de contagem: falha mais antiga que isto não conta mais. */
export function windowStart(now: Date, config: LockoutConfig): Date {
  return new Date(now.getTime() - config.windowMinutes * MINUTE_MS);
}

/** A partir de quando um bloqueio anterior ainda caracteriza reincidência. */
export function repeatWindowStart(now: Date, config: LockoutConfig): Date {
  return new Date(now.getTime() - config.repeatWindowHours * 60 * MINUTE_MS);
}

export function decideBlock(input: {
  readonly type: BlockType;
  readonly failuresInWindow: number;
  readonly blockedRecently: boolean;
  readonly now: Date;
  readonly config: LockoutConfig;
}): BlockDecision | null {
  const { type, failuresInWindow, blockedRecently, now, config } = input;
  const limit = type === "ACCOUNT" ? config.accountAttempts : config.ipAttempts;
  if (failuresInWindow < limit) return null;

  const minutes = blockedRecently ? config.repeatMinutes : type === "ACCOUNT" ? config.accountMinutes : config.ipMinutes;
  return { level: blockedRecently ? 2 : 1, until: new Date(now.getTime() + minutes * MINUTE_MS) };
}

export interface StoredBlock {
  readonly until: Date;
  readonly releasedAt: Date | null;
}

/**
 * O bloqueio que está valendo agora, se houver.
 *
 * Quando mais de um está ativo, vale o que termina mais tarde: mostrar o mais
 * curto faria a pessoa voltar e bater no seguinte, o que parece defeito.
 */
export function activeBlock(blocks: readonly StoredBlock[], now: Date): StoredBlock | null {
  const active = blocks.filter((block) => block.releasedAt === null && block.until.getTime() > now.getTime());
  if (active.length === 0) return null;
  return active.reduce((longest, block) => (block.until.getTime() > longest.until.getTime() ? block : longest));
}
