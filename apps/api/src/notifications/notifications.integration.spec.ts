import type { NotificationType } from "@repo/shared";
import { createTestAccount, createTestPost, createTestUser, TEST_PASSWORD, totpCodeFor } from "../common/testing/factories";
import { bootTestApp, type TestApp } from "../common/testing/test-app";

/**
 * As rotas do sino (RF-J01): listar, contar, marcar como lido.
 *
 * O que importa provar é o recorte: cada pessoa vê e marca **só as próprias**
 * entregas, e o aviso de outra pessoa responde 404, como o que não existe.
 */
describe("sino", () => {
  let api: TestApp;
  const IP = "203.0.113.92";

  beforeAll(async () => {
    api = await bootTestApp();
  });
  beforeEach(() => api.reset());
  afterAll(() => api.close());

  interface Pessoa {
    readonly token: string;
    readonly userId: string;
  }

  async function entrar(): Promise<Pessoa> {
    const user = await createTestUser(api.db, api.config.encryptionKey);
    const desafio = await api.request({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: TEST_PASSWORD },
      ip: IP,
    });
    const sessao = await api.request({
      method: "POST",
      url: "/auth/challenge/verify",
      payload: { token: desafio.body["token"], code: totpCodeFor(user.totpSecret) },
      ip: IP,
    });
    return { token: sessao.body["token"] as string, userId: user.id };
  }

  /** Um aviso entregue a estas pessoas, direto no banco: quem grava é outro teste. */
  async function aviso(
    type: NotificationType,
    target: { type: "POST" | "ACCOUNT"; id: string },
    para: readonly Pessoa[],
  ): Promise<string> {
    const criado = await api.db.notification.create({
      data: {
        type,
        targetType: target.type,
        targetId: target.id,
        deliveries: { createMany: { data: para.map((pessoa) => ({ userId: pessoa.userId })) } },
      },
    });
    return criado.id;
  }

  const get = (pessoa: Pessoa, url: string) => api.request({ method: "GET", url, token: pessoa.token });
  const post = (pessoa: Pessoa, url: string) => api.request({ method: "POST", url, payload: {}, token: pessoa.token });
  const contagem = async (pessoa: Pessoa) => (await get(pessoa, "/notifications/unread-count")).body["count"];

  it("lista só os próprios avisos, o mais recente primeiro, com a postagem e a conta de agora", async () => {
    const ana = await entrar();
    const bruno = await entrar();
    const conta = await createTestAccount(api.db, api.config.encryptionKey, {
      username: "loja.aurora",
      timezone: "America/Sao_Paulo",
    });
    const postagem = await createTestPost(api.db, {
      accountId: conta.id,
      createdById: ana.userId,
      status: "FAILED",
      scheduledAt: new Date("2030-01-15T13:00:00Z"),
    });

    const antigo = await aviso("ACCOUNT_ACCESS_LOST", { type: "ACCOUNT", id: conta.id }, [ana]);
    const recente = await aviso("PUBLISH_FAILED", { type: "POST", id: postagem.id }, [ana, bruno]);
    await aviso("AWAITING_APPROVAL", { type: "POST", id: postagem.id }, [bruno]);

    const resposta = await get(ana, "/notifications");

    expect(resposta.statusCode).toBe(200);
    expect(resposta.body).toEqual([
      {
        id: recente,
        type: "PUBLISH_FAILED",
        createdAt: expect.any(String),
        readAt: null,
        account: { username: "loja.aurora", name: expect.any(String), timezone: "America/Sao_Paulo" },
        post: { id: postagem.id, status: "FAILED", scheduledAt: "2030-01-15T13:00:00.000Z" },
      },
      {
        id: antigo,
        type: "ACCOUNT_ACCESS_LOST",
        createdAt: expect.any(String),
        readAt: null,
        account: { username: "loja.aurora", name: expect.any(String), timezone: "America/Sao_Paulo" },
        post: null,
      },
    ]);
  });

  it("alvo que não existe mais vem nulo, e o aviso continua na lista", async () => {
    const ana = await entrar();
    await aviso("PUBLISH_FAILED", { type: "POST", id: "0190a0b1-0000-7000-8000-000000000000" }, [ana]);

    const [item] = (await get(ana, "/notifications")).body as unknown as Record<string, unknown>[];

    expect(item).toMatchObject({ post: null, account: null });
  });

  it("marcar como lido baixa a contagem, e reabrir não muda quando foi lido", async () => {
    const ana = await entrar();
    const id = await aviso("ACCOUNT_ACCESS_LOST", { type: "ACCOUNT", id: "0190a0b1-0000-7000-8000-000000000001" }, [ana]);
    await aviso("ACCOUNT_ACCESS_LOST", { type: "ACCOUNT", id: "0190a0b1-0000-7000-8000-000000000002" }, [ana]);
    expect(await contagem(ana)).toBe(2);

    const primeira = await post(ana, `/notifications/${id}/read`);
    const segunda = await post(ana, `/notifications/${id}/read`);

    expect(primeira.statusCode).toBe(200);
    expect(primeira.body["readAt"]).toEqual(expect.any(String));
    expect(segunda.body["readAt"]).toBe(primeira.body["readAt"]);
    expect(await contagem(ana)).toBe(1);
  });

  it("o mesmo aviso lido por uma pessoa continua não lido para a outra", async () => {
    const ana = await entrar();
    const bruno = await entrar();
    const id = await aviso("PUBLISH_FAILED", { type: "POST", id: "0190a0b1-0000-7000-8000-000000000003" }, [ana, bruno]);

    await post(ana, `/notifications/${id}/read`);

    expect(await contagem(ana)).toBe(0);
    expect(await contagem(bruno)).toBe(1);
  });

  it.each([
    ["de outra pessoa", "outra"],
    ["que não existe", "0190a0b1-0000-7000-8000-00000000abcd"],
    ["com id que nem é UUID", "nao-e-um-id"],
  ])("marcar um aviso %s responde 404", async (_caso, qual) => {
    const ana = await entrar();
    const bruno = await entrar();
    const deBruno = await aviso("PUBLISH_FAILED", { type: "POST", id: "0190a0b1-0000-7000-8000-000000000004" }, [bruno]);

    const resposta = await post(ana, `/notifications/${qual === "outra" ? deBruno : qual}/read`);

    expect(resposta.statusCode).toBe(404);
    expect(resposta.body["code"]).toBe("NOTIFICATION_NOT_FOUND");
    // E a entrega do outro continua não lida.
    expect(await contagem(bruno)).toBe(1);
  });

  it("marcar todas só mexe nas próprias", async () => {
    const ana = await entrar();
    const bruno = await entrar();
    await aviso("PUBLISH_FAILED", { type: "POST", id: "0190a0b1-0000-7000-8000-000000000005" }, [ana, bruno]);
    await aviso("AWAITING_APPROVAL", { type: "POST", id: "0190a0b1-0000-7000-8000-000000000006" }, [ana]);

    const resposta = await post(ana, "/notifications/read-all");

    expect(resposta.body).toEqual({ updated: 2 });
    expect(await contagem(ana)).toBe(0);
    expect(await contagem(bruno)).toBe(1);
  });

  it("sem sessão, nada", async () => {
    const resposta = await api.request({ method: "GET", url: "/notifications" });
    expect(resposta.statusCode).toBe(401);
  });
});
