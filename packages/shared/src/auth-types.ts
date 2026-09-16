/**
 * O que a API devolve nas rotas de autenticação.
 *
 * Datas viajam como texto ISO: o que atravessa a fronteira é JSON, e um `Date`
 * do Prisma vira string no caminho de qualquer jeito — melhor declarar.
 *
 * Nada aqui espelha tabela: a resposta nunca usa tipo gerado pelo Prisma
 * (AGENTS.md, regra 6), senão senhaHash e tokenHash vazam para a tela no dia em
 * que alguém devolver o registro inteiro.
 */
import type { Permission } from "./domain";

/** Quem está logado, do ponto de vista da tela. */
export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly superAdmin: boolean;
  /** Permissões efetivas: super admin chega aqui com todas. */
  readonly permissions: readonly Permission[];
}

/** Finalidade do desafio criado quando a senha está certa. */
export const CHALLENGE_PURPOSES = ["SETUP_2FA", "VERIFY_2FA"] as const;
export type ChallengePurpose = (typeof CHALLENGE_PURPOSES)[number];

/** Resposta do login: a senha certa dá um desafio, nunca uma sessão. */
export interface ChallengeStarted {
  readonly token: string;
  readonly expiresAt: string;
  readonly purpose: ChallengePurpose;
}

/** O que a tela mostra no primeiro acesso para a pessoa cadastrar o aplicativo. */
export interface TwoFactorSetup {
  /** Link otpauth://, para quem cadastra no mesmo aparelho e não pode ler o QR. */
  readonly otpauthUrl: string;
  /** O QR como imagem PNG embutida (data:), que a CSP já libera. */
  readonly qrDataUrl: string;
}

/** Sessão recém-criada. O cookie é gravado pelo Next; a API não toca em cookie. */
export interface SessionIssued {
  readonly token: string;
  readonly expiresAt: string;
  readonly user: SessionUser;
  /** Só no primeiro acesso, e só uma vez na vida: os 10 códigos de recuperação. */
  readonly recoveryCodes?: readonly string[];
}

/** O que o requireSession() do Next lê a cada requisição. */
export interface SessionInfo {
  readonly user: SessionUser;
  readonly session: {
    readonly createdAt: string;
    readonly expiresAt: string;
    readonly verifiedAt: string;
    /** Código digitado há menos de RECENT_CONFIRMATION_MINUTES (ADR 0015). */
    readonly recentlyConfirmed: boolean;
  };
}

/** Uma linha da tela de sessões ativas, no perfil. */
export interface ActiveSession {
  readonly id: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  /** A sessão deste aparelho, que o botão "sair dos outros" preserva. */
  readonly current: boolean;
}

/** Dono do link de cadastro ou de redefinição, para a tela dizer de quem é. */
export interface AccessLinkInfo {
  readonly email: string;
  readonly name: string;
  readonly purpose: AccessLinkPurpose;
  readonly expiresAt: string;
}

export const ACCESS_LINK_PURPOSES = ["SIGNUP", "PASSWORD_RESET"] as const;
export type AccessLinkPurpose = (typeof ACCESS_LINK_PURPOSES)[number];
