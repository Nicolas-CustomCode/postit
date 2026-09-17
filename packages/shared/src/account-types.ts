/**
 * O que a API devolve sobre as contas do Instagram.
 *
 * ⚠️ **O token não está aqui, e nunca vai estar.** É esta fronteira que impede o
 * `tokenCifrado` de chegar à tela no dia em que alguém devolver o registro
 * inteiro do Prisma (AGENTS.md, regra 6; docs/07, "Regra de fronteira").
 *
 * Datas como texto ISO: o que atravessa a fronteira é JSON.
 */
import type { SocialNetwork } from "./domain";

/** Por que uma conta precisa de atenção — a tela mostra o aviso pelo código. */
export const ACCOUNT_WARNINGS = ["TOKEN_EXPIRING", "TOKEN_EXPIRED"] as const;
export type AccountWarning = (typeof ACCOUNT_WARNINGS)[number];

export interface AccountSummary {
  readonly id: string;
  readonly network: SocialNetwork;
  /** O @ do Instagram. É ele que aparece no endereço das telas da conta. */
  readonly username: string;
  readonly name: string | null;
  /**
   * Endereço público da foto, já no nosso armazenamento. A tela nunca carrega
   * imagem dos servidores da Meta — a CSP bloquearia (docs/adr/0014).
   */
  readonly photoUrl: string | null;
  /** Identificador IANA, nunca deslocamento fixo (ADR 0006). */
  readonly timezone: string;
  readonly tokenExpiresAt: string;
  /**
   * Quantos dias faltam para o acesso vencer, já arredondado para baixo. Vem
   * pronto da API porque calcular data durante a renderização é impuro — e
   * porque o relógio que importa é o do servidor, o mesmo que decide o aviso.
   */
  readonly tokenExpiresInDays: number;
  /** Vazio quando está tudo bem; a tela decide como mostrar. */
  readonly warning: AccountWarning | null;
}

/**
 * A partir de quantos dias para vencer a conta aparece marcada no seletor.
 *
 * Sete dias é o mesmo limite do alerta de token em risco (RF-A04): antes disso,
 * a renovação automática ainda tem várias chances de acontecer sozinha.
 */
export const TOKEN_WARNING_DAYS = 7;
