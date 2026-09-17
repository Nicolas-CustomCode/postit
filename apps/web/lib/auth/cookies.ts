/**
 * Os cookies de sessão e de desafio, decididos num lugar só.
 *
 * ⚠️ **A pergunta é "este app é servido por https?", e NÃO "estamos em
 * produção?"** (ADR 0013, seção 4). As duas divergem exatamente no caso que
 * usamos todo dia: o build de produção rodando local por http. Decidindo por
 * NODE_ENV, o cookie sai com `Secure`, o navegador o descarta, e o sintoma não
 * aponta para lugar nenhum — o login grava a sessão no banco, redireciona, e a
 * requisição seguinte chega sem cookie.
 *
 * Sem `import "server-only"` de propósito: o `proxy.ts` também lê o nome do
 * cookie, e ele não pode importar módulos marcados como só de servidor. Três
 * cópias da mesma regra é como elas passam a discordar em silêncio.
 */

const SECURE = (process.env.APP_URL ?? "").startsWith("https://");

/**
 * O prefixo `__Host-` é uma trava do navegador: ele só aceita o cookie com
 * Secure, Path=/ e sem Domain. Por isso ele não pode ser fixo — em http, o
 * cookie simplesmente não seria guardado.
 */
export const SESSION_COOKIE = SECURE ? "__Host-sessao" : "sessao";
export const CHALLENGE_COOKIE = SECURE ? "__Host-desafio" : "desafio";
/**
 * A última conta usada. Diferente dos outros, ele **não autoriza nada**: só
 * decide em que conta o sistema abre (docs/13, "Conta ativa"). Quem manda na
 * conta ativa é o endereço da página.
 */
export const LAST_ACCOUNT_COOKIE = SECURE ? "__Host-ultima-conta" : "ultima-conta";

export interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  maxAge?: number;
  expires?: Date;
}

/**
 * `sameSite: "lax"` e nunca `strict`: com `strict`, quem chega ao site vindo de
 * outro endereço chega sem cookie — e é exatamente o caso do retorno do OAuth do
 * Instagram (ADR 0013).
 *
 * `maxAge` sai da expiração que a API devolveu, nunca de uma constante daqui:
 * duas fontes para a mesma duração é como o cookie sobrevive à sessão.
 */
export function cookieOptions(expiresAt: Date): CookieOptions {
  return {
    httpOnly: true,
    secure: SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)),
  };
}

/** Para apagar: mesmo nome, mesmo caminho, validade no passado. */
export const EXPIRED_COOKIE: CookieOptions = {
  httpOnly: true,
  secure: SECURE,
  sameSite: "lax",
  path: "/",
  maxAge: 0,
};
