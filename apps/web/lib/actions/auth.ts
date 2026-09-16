"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  challengeCompleteSchema,
  consumeLinkSchema,
  loginSchema,
  safeRedirect,
  type AccessLinkPurpose,
  type ChallengeStarted,
  type SessionIssued,
  type TwoFactorSetup,
} from "@repo/shared";
import { apiFetch } from "../api/client";
import { CHALLENGE_COOKIE, cookieOptions, EXPIRED_COOKIE, SESSION_COOKIE } from "../auth/cookies";
import { failure, success, type ActionResult } from "./result";

/**
 * As escritas da autenticação. Toda escrita no Next é Server Action — nunca
 * route handler POST (AGENTS.md, regra 13).
 *
 * ⚠️ Server Action é um endpoint POST público: ela não pode contar com o
 * `proxy.ts` ter rodado. A validação e a conferência de sessão são de cada
 * action, sempre.
 *
 * ⚠️ `redirect()` LANÇA por dentro — é assim que o Next interrompe a ação. Por
 * isso ele fica sempre FORA de try/catch: dentro, o catch engoliria o desvio e a
 * tela ficaria parada.
 */

/** Passo 1: e-mail e senha. Não cria sessão — cria o desafio. */
export async function loginAction(_previous: unknown, form: FormData): Promise<ActionResult<never>> {
  const entrada = loginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  // O formulário e a API usam o mesmo schema, então isto só pega campo vazio.
  if (!entrada.success) return { ok: false, code: "VALIDATION_FAILED", message: "Preencha e-mail e senha" };

  let challenge: ChallengeStarted;
  try {
    challenge = await apiFetch<ChallengeStarted>({ method: "POST", path: "/auth/login", body: entrada.data });
  } catch (error) {
    return failure(error);
  }

  const jar = await cookies();
  jar.set(CHALLENGE_COOKIE, challenge.token, cookieOptions(new Date(challenge.expiresAt)));

  const voltar = safeRedirect(form.get("voltar")?.toString());
  const destino = challenge.purpose === "SETUP_2FA" ? "/entrar/cadastro" : "/entrar/codigo";
  redirect(`${destino}?voltar=${encodeURIComponent(voltar)}`);
}

/**
 * Prepara o cadastro das duas etapas e devolve o QR.
 *
 * É uma ação, e não parte da renderização da página: pedir isto durante o GET
 * faria uma tela desenhar e, de quebra, gravar segredo no banco — e o Next
 * re-renderiza a página depois de cada Server Action, o que derrubaria a tela
 * dos códigos de recuperação assim que o desafio fosse consumido.
 */
export async function startTotpSetupAction(): Promise<ActionResult<TwoFactorSetup>> {
  const token = (await cookies()).get(CHALLENGE_COOKIE)?.value;
  if (token === undefined) return { ok: false, code: "CHALLENGE_INVALID", message: "Este acesso expirou. Entre de novo" };

  try {
    return success(await apiFetch<TwoFactorSetup>({ method: "POST", path: "/auth/challenge/totp-setup", body: { token } }));
  } catch (error) {
    return failure(error);
  }
}

/**
 * Passo 2: o código de 6 dígitos (ou um de recuperação). É aqui que a sessão
 * nasce e o cookie é gravado.
 *
 * Devolve os códigos de recuperação quando é o primeiro acesso — eles existem
 * uma única vez, e a tela os mostra em seguida.
 */
export async function verifyCodeAction(
  _previous: unknown,
  form: FormData,
): Promise<ActionResult<{ recoveryCodes?: readonly string[]; voltar: string }>> {
  const jar = await cookies();
  const token = jar.get(CHALLENGE_COOKIE)?.value;
  if (token === undefined) return { ok: false, code: "CHALLENGE_INVALID", message: "Este acesso expirou. Entre de novo" };

  const entrada = challengeCompleteSchema.safeParse({ token, code: form.get("code") });
  if (!entrada.success) return { ok: false, code: "INVALID_CODE", message: "Digite o código" };

  try {
    const sessao = await apiFetch<SessionIssued>({
      method: "POST",
      path: "/auth/challenge/verify",
      body: entrada.data,
    });

    jar.set(SESSION_COOKIE, sessao.token, cookieOptions(new Date(sessao.expiresAt)));
    // O desafio acabou de ser consumido; deixar o cookie seria guardar lixo.
    jar.set(CHALLENGE_COOKIE, "", EXPIRED_COOKIE);

    return success({
      recoveryCodes: sessao.recoveryCodes,
      voltar: safeRedirect(form.get("voltar")?.toString()),
    });
  } catch (error) {
    return failure(error);
  }
}

/** Define a senha pelo link de cadastro ou de redefinição. Não cria sessão. */
export async function consumeLinkAction(
  purpose: AccessLinkPurpose,
  token: string,
  _previous: unknown,
  form: FormData,
): Promise<ActionResult<never>> {
  const senha = form.get("password")?.toString() ?? "";
  if (senha !== (form.get("confirmation")?.toString() ?? "")) {
    return { ok: false, code: "VALIDATION_FAILED", message: "As duas senhas não são iguais" };
  }

  const entrada = consumeLinkSchema.safeParse({ token, purpose, password: senha });
  if (!entrada.success) return { ok: false, code: "ACCESS_LINK_INVALID", message: "Este link não vale mais" };

  try {
    await apiFetch({ method: "POST", path: "/auth/links/consume", body: entrada.data });
  } catch (error) {
    return failure(error);
  }

  // Sem sessão de brinde: a pessoa entra pelo login e passa pelas duas etapas.
  redirect("/entrar?definida=1");
}

/** Sair. O cookie é apagado mesmo se a API falhar — ficar preso é pior. */
export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;

  try {
    if (token !== undefined) await apiFetch({ method: "POST", path: "/auth/logout", token });
  } catch (error) {
    // Sair da tela sem revogar a sessão no servidor é pior do que parece: o
    // cookie some daqui e o token continua valendo. O erro vai para o log do
    // servidor, e o teste de tela confere que a sessão realmente morreu.
    console.error("Falha ao encerrar a sessão na API", error);
  }

  jar.set(SESSION_COOKIE, "", EXPIRED_COOKIE);
  redirect("/entrar");
}
