/**
 * Schemas de entrada das rotas de autenticação.
 *
 * O mesmo schema é usado pela API e pela Server Action do Next: com duas
 * validações separadas, elas divergem, e a divergência aparece como "o
 * formulário aceitou e a API recusou".
 *
 * `strictObject` recusa campo não previsto — um campo a mais no corpo é sinal de
 * que a tela e a API discordam, e é melhor descobrir na hora.
 *
 * A política de senha NÃO está aqui: ela mora em `passwordProblem()`, que dá o
 * motivo exato ("muito curta", "igual ao e-mail") para a tela mostrar. Aqui só
 * entra o teto de tamanho, que existe para o argon2 não virar porta de negação
 * de serviço com uma senha de 1 MB.
 */
import { z } from "zod";
import { PASSWORD_MAX_LENGTH } from "./password";

const email = z.string().trim().toLowerCase().min(1).max(320).email();
const password = z.string().min(1).max(PASSWORD_MAX_LENGTH);
/** Token opaco de 32 bytes em base64url — 43 caracteres. */
const opaqueToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
/** Código do aplicativo (6 dígitos) ou de recuperação (XXXXX-XXXXX). */
const code = z.string().trim().min(1).max(32);

export const loginSchema = z.strictObject({ email, password });
export type LoginInput = z.infer<typeof loginSchema>;

export const challengeSetupSchema = z.strictObject({ token: opaqueToken });
export type ChallengeSetupInput = z.infer<typeof challengeSetupSchema>;

export const challengeCompleteSchema = z.strictObject({ token: opaqueToken, code });
export type ChallengeCompleteInput = z.infer<typeof challengeCompleteSchema>;

export const confirmCodeSchema = z.strictObject({ code });
export type ConfirmCodeInput = z.infer<typeof confirmCodeSchema>;

/**
 * O id de sessão que vem no caminho de `POST /auth/sessions/:id/revoke`.
 *
 * Não é enfeite: a coluna é `@db.Uuid`, e um valor fora do formato faz o Prisma
 * estourar P2023 — a rota devolveria 500 no lugar de 400.
 */
export const sessionIdSchema = z.string().uuid();

export const changePasswordSchema = z.strictObject({
  currentPassword: password,
  newPassword: password,
  // Trocar a senha exige senha atual E código do aplicativo (ADR 0013, seção 7).
  code,
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

const linkPurpose = z.enum(["SIGNUP", "PASSWORD_RESET"]);

export const inspectLinkSchema = z.strictObject({ token: opaqueToken, purpose: linkPurpose });
export type InspectLinkInput = z.infer<typeof inspectLinkSchema>;

export const consumeLinkSchema = z.strictObject({ token: opaqueToken, purpose: linkPurpose, password });
export type ConsumeLinkInput = z.infer<typeof consumeLinkSchema>;

/**
 * O que a tela devolve à API depois da autorização da Meta.
 *
 * O `code` e o `state` vêm da query string do retorno, ou seja, de fora — daí
 * os tetos de tamanho. Quem confere o `state` de verdade é a API, com HMAC.
 */
export const connectAccountSchema = z.strictObject({
  code: z.string().min(1).max(512),
  state: z.string().min(1).max(512),
});
export type ConnectAccountInput = z.infer<typeof connectAccountSchema>;

/**
 * A confirmação de envio de mídia (ADR 0012).
 *
 * Só o comprovante: a chave do objeto viaja dentro dele, assinada. O teto de
 * tamanho existe porque isto vem de fora — o corpo é pequeno de propósito, e a
 * API recusa qualquer requisição acima de 1 MB (AGENTS.md, regra 10).
 */
export const confirmUploadSchema = z.strictObject({
  ticket: z.string().min(1).max(1024),
});
export type ConfirmUploadInput = z.infer<typeof confirmUploadSchema>;
