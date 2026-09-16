/**
 * As telas que exigem sessão.
 *
 * ⚠️ Esta lista serve ao `proxy.ts`, que decide **navegação**, não acesso: ele
 * olha se o cookie existe, e cookie presente pode estar revogado. A proteção de
 * verdade é o `requireSession()` de cada página e de cada Server Action
 * (AGENTS.md, regra 5).
 *
 * Fica fora do `proxy.ts` porque o service worker vai usar a mesma lista para
 * manter estas telas fora do cache do aparelho — duas cópias divergiriam, e o
 * sintoma seria dado pessoal gravado no celular.
 */
const PROTECTED_PREFIXES = ["/perfil", "/c/", "/contas", "/acervo", "/saude", "/notificacoes", "/admin"];

export function requiresSession(pathname: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}
