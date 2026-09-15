/**
 * Política de senha (docs/11, "A senha"): 12 a 128 caracteres, sem exigência de
 * maiúscula, número ou símbolo — seguindo o NIST SP 800-63B — e diferente do e-mail.
 *
 * Mesma regra na tela, que mostra o contador ao vivo, e na API, que decide.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordProblem = "TOO_SHORT" | "TOO_LONG" | "SAME_AS_EMAIL";

export function passwordProblem(password: string, email: string): PasswordProblem | null {
  // Conta caracteres, não unidades UTF-16: um emoji é um caractere para quem digita.
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) return "TOO_SHORT";
  if (length > PASSWORD_MAX_LENGTH) return "TOO_LONG";
  if (password.trim().toLowerCase() === email.trim().toLowerCase()) return "SAME_AS_EMAIL";
  return null;
}
