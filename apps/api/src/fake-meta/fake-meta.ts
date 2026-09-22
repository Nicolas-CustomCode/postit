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
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";

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
 * O token de longa duração da conta de testes, como sai do passo 3.
 *
 * Existe exportado para o teste da renovação poder gravar uma conta já
 * conectada, sem percorrer o OAuth inteiro só para chegar a um token válido.
 */
export const FAKE_META_LONG_TOKEN = TOKEN_PREFIX + FAKE_META_CODES.ok;

/**
 * Um PNG de 1 pixel, servido no lugar do CDN da Meta.
 *
 * A foto de perfil não vem da Graph API: vem de um endereço assinado, que a API
 * baixa sem token nenhum e copia para o MinIO (docs/08). Sem esta rota, o teste
 * da conexão pararia antes de provar que `fotoChaveObjeto` foi gravado.
 */
/*
 * ⚠️ **Em hexadecimal minúsculo, e não em base64 — de propósito.** A varredura
 * de segredos da CI procura `EAA` seguido de 60 ou mais alfanuméricos, que é o
 * formato do token de acesso da Meta. A versão base64 deste mesmo PNG contém
 * essa sequência por coincidência, e a varredura reprovava o push inteiro. Em
 * hexadecimal minúsculo não há letra maiúscula, então nenhum dos padrões
 * procurados (`EAA`, `AKIA`, `IGAA`, `sk-`) pode casar.
 *
 * A regra da CI está certa em ser rígida; quem tinha de mudar era isto aqui.
 * Vale para qualquer dado binário embutido no código daqui para frente.
 */
const ONE_PIXEL_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
    "0000000d4944415478da636460f85f0f0002870180eb47ba92000000004945" +
    "4e44ae426082",
  "hex",
);

const PHOTO_PATH = "/fake-cdn/foto.png";

/**
 * Os números que os insights devolvem. Fixos, para o teste poder afirmar.
 *
 * `profile_links_taps` não está aqui de propósito: ela é a métrica que esta
 * conta **não tem**, e precisa chegar ausente do outro lado.
 */
const FAKE_META_INSIGHT_VALUES: Record<string, number> = {
  reach: 100,
  views: 250,
  accounts_engaged: 30,
  total_interactions: 45,
};

/** Pedir esta métrica faz a chamada inteira falhar com `code: 100`. */
export const FAKE_META_BROKEN_METRIC = "derruba_tudo";

/** Um item da resposta de insights. Métrica sem escalar traz só `breakdowns`. */
interface InsightItem {
  name: string;
  period: string;
  total_value: { value?: number; breakdowns?: unknown[] };
}

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

  // Os erros no formato da Graph API (docs/08). O código numérico é o que a API
  // traduz para a mensagem que a pessoa lê.
  const erro = graphError;

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
        // Absoluta, como a Meta devolve: é um endereço de CDN, não um caminho
        // relativo à Graph API.
        profile_picture_url: `${request.protocol}://${request.host}${PHOTO_PATH}`,
        followers_count: 42,
        follows_count: 7,
        media_count: 3,
      };
    },
  );

  /** O CDN de onde a foto de perfil é baixada. Sem token, como no mundo real. */
  app.get(PHOTO_PATH, async (_request, reply) => {
    return reply.type("image/png").send(ONE_PIXEL_PNG);
  });

  /**
   * Insights da conta (docs/08, "Insights da conta").
   *
   * Três comportamentos que a coleta precisa enfrentar, e que só existem aqui
   * porque a conta real não os produz sob demanda:
   *
   * 1. **`profile_links_taps` nunca volta.** É o caso de "métrica que esta conta
   *    não tem" — contas com menos de 100 seguidores, o mais provável na conta
   *    de testes. Fica **ausente**, e é assim que o teste prova que ausente não
   *    virou zero.
   * 2. **`follows_and_unfollows` volta sem `total_value.value`.** Algumas
   *    métricas só trazem `breakdowns`, e um parser desatento gravaria
   *    `undefined` — ou pior, zero.
   * 3. **Pedir a métrica `derruba_tudo` responde `code: 100`** para a chamada
   *    inteira, que é o caminho em que a coleta cai para uma métrica por vez.
   */
  app.get<{ Params: { version: string; igId: string }; Querystring: { access_token?: string; metric?: string } }>(
    "/:version/:igId/insights",
    async (request, reply) => {
      const token = request.query.access_token ?? "";
      if (token !== FAKE_META_TOKEN && !token.startsWith(TOKEN_PREFIX)) {
        return reply.code(400).send(invalidToken);
      }

      const pedidas = (request.query.metric ?? "").split(",").filter((nome) => nome.length > 0);
      if (pedidas.length === 0) return reply.code(400).send(erro(100, "Missing metric parameter."));
      if (pedidas.includes(FAKE_META_BROKEN_METRIC)) {
        return reply.code(400).send(erro(100, "Unsupported metric for this account."));
      }

      const dados = pedidas.flatMap((nome): InsightItem[] => {
        if (nome === "profile_links_taps") return [];
        // Sem escalar: só o detalhamento, como a Meta faz com algumas métricas.
        if (nome === "follows_and_unfollows") {
          return [{ name: nome, period: "day", total_value: { breakdowns: [] } }];
        }
        return [{ name: nome, period: "day", total_value: { value: FAKE_META_INSIGHT_VALUES[nome] ?? 1 } }];
      });

      return { data: dados };
    },
  );

  registerPublishing(app);

  return app;
}

