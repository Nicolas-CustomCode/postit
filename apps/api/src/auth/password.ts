import { argon2id, hash, verify, type HashOptions } from "argon2";
import { randomBytes } from "node:crypto";
import { ARGON2ID_PARAMS } from "@repo/shared";

/**
 * Senha: guardar e conferir (ADR 0013, seção 7).
 *
 * Os parâmetros vêm de @repo/shared porque os comandos admin:* usam os mesmos.
 *
 * ⚠️ Em teste, o custo cai de propósito. São dezenas de logins por execução, e
 * o argon2 com os parâmetros de produção leva ~100 ms cada — a suíte passaria a
 * maior parte do tempo calculando hash. O que os testes verificam é o
 * comportamento; o custo real é decisão de produção.
 */
const PRODUCTION_OPTIONS: HashOptions = { type: argon2id, ...ARGON2ID_PARAMS };
const TEST_OPTIONS: HashOptions = { type: argon2id, memoryCost: 8192, timeCost: 1, parallelism: 1 };

function options(): HashOptions {
  return process.env["NODE_ENV"] === "test" ? TEST_OPTIONS : PRODUCTION_OPTIONS;
}

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, options());
}

/**
 * O hash isca.
 *
 * Quando o e-mail não existe, a senha é conferida contra ESTE hash, em vez de a
 * função devolver `false` na hora. Sem isso, a resposta para e-mail inexistente
 * volta em ~2 ms e a de senha errada em ~100 ms: a diferença diz quais e-mails
 * estão cadastrados, e nenhuma mensagem igual esconde isso.
 *
 * É de uma senha aleatória que ninguém conhece — não há como acertá-la.
 */
let decoy: Promise<string> | null = null;

function decoyHash(): Promise<string> {
  decoy ??= hash(randomBytes(32).toString("base64url"), options());
  return decoy;
}

/**
 * Aquece a isca no boot da API.
 *
 * Sem isto, a PRIMEIRA tentativa com e-mail inexistente pagaria a criação da
 * isca e sairia mais lenta que as outras — o oráculo de volta, uma vez.
 */
export async function warmPasswordVerification(): Promise<void> {
  await verify(await decoyHash(), "aquecimento").catch(() => false);
}

/**
 * `hash` nulo cobre dois casos reais: e-mail que não existe e usuário criado
 * pelo `admin:create` que ainda não definiu a senha. Os dois passam pela isca e
 * gastam o mesmo tempo.
 */
export async function verifyPassword(storedHash: string | null, plain: string): Promise<boolean> {
  if (storedHash === null) {
    await verify(await decoyHash(), plain).catch(() => false);
    return false;
  }
  // O argon2 LANÇA com hash malformado. Falhar fechado é melhor que derrubar o
  // login inteiro por causa de uma linha estragada no banco.
  return verify(storedHash, plain).catch(() => false);
}
