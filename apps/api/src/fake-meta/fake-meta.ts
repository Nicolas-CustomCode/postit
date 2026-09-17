/**
 * A Meta falsa: um servidor pequeno que imita a Graph API do Instagram nos
 * testes de tela (docs/15, "Playwright"). Testes nunca falam com a Meta real
 * (AGENTS.md, regra 23).
 *
 * Cada rota nova entra junto com o código que a usa: OAuth e renovação de token
 * no Bloco C, containers e media_publish na Fase 1 — sempre com o formato de
 * resposta e de erro descrito em docs/08.
 *
 * **Os códigos de autorização são o roteiro.** O código que o teste manda decide
 * qual conta volta e se a conexão dá certo: é assim que os marcos 18 e 19
 * (conta pessoal e conta não testadora) ficam testáveis sem a Meta real.
 */
import Fastify, { type FastifyInstance } from "fastify";

/** Token aceito pela Meta falsa. Não vale em lugar nenhum além dela. */
export const FAKE_META_TOKEN = "fake-meta-token";

/** Conta de testes que a Meta falsa devolve. */
export const FAKE_META_ACCOUNT = { user_id: "17841400000000001", username: "conta.de.testes" } as const;

/** Uma segunda conta, para provar que duas convivem (marco 14). */
export const FAKE_META_SECOND_ACCOUNT = { user_id: "17841400000000002", username: "outra.conta.teste" } as const;

/**
 * O que cada código de autorização provoca. O teste escolhe o roteiro pelo
 * código que manda no retorno.
 */
export const FAKE_META_CODES = {
  /** Caminho feliz: conta profissional, testadora aceita. */
  ok: "codigo-ok",
  /** A segunda conta, para o teste das duas convivendo. */
  second: "codigo-segunda-conta",
  /** Marco 18: conta pessoal — a Meta não a enxerga pelo Instagram Login. */
  personal: "codigo-conta-pessoal",
  /** Marco 19: conta que não aceitou o convite de testadora. */
  notTester: "codigo-sem-convite",
} as const;

/** Tokens de longa duração por roteiro, para o `/me` saber quem responder. */
const LONG_LIVED: Record<string, { user_id: string; username: string } | "personal" | "not-tester"> = {
  [FAKE_META_CODES.ok]: FAKE_META_ACCOUNT,
  [FAKE_META_CODES.second]: FAKE_META_SECOND_ACCOUNT,
  [FAKE_META_CODES.personal]: "personal",
  [FAKE_META_CODES.notTester]: "not-tester",
};

const TOKEN_PREFIX = "fake-long-";
const SIXTY_DAYS_IN_SECONDS = 60 * 24 * 60 * 60;

/**
 * A única URI de retorno que esta Meta falsa aceita.
 *
 * Existe para o teste poder provar o que mais dá errado na configuração real: a
 * URI que não bate com a cadastrada no painel. Quem conecta com outra recebe o
 * mesmo `code: 100` que a Meta devolve.
 */