// ---------------------------------------------------------------------------
// Publicação — containers, estado, media_publish e permalink (docs/08).
// ---------------------------------------------------------------------------

type ContainerStatusCode = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";

/** Uma recusa no formato da Graph API, para o teste roteirizar. */
export interface FakeRefusal {
  readonly code: number;
  readonly subcode?: number;
  /** Padrão 400. Um 5xx simula a Meta instável. */
  readonly httpStatus?: number;
  /** Para simular a Meta ecoando o que recebeu — inclusive o token. */
  readonly message?: string;
}

/**
 * Como a próxima chamada de `media_publish` termina.
 *
 * - `ok`: publica e responde
 * - `drop-after-publish`: **publica** e derruba a conexão sem responder — o caso
 *   difícil do docs/09, em que o worker não sabe se saiu
 * - `drop-before-publish`: derruba sem publicar
 */
export type FakePublishOutcome = "ok" | "drop-after-publish" | "drop-before-publish";

interface FakeContainer {
  readonly id: string;
  readonly igUserId: string;
  readonly body: Record<string, unknown>;
  /** Os estados que as consultas seguintes devolvem; o último se repete. */
  statuses: ContainerStatusCode[];
  published: boolean;
}

/**
 * O controle da publicação falsa, para os testes do Jest.
 *
 * Cada roteiro vale **para a próxima** chamada daquele tipo e depois some —
 * sem roteiro, tudo dá certo na hora, que é o que o Playwright usa.
 */
export interface FakePublishingControl {
  /** Os estados que o próximo container criado vai responder, em ordem. */
  nextContainerStatuses(statuses: ContainerStatusCode[]): void;
  /** A próxima criação de container é recusada. */
  refuseNextCreate(refusal: FakeRefusal): void;
  /** O próximo `media_publish` é recusado. */
  refuseNextPublish(refusal: FakeRefusal): void;
  /** Como o próximo `media_publish` termina. */
  nextPublish(outcome: FakePublishOutcome): void;
  /** Muda o estado de um container já criado — para simular expiração ou erro depois. */
  setContainerStatus(containerId: string, status: ContainerStatusCode): void;
  /** Os corpos das criações de container, em ordem. */
  readonly createdContainers: readonly { id: string; igUserId: string; body: Record<string, unknown> }[];
  /** Quantas vezes o `media_publish` foi chamado — inclusive as que derrubaram a conexão. */
  readonly publishCalls: number;
  /** As mídias publicadas de fato. Duas para a mesma postagem é o defeito que o projeto existe para evitar. */
  readonly publishedMedia: readonly { id: string; containerId: string }[];
  reset(): void;
}

const controls = new WeakMap<FastifyInstance, FakePublishingControl>();

/** O controle da publicação de uma Meta falsa criada por `createFakeMeta`. */
export function fakePublishing(app: FastifyInstance): FakePublishingControl {
  const control = controls.get(app);
  if (!control) throw new Error("Esta instância não foi criada por createFakeMeta.");
  return control;
}

/** Erro no formato da Graph API (docs/08), igual ao das rotas de conexão. */
function graphError(code: number, message: string, subcode?: number) {
  return {
    error: {
      message,
      type: "OAuthException",
      code,
      ...(subcode === undefined ? {} : { error_subcode: subcode }),
      fbtrace_id: "fake-meta",
    },
  };
}

