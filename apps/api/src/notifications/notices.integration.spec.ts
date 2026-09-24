import type { NotificationType, Permission } from "@repo/shared";
import { createTestAccount, createTestUser, TEST_PASSWORD, totpCodeFor } from "../common/testing/factories";
import { bootTestApp, type TestApp } from "../common/testing/test-app";

/**
 * Os avisos que a revisão gera (RF-J03): "aguardando aprovação" ao enviar e
 * "reprovada" ao reprovar — gravados na transação da decisão.
 *
 * Contra o Postgres de verdade: o que se prova é que o aviso some junto quando a
 * decisão é desfeita pela trava da versão, e isso banco falso não mostra.
 */
describe("avisos da revisão", () => {
  let api: TestApp;
  const IP = "203.0.113.91";

  beforeAll(async () => {
    api = await bootTestApp();
  });
  beforeEach(() => api.reset());
  afterAll(() => api.close());

  interface Pessoa {
    readonly token: string;
    readonly userId: string;
  }

  /** Entra de verdade — sem atalho, como manda a regra 11. */
  async function entrar(permissions: readonly Permission[], superAdmin = false): Promise<Pessoa> {
    const user = await createTestUser(api.db, api.config.encryptionKey, { permissions, superAdmin });
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

  async function conta(): Promise<string> {
    return (await createTestAccount(api.db, api.config.encryptionKey, { username: "loja.aurora" })).id;
  }

  function acao(pessoa: Pessoa, accountId: string, postId: string, verbo: string, payload: Record<string, unknown>) {
    return api.request({ method: "POST", url: `/accounts/${accountId}/posts/${postId}/${verbo}`, payload, token: pessoa.token });
  }

  /** Um rascunho completo, do autor, na versão 2 — pronto para enviar. */
  async function rascunho(autor: Pessoa, accountId: string): Promise<string> {
    const criado = await api.request({
      method: "POST",
      url: `/accounts/${accountId}/posts`,
      payload: { format: "FEED", caption: "Chegou o cold brew" },
      token: autor.token,
    });
    const postId = criado.body["id"] as string;
    const media = await api.db.media.create({
      data: {
        objectKey: `publicas/postagens/${Math.random().toString(16).slice(2, 10)}.jpg`,
        mimeType: "image/jpeg",
        bytes: 1_000_000,
        width: 1080,
        height: 1350,
        sha256: "a".repeat(64),
      },
    });
    expect((await acao(autor, accountId, postId, "media", { version: 1, media: [{ mediaId: media.id }] })).statusCode).toBe(
      200,
    );
    return postId;
  }

  /** Quem recebeu cada aviso do tipo, sobre esta postagem. */
  async function destinatarios(type: NotificationType, postId: string): Promise<string[][]> {
    const avisos = await api.db.notification.findMany({
      where: { type, targetType: "POST", targetId: postId },
      include: { deliveries: { select: { userId: true } } },
    });
    return avisos.map((aviso) => aviso.deliveries.map((entrega) => entrega.userId).sort());
  }

  describe("aguardando aprovação", () => {
    it("enviar avisa quem pode aprovar, e não quem enviou", async () => {
      const autor = await entrar(["POST_EDIT"]);
      const aprovador = await entrar(["POST_APPROVE"]);
      const admin = await entrar([], true);
      await entrar(["POST_SCHEDULE"]);
      const accountId = await conta();
      const postId = await rascunho(autor, accountId);

      expect((await acao(autor, accountId, postId, "submit", { version: 2 })).statusCode).toBe(200);

      expect(await destinatarios("AWAITING_APPROVAL", postId)).toEqual([[aprovador.userId, admin.userId].sort()]);
    });

    it("quem pode aprovar e continua para a revisão avisa os outros, e não a si mesmo", async () => {
      const autor = await entrar(["POST_EDIT", "POST_APPROVE", "POST_APPROVE_OWN"]);
      const outro = await entrar(["POST_APPROVE"]);
      const accountId = await conta();
      const postId = await rascunho(autor, accountId);

      await acao(autor, accountId, postId, "submit", { version: 2 });

      expect(await destinatarios("AWAITING_APPROVAL", postId)).toEqual([[outro.userId]]);
    });

    /*
     * A trava da versão (regra 20) desfaz a transação inteira: sem ela, o
     * aprovador receberia o aviso de um envio que não aconteceu.
     */
    it("envio recusado por versão velha não deixa aviso", async () => {
      const autor = await entrar(["POST_EDIT"]);
      await entrar(["POST_APPROVE"]);
      const accountId = await conta();
      const postId = await rascunho(autor, accountId);

      const resposta = await acao(autor, accountId, postId, "submit", { version: 1 });

      expect(resposta.statusCode).toBe(409);
      expect(await api.db.notification.count()).toBe(0);
    });
  });

  describe("reprovada", () => {
    it("avisa o autor e quem enviou, uma vez cada, e não quem reprovou", async () => {
      const autor = await entrar(["POST_EDIT"]);
      const quemEnviou = await entrar(["POST_EDIT"]);
      const aprovador = await entrar(["POST_APPROVE"]);
      await entrar([], true);
      const accountId = await conta();
      const postId = await rascunho(autor, accountId);
      await acao(quemEnviou, accountId, postId, "submit", { version: 2 });

      const resposta = await acao(aprovador, accountId, postId, "reject", { version: 3, reason: "Falta o preço" });

      expect(resposta.statusCode).toBe(200);
      // Sem o super admin: o aviso é resposta a quem escreveu e a quem enviou.
      expect(await destinatarios("POST_REJECTED", postId)).toEqual([[autor.userId, quemEnviou.userId].sort()]);
    });

    it("o autor que enviou a própria recebe uma vez", async () => {
      const autor = await entrar(["POST_EDIT"]);
      const aprovador = await entrar(["POST_APPROVE"]);
      const accountId = await conta();
      const postId = await rascunho(autor, accountId);
      await acao(autor, accountId, postId, "submit", { version: 2 });

      await acao(aprovador, accountId, postId, "reject", { version: 3, reason: "Falta o preço" });

      expect(await destinatarios("POST_REJECTED", postId)).toEqual([[autor.userId]]);
    });

    it("reprovação recusada por versão velha não deixa aviso", async () => {
      const autor = await entrar(["POST_EDIT"]);
      const aprovador = await entrar(["POST_APPROVE"]);
      const accountId = await conta();
      const postId = await rascunho(autor, accountId);
      await acao(autor, accountId, postId, "submit", { version: 2 });

      const resposta = await acao(aprovador, accountId, postId, "reject", { version: 2, reason: "Falta o preço" });

      expect(resposta.statusCode).toBe(409);
      expect(await destinatarios("POST_REJECTED", postId)).toEqual([]);
    });
  });
});