export const FAKE_META_REDIRECT_URI = "http://localhost:3100/contas/conectar/retorno";

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

  // A troca do código chega como formulário, e o Fastify só entende JSON e texto
  // puro por padrão — sem isto ele responde 415 e o teste vê um erro que a Meta
  // de verdade nunca daria.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => done(null, body),
  );

  // Os três erros no formato da Graph API (docs/08). O código numérico é o que a
  // API traduz para a mensagem que a pessoa lê.
  const erro = (code: number, message: string, subcode?: number) => ({
    error: {
      message,
      type: "OAuthException",
      code,
      ...(subcode === undefined ? {} : { error_subcode: subcode }),
      fbtrace_id: "fake-meta",
    },
  });

  const invalidToken = erro(190, "Invalid OAuth access token.");

  /**
   * Passo 1: a tela onde a pessoa autoriza.
   *
   * Aqui ela aprova na hora e volta — é o que permite o teste de tela percorrer
   * a conexão inteira pelo navegador, sem a Meta real. O `state` volta
   * intocado, que é justamente o que a API confere do outro lado.
   */
  app.get<{ Querystring: { redirect_uri?: string; state?: string } }>(
    "/oauth/authorize",
    async (request, reply) => {
      const destino = request.query.redirect_uri;
      if (destino === undefined) return reply.code(400).send(erro(100, "Missing redirect_uri."));

      const volta = new URL(destino);
      volta.searchParams.set("code", FAKE_META_CODES.ok);
      volta.searchParams.set("state", request.query.state ?? "");

      return reply.redirect(volta.toString(), 302);
    },
  );

  /** Passo 2: o código vira token de curta duração. */
  app.post<{ Body: Record<string, string> }>("/oauth/access_token", async (request, reply) => {
    // O Fastify não decodifica form-urlencoded sozinho; o corpo chega como texto.
    const corpo = new URLSearchParams(typeof request.body === "string" ? request.body : "");
    const code = corpo.get("code") ?? "";

    /*
     * Confere a URI de retorno, porque **é a falha número 1 do mundo real**: o
     * painel da Meta acrescenta uma barra final sozinho, a URI deixa de bater
     * caractere a caractere e a troca falha com um erro que não explica nada
     * (docs/08; o docs/12 chama isso de risco da fase). Sem esta conferência
     * aqui, nenhum teste cobre esse caminho.
     */
    const redirect = corpo.get("redirect_uri") ?? "";
    if (redirect !== FAKE_META_REDIRECT_URI) {
      return reply.code(400).send(erro(100, "Invalid platform app or redirect_uri mismatch."));
    }

    if (!(code in LONG_LIVED)) return reply.code(400).send(erro(100, "Invalid authorization code."));

    // O user_id acompanha o roteiro. Devolver sempre o da primeira conta seria
    // um roteiro que mente, e o teste passaria onde a produção falharia.
    const roteiro = LONG_LIVED[code];
    const userId = typeof roteiro === "object" ? roteiro.user_id : FAKE_META_ACCOUNT.user_id;

    return { access_token: `fake-short-${code}`, user_id: userId };
  });

  /** Passo 3: curta duração vira longa duração, com 60 dias. */
  app.get<{ Querystring: { grant_type?: string; access_token?: string } }>(
    "/access_token",
    async (request, reply) => {
      const curto = request.query.access_token ?? "";
      if (request.query.grant_type !== "ig_exchange_token" || !curto.startsWith("fake-short-")) {
        return reply.code(400).send(invalidToken);
      }

      return {
        access_token: TOKEN_PREFIX + curto.slice("fake-short-".length),
        token_type: "bearer",
        expires_in: SIXTY_DAYS_IN_SECONDS,
      };
    },
  );

  /** Passo 4: renovação, que devolve outros 60 dias a contar de agora. */
  app.get<{ Querystring: { grant_type?: string; access_token?: string } }>(
    "/refresh_access_token",
    async (request, reply) => {
      const token = request.query.access_token ?? "";
      if (request.query.grant_type !== "ig_refresh_token" || !token.startsWith(TOKEN_PREFIX)) {
        return reply.code(400).send(invalidToken);
      }

      return { access_token: token, token_type: "bearer", expires_in: SIXTY_DAYS_IN_SECONDS };
    },
  );

  app.get<{ Params: { version: string }; Querystring: { access_token?: string } }>(
    "/:version/me",
    async (request, reply) => {
      const token = request.query.access_token ?? "";

      // O token fixo continua servindo ao teste que só quer uma leitura simples.
      if (token === FAKE_META_TOKEN) return { id: FAKE_META_ACCOUNT.user_id, ...FAKE_META_ACCOUNT };
      if (!token.startsWith(TOKEN_PREFIX)) return reply.code(400).send(invalidToken);

      const roteiro = LONG_LIVED[token.slice(TOKEN_PREFIX.length)];
      if (roteiro === undefined) return reply.code(400).send(invalidToken);

      // Conta pessoal: a Meta responde "objeto não existe ou você não pode vê-lo".
      if (roteiro === "personal") return reply.code(400).send(erro(100, "Unsupported get request.", 33));
      // Convite de testadora não aceito: o app não alcança a conta.
      if (roteiro === "not-tester") return reply.code(400).send(invalidToken);

      return {
        id: roteiro.user_id,
        user_id: roteiro.user_id,
        username: roteiro.username,
        name: roteiro.username,
        account_type: "BUSINESS",
        followers_count: 42,
        follows_count: 7,
        media_count: 3,
      };
    },
  );

  return app;
}
