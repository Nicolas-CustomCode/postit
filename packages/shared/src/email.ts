/**
 * O e-mail é chave em três lugares que precisam concordar: o login, o bloqueio
 * por conta (docs/adr/0013) e os comandos admin:*. Se um normalizar e outro não,
 * "Voce@Exemplo.com" cria um segundo balde de tentativas e fura o bloqueio.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
