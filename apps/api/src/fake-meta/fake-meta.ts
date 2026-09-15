/**
 * A Meta falsa: um servidor pequeno que imita a Graph API do Instagram nos
 * testes de tela (docs/15, "Playwright"). Testes nunca falam com a Meta real
 * (AGENTS.md, regra 23).
 *
 * Por enquanto é só o esqueleto, com a primeira chamada. Cada rota nova entra
 * junto com o código que a usa: OAuth e renovação de token no Bloco C,
 * containers e media_publish na Fase 1 — sempre com o formato de resposta e de
 * erro descrito em docs/08.
 */
import Fastify, { type FastifyInstance } from "fastify";

/** Token aceito pela Meta falsa. Não vale em lugar nenhum além dela. */
export const FAKE_META_TOKEN = "fake-meta-token";

/** Conta de testes que a Meta falsa devolve. */
export const FAKE_META_ACCOUNT = { user_id: "17841400000000001", username: "conta.de.testes" } as const;

/**
 * Recusa subir fora de NODE_ENV=test. Um servidor que aceita qualquer coisa como
 * se fosse a Meta não pode existir por engano em outro ambiente.
 */
export function assertTestEnvironment(nodeEnv: string | undefined): void {
  if (nodeEnv !== "test") {
    throw new Error(`Recusado: a Meta falsa só sobe com NODE_ENV=test (recebido: "${nodeEnv ?? ""}").`);
  }
}

export function createFakeMeta(nodeEnv: string | undefined): FastifyInstance {
  assertTestEnvironment(nodeEnv);
  const app = Fastify({ logger: false });

  // Erro de token no formato da Graph API: código 190, tipo OAuthException (docs/08).
  const invalidToken = {
    error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190, fbtrace_id: "fake-meta" },
  };

  app.get<{ Params: { version: string }; Querystring: { access_token?: string } }>(
    "/:version/me",
    async (request, reply) => {
      if (request.query.access_token !== FAKE_META_TOKEN) {
        return reply.code(400).send(invalidToken);
      }
      return { id: FAKE_META_ACCOUNT.user_id, ...FAKE_META_ACCOUNT };
    },
  );

  return app;
}