function registerPublishing(app: FastifyInstance): void {
  const invalidToken = graphError(190, "Invalid OAuth access token.");
  const containers = new Map<string, FakeContainer>();
  const created: { id: string; igUserId: string; body: Record<string, unknown> }[] = [];
  const published: { id: string; containerId: string }[] = [];
  let publishCalls = 0;
  let seq = 0;

  let nextStatuses: ContainerStatusCode[] | null = null;
  let createRefusal: FakeRefusal | null = null;
  let publishRefusal: FakeRefusal | null = null;
  let publishOutcome: FakePublishOutcome = "ok";

  // Ids numéricos, como os da Meta. O prefixo separa container de mídia no teste.
  const newId = (prefix: string) => `${prefix}${String(++seq).padStart(8, "0")}`;

  controls.set(app, {
    nextContainerStatuses: (statuses) => {
      nextStatuses = [...statuses];
    },
    refuseNextCreate: (refusal) => {
      createRefusal = refusal;
    },
    refuseNextPublish: (refusal) => {
      publishRefusal = refusal;
    },
    nextPublish: (outcome) => {
      publishOutcome = outcome;
    },
    setContainerStatus: (containerId, status) => {
      const container = containers.get(containerId);
      if (!container) throw new Error(`Container ${containerId} não existe na Meta falsa.`);
      container.statuses = [status];
    },
    get createdContainers() {
      return created;
    },
    get publishCalls() {
      return publishCalls;
    },
    get publishedMedia() {
      return published;
    },
    reset: () => {
      containers.clear();
      created.length = 0;
      published.length = 0;
      publishCalls = 0;
      nextStatuses = null;
      createRefusal = null;
      publishRefusal = null;
      publishOutcome = "ok";
    },
  });

  const refuse = (reply: FastifyReply, refusal: FakeRefusal) =>
    reply.code(refusal.httpStatus ?? 400).send(graphError(refusal.code, refusal.message ?? "Recusa roteirizada pela Meta falsa.", refusal.subcode));

  // As escritas levam o token no cabeçalho, como o guia do Instagram Login.
  const bearerOk = (header: string | undefined) => {
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
    return token === FAKE_META_TOKEN || token.startsWith(TOKEN_PREFIX);
  };
  const queryOk = (token: string | undefined) =>
    token !== undefined && (token === FAKE_META_TOKEN || token.startsWith(TOKEN_PREFIX));

  const current = (container: FakeContainer): ContainerStatusCode =>
    container.published ? "PUBLISHED" : (container.statuses[0] ?? "FINISHED");

  /** Criação de container: imagem única, item de carrossel, Story ou carrossel pai. */
  app.post<{ Params: { version: string; igId: string }; Body: Record<string, unknown> }>(
    "/:version/:igId/media",
    async (request, reply) => {
      if (!bearerOk(request.headers.authorization)) return reply.code(400).send(invalidToken);

      if (createRefusal) {
        const refusal = createRefusal;
        createRefusal = null;
        return refuse(reply, refusal);
      }

      const body = request.body ?? {};
      // O carrossel pai confere os filhos, como a Meta: de 2 a 10, todos existentes.
      if (body["media_type"] === "CAROUSEL") {
        const filhos = String(body["children"] ?? "").split(",").filter((id) => id.length > 0);
        if (filhos.length < 2 || filhos.length > 10 || filhos.some((id) => !containers.has(id))) {
          return reply.code(400).send(graphError(100, "Carousels need at least 2 and no more than 10.", 2207028));
        }
      } else if (typeof body["image_url"] !== "string") {
        return reply.code(400).send(graphError(100, "Missing image_url."));
      }

      const container: FakeContainer = {
        id: newId("179"),
        igUserId: request.params.igId,
        body,
        statuses: nextStatuses ?? ["FINISHED"],
        published: false,
      };
      nextStatuses = null;
      containers.set(container.id, container);
      created.push({ id: container.id, igUserId: container.igUserId, body });

      return { id: container.id };
    },
  );

  /** Publicar um container pronto. */
  app.post<{ Params: { version: string; igId: string }; Body: { creation_id?: string } }>(
    "/:version/:igId/media_publish",
    async (request, reply) => {
      if (!bearerOk(request.headers.authorization)) return reply.code(400).send(invalidToken);
      publishCalls += 1;

      if (publishRefusal) {
        const refusal = publishRefusal;
        publishRefusal = null;
        return refuse(reply, refusal);
      }

      const container = containers.get(request.body?.creation_id ?? "");
      if (!container || container.igUserId !== request.params.igId) {
        return reply.code(400).send(graphError(100, "Invalid creation_id."));
      }
      if (current(container) !== "FINISHED") {
        return reply.code(400).send(graphError(9007, "The media is not ready for publishing.", 2207027));
      }

      const outcome = publishOutcome;
      publishOutcome = "ok";

      if (outcome === "drop-before-publish") return dropConnection(reply);

      container.published = true;
      const media = { id: newId("180"), containerId: container.id };
      published.push(media);

      if (outcome === "drop-after-publish") return dropConnection(reply);
      return { id: media.id };
    },
  );

  /**
   * Leitura de um objeto pelo id: o estado de um container ou o permalink de uma
   * mídia. Na Meta os dois são o mesmo `GET /<id>` com campos diferentes.
   */
  app.get<{ Params: { version: string; objectId: string }; Querystring: { access_token?: string; fields?: string } }>(
    "/:version/:objectId",
    async (request, reply) => {
      if (!queryOk(request.query.access_token)) return reply.code(400).send(invalidToken);

      const container = containers.get(request.params.objectId);
      if (container) {
        const status = current(container);
        // Cada consulta consome um passo do roteiro; o último fica.
        if (!container.published && container.statuses.length > 1) container.statuses.shift();
        return { status_code: status, status: `Fake: ${status}`, id: container.id };
      }

      const media = published.find((item) => item.id === request.params.objectId);
      if (media) return { permalink: `https://www.instagram.com/p/fake${media.id}/`, id: media.id };

      return reply.code(400).send(graphError(100, "Unsupported get request."));
    },
  );
}

/**
 * Derruba a conexão sem responder: do lado do cliente, é um erro de rede — nem
 * sucesso nem recusa, que é a ambiguidade que a reconciliação existe para tratar.
 */
function dropConnection(reply: FastifyReply): FastifyReply {
  reply.hijack();
  reply.raw.destroy();
  return reply;
}
