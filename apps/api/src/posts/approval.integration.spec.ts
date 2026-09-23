import type { Permission } from "@repo/shared";
import { createTestAccount, createTestUser, TEST_PASSWORD, totpCodeFor } from "../common/testing/factories";
import { bootTestApp, type TestApp } from "../common/testing/test-app";

/**
 * A revisão da postagem (RF-E01 a RF-E03; ADR 0026): enviar, aprovar, aprovar e
 * agendar, reprovar, voltar para a composição e cancelar o agendamento.
 *
 * Contra o Postgres de verdade: a trava da versão, a transação única de "aprovar e
 * agendar" e o registro em `Aprovacao` não se provam com banco falso.
 */
describe("revisão da postagem", () => {
  let api: TestApp;
  const IP = "203.0.113.78";
  const FUTURO = { day: "2030-01-15", time: "10:00" };

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

  const editor = () => entrar(["POST_EDIT"]);
  const operador = () => entrar(["POST_EDIT", "POST_APPROVE", "POST_SCHEDULE"]);

  async function conta(): Promise<string> {
    return (await createTestAccount(api.db, api.config.encryptionKey, { username: "loja.aurora" })).id;
  }

  async function midia(): Promise<string> {
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
    return media.id;
  }

  function acao(pessoa: Pessoa, accountId: string, postId: string, verbo: string, payload: Record<string, unknown>) {
    return api.request({ method: "POST", url: `/accounts/${accountId}/posts/${postId}/${verbo}`, payload, token: pessoa.token });
  }

  /** Um rascunho completo, do autor, na versão 2 — pronto para enviar. */
  async function rascunho(autor: Pessoa, accountId: string, comImagem = true): Promise<string> {
    const criado = await api.request({
      method: "POST",
      url: `/accounts/${accountId}/posts`,
      payload: { format: "FEED", caption: "Chegou o cold brew" },
      token: autor.token,
    });
    const postId = criado.body["id"] as string;

    const media = comImagem ? [{ mediaId: await midia() }] : [];
    const salvo = await acao(autor, accountId, postId, "media", { version: 1, media });
    expect(salvo.statusCode).toBe(200);
    return postId;
  }

  /** Um rascunho enviado para revisão pelo autor: versão 3. */
  async function emRevisao(autor: Pessoa, accountId: string): Promise<string> {
    const postId = await rascunho(autor, accountId);
    expect((await acao(autor, accountId, postId, "submit", { version: 2 })).statusCode).toBe(200);
    return postId;
  }

  const post = (postId: string) => api.db.post.findUniqueOrThrow({ where: { id: postId } });
  const trilha = async (postId: string) =>
    (await api.db.approval.findMany({ where: { postId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).map(
      (linha) => linha.action,
    );

  describe("enviar para revisão (RF-E01)", () => {
    it("o editor envia, e fica registrado quem enviou", async () => {
      const autor = await editor();
      const accountId = await conta();
      const postId = await rascunho(autor, accountId);

      const resposta = await acao(autor, accountId, postId, "submit", { version: 2 });

      expect(resposta.statusCode).toBe(200);
      expect(resposta.body).toEqual({ version: 3 });
      expect((await post(postId)).status).toBe("IN_REVIEW");
      const linhas = await api.db.approval.findMany({ where: { postId } });
      expect(linhas).toMatchObject([{ action: "SUBMITTED_FOR_REVIEW", userId: autor.userId }]);
    });

    it("sem imagem não vai para revisão", async () => {
      const autor = await editor();
      const accountId = await conta();
      const postId = await rascunho(autor, accountId, false);

      const resposta = await acao(autor, accountId, postId, "submit", { version: 2 });

      expect(resposta.statusCode).toBe(422);
      expect(resposta.body).toMatchObject({ code: "POST_MEDIA_REQUIRED" });
      expect((await post(postId)).status).toBe("DRAFT");
    });

    it("quem só vê não envia", async () => {
      const autor = await editor();
      const leitor = await entrar([]);
      const accountId = await conta();
      const postId = await rascunho(autor, accountId);

      expect((await acao(leitor, accountId, postId, "submit", { version: 2 })).statusCode).toBe(403);
    });

    it("o que já está em revisão não se envia de novo", async () => {
      const autor = await editor();
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);

      const resposta = await acao(autor, accountId, postId, "submit", { version: 3 });

      expect(resposta.statusCode).toBe(409);
      expect(resposta.body).toMatchObject({ code: "POST_TRANSITION_INVALID" });
    });

    // RF-E01: "postagem em revisão não pode ser agendada".
    it("em revisão não se agenda pela rota de agendar", async () => {
      const autor = await editor();
      const quemAgenda = await operador();
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);

      const resposta = await acao(quemAgenda, accountId, postId, "schedule", { version: 3, ...FUTURO });

      expect(resposta.statusCode).toBe(409);
      expect((await post(postId)).status).toBe("IN_REVIEW");
    });
  });

  describe("aprovar e agendar (ADR 0026)", () => {
    it("uma decisão, uma transação: agendada, com uma linha de aprovação e o horário", async () => {
      const autor = await editor();
      const aprovador = await operador();
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);

      const resposta = await acao(aprovador, accountId, postId, "approve-and-schedule", { version: 3, ...FUTURO });

      expect(resposta.statusCode).toBe(200);
      const depois = await post(postId);
      expect(depois).toMatchObject({ status: "SCHEDULED", version: 4, scheduledById: aprovador.userId });
      // 10:00 em São Paulo, em UTC (regra 7).
      expect(depois.scheduledAt?.toISOString()).toBe("2030-01-15T13:00:00.000Z");

      const linhas = await api.db.approval.findMany({ where: { postId, action: "APPROVED" } });
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toMatchObject({ userId: aprovador.userId });
      expect(linhas[0]?.scheduledFor?.toISOString()).toBe("2030-01-15T13:00:00.000Z");
    });

    /*
     * Tudo ou nada: horário no passado recusa a decisão inteira. "Aprovada, mas sem
     * agendar" seria meia decisão tomada em nome de alguém.
     */
    it("horário no passado recusa tudo: continua em revisão, na mesma versão, sem aprovação", async () => {
      const autor = await editor();
      const aprovador = await operador();
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);

      const resposta = await acao(aprovador, accountId, postId, "approve-and-schedule", {
        version: 3,
        day: "2020-01-15",
        time: "10:00",
      });

      expect(resposta.statusCode).toBe(422);
      expect(resposta.body).toMatchObject({ code: "SCHEDULE_IN_PAST" });
      expect(await post(postId)).toMatchObject({ status: "IN_REVIEW", version: 3, scheduledAt: null });
      expect(await trilha(postId)).toEqual(["SUBMITTED_FOR_REVIEW"]);
    });

    it.each([
      ["sem POSTAGEM_AGENDAR", ["POST_EDIT", "POST_APPROVE"]],
      ["sem POSTAGEM_APROVAR", ["POST_EDIT", "POST_SCHEDULE"]],
    ] as const)("%s, é recusado", async (_, permissoes) => {
      const autor = await editor();
      const outro = await entrar(permissoes);
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);

      const resposta = await acao(outro, accountId, postId, "approve-and-schedule", { version: 3, ...FUTURO });

      expect(resposta.statusCode).toBe(403);
      expect((await post(postId)).status).toBe("IN_REVIEW");
    });

    it("rascunho não se aprova: primeiro vai para revisão", async () => {
      const autor = await operador();
      const accountId = await conta();
      const postId = await rascunho(autor, accountId);

      const resposta = await acao(autor, accountId, postId, "approve-and-schedule", { version: 2, ...FUTURO });

      expect(resposta.statusCode).toBe(409);
      expect(resposta.body).toMatchObject({ code: "POST_TRANSITION_INVALID" });
    });
  });

  describe("aprovar sem agendar", () => {
    it("quem aprova e não agenda deixa a postagem aprovada, sem horário", async () => {
      const autor = await editor();
      const aprovador = await entrar(["POST_EDIT", "POST_APPROVE"]);
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);

      const resposta = await acao(aprovador, accountId, postId, "approve", { version: 3 });

      expect(resposta.statusCode).toBe(200);
      expect(await post(postId)).toMatchObject({ status: "APPROVED", scheduledAt: null });
      expect(await trilha(postId)).toEqual(["SUBMITTED_FOR_REVIEW", "APPROVED"]);
    });

    // Com a aresta AGENDADO → APROVADO, "aprovar" uma agendada seria uma aprovação que ninguém deu.
    it("uma agendada não se aprova de novo", async () => {
      const autor = await editor();
      const aprovador = await operador();
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);
      await acao(aprovador, accountId, postId, "approve-and-schedule", { version: 3, ...FUTURO });

      const resposta = await acao(aprovador, accountId, postId, "approve", { version: 4 });

      expect(resposta.statusCode).toBe(409);
      expect((await post(postId)).status).toBe("SCHEDULED");
    });
  });

  /*
   * A matriz da autoaprovação (RF-E02, RF-I04; ADR 0015): aprovar e reprovar a
   * própria exige POSTAGEM_APROVAR_PROPRIA — e super admin tem todas.
   */
  describe("autoaprovação", () => {
    it.each([
      ["approve", {}],
      ["approve-and-schedule", FUTURO],
      ["reject", { reason: "Não gostei" }],
    ] as const)("o autor sem POSTAGEM_APROVAR_PROPRIA não faz %s na própria", async (verbo, extra) => {
      const autor = await operador();
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);

      const resposta = await acao(autor, accountId, postId, verbo, { version: 3, ...extra });

      expect(resposta.statusCode).toBe(403);
      expect(resposta.body).toMatchObject({ code: "SELF_APPROVAL_FORBIDDEN" });
      expect((await post(postId)).status).toBe("IN_REVIEW");
    });

    it("com POSTAGEM_APROVAR_PROPRIA, aprova a própria", async () => {
      const autor = await entrar(["POST_EDIT", "POST_APPROVE", "POST_APPROVE_OWN", "POST_SCHEDULE"]);
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);

      expect((await acao(autor, accountId, postId, "approve-and-schedule", { version: 3, ...FUTURO })).statusCode).toBe(
        200,
      );
    });

    it("super admin aprova a própria", async () => {
      const autor = await entrar([], true);
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);

      expect((await acao(autor, accountId, postId, "approve", { version: 3 })).statusCode).toBe(200);
    });
  });

  describe("reprovar com motivo (RF-E03)", () => {
    it("volta para rascunho, e o motivo fica registrado", async () => {
      const autor = await editor();
      const aprovador = await operador();
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);

      const resposta = await acao(aprovador, accountId, postId, "reject", {
        version: 3,
        reason: "  A foto 2 está escura; troque pela versão com mais luz.  ",
      });

      expect(resposta.statusCode).toBe(200);
      expect((await post(postId)).status).toBe("DRAFT");
      const reprovacao = await api.db.approval.findFirst({ where: { postId, action: "REJECTED" } });
      expect(reprovacao).toMatchObject({
        userId: aprovador.userId,
        reason: "A foto 2 está escura; troque pela versão com mais luz.",
      });
    });

    it.each([
      ["sem motivo", {}],
      ["com motivo vazio", { reason: "   " }],
    ])("%s é recusado", async (_, extra) => {
      const autor = await editor();
      const aprovador = await operador();
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);

      const resposta = await acao(aprovador, accountId, postId, "reject", { version: 3, ...extra });

      expect(resposta.statusCode).toBe(400);
      expect(resposta.body).toMatchObject({ code: "VALIDATION_FAILED" });
      expect((await post(postId)).status).toBe("IN_REVIEW");
    });

    it("o editor não reprova", async () => {
      const autor = await editor();
      const outroEditor = await editor();
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);

      expect((await acao(outroEditor, accountId, postId, "reject", { version: 3, reason: "x" })).statusCode).toBe(403);
    });
  });

  /*
   * O buraco que a revisão independente achou: editar em revisão não derrubava, e
   * quem aprova podia reescrever a postagem de um colega e aprová-la em seguida.
   */
  describe("editar em revisão", () => {
    it("derruba para rascunho, e fica registrado", async () => {
      const autor = await editor();
      const aprovador = await operador();
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);

      const editou = await acao(aprovador, accountId, postId, "caption", { version: 3, caption: "Outra legenda" });

      expect(editou.statusCode).toBe(200);
      expect((await post(postId)).status).toBe("DRAFT");
      expect(await trilha(postId)).toEqual(["SUBMITTED_FOR_REVIEW", "INVALIDATED_BY_EDIT"]);

      // E aprovar já não tem o que aprovar: precisa ser enviada de novo.
      const aprovou = await acao(aprovador, accountId, postId, "approve", { version: 4 });
      expect(aprovou.statusCode).toBe(409);
    });
  });

  describe("voltar para a composição (ADR 0026)", () => {
    it("da revisão, sem motivo, é voltar — não reprovar", async () => {
      const autor = await editor();
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);

      const resposta = await acao(autor, accountId, postId, "reopen", { version: 3 });

      expect(resposta.statusCode).toBe(200);
      expect((await post(postId)).status).toBe("DRAFT");
      expect(await trilha(postId)).toEqual(["SUBMITTED_FOR_REVIEW", "RETURNED_TO_DRAFT"]);
    });

    it("de uma agendada, volta para rascunho e perde o horário", async () => {
      const autor = await editor();
      const aprovador = await operador();
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);
      await acao(aprovador, accountId, postId, "approve-and-schedule", { version: 3, ...FUTURO });

      // O editor pode: editar a agendada já a derrubava para rascunho (I-2).
      const resposta = await acao(autor, accountId, postId, "reopen", { version: 4 });

      expect(resposta.statusCode).toBe(200);
      expect(await post(postId)).toMatchObject({ status: "DRAFT", scheduledAt: null });
      expect(await trilha(postId)).toEqual(["SUBMITTED_FOR_REVIEW", "APPROVED", "RETURNED_TO_DRAFT"]);
    });

    // FALHOU tem a sua porta, com POSTAGEM_AGENDAR: `to-draft`.
    it("uma que falhou não passa por esta porta", async () => {
      const autor = await editor();
      const accountId = await conta();
      const postId = await rascunho(autor, accountId);
      await api.db.post.update({ where: { id: postId }, data: { status: "FAILED" } });

      const resposta = await acao(autor, accountId, postId, "reopen", { version: 2 });

      expect(resposta.statusCode).toBe(409);
      expect((await post(postId)).status).toBe("FAILED");
    });

    it("quem só vê não volta nada", async () => {
      const autor = await editor();
      const leitor = await entrar([]);
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);

      expect((await acao(leitor, accountId, postId, "reopen", { version: 3 })).statusCode).toBe(403);
    });
  });

  describe("cancelar o agendamento (ADR 0026)", () => {
    it("volta para aprovada, sem horário, e a aprovação continua", async () => {
      const autor = await editor();
      const aprovador = await operador();
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);
      await acao(aprovador, accountId, postId, "approve-and-schedule", { version: 3, ...FUTURO });

      const resposta = await acao(aprovador, accountId, postId, "unschedule", { version: 4 });

      expect(resposta.statusCode).toBe(200);
      expect(await post(postId)).toMatchObject({ status: "APPROVED", scheduledAt: null, scheduledById: null });
      expect(await trilha(postId)).toEqual(["SUBMITTED_FOR_REVIEW", "APPROVED", "UNSCHEDULED"]);

      // E dá para agendar de novo sem passar pela revisão.
      const reagendou = await acao(aprovador, accountId, postId, "schedule", { version: 5, ...FUTURO });
      expect(reagendou.statusCode).toBe(200);
      expect(await trilha(postId)).toEqual(["SUBMITTED_FOR_REVIEW", "APPROVED", "UNSCHEDULED", "SCHEDULED"]);
    });

    it("quem não agenda não cancela o agendamento", async () => {
      const autor = await editor();
      const aprovador = await operador();
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);
      await acao(aprovador, accountId, postId, "approve-and-schedule", { version: 3, ...FUTURO });

      expect((await acao(autor, accountId, postId, "unschedule", { version: 4 })).statusCode).toBe(403);
    });
  });

  /*
   * Toda decisão confere a versão (regra 20): quem decide olhando uma postagem que
   * mudou por baixo recebe 409, e nada acontece.
   */
  describe("versão velha", () => {
    it.each([
      ["submit", {}, "DRAFT"],
      ["approve", {}, "IN_REVIEW"],
      ["approve-and-schedule", FUTURO, "IN_REVIEW"],
      ["reject", { reason: "x" }, "IN_REVIEW"],
      ["reopen", {}, "IN_REVIEW"],
    ] as const)("%s com versão velha devolve 409", async (verbo, extra, estado) => {
      const autor = await editor();
      const aprovador = await operador();
      const accountId = await conta();
      const postId = estado === "DRAFT" ? await rascunho(autor, accountId) : await emRevisao(autor, accountId);

      const resposta = await acao(verbo === "submit" || verbo === "reopen" ? autor : aprovador, accountId, postId, verbo, {
        version: 1,
        ...extra,
      });

      expect(resposta.statusCode).toBe(409);
      expect(resposta.body).toMatchObject({ code: "POST_VERSION_CONFLICT" });
      expect((await post(postId)).status).toBe(estado);
    });

    it("unschedule com versão velha devolve 409", async () => {
      const autor = await editor();
      const aprovador = await operador();
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);
      await acao(aprovador, accountId, postId, "approve-and-schedule", { version: 3, ...FUTURO });

      const resposta = await acao(aprovador, accountId, postId, "unschedule", { version: 3 });

      expect(resposta.statusCode).toBe(409);
      expect((await post(postId)).status).toBe("SCHEDULED");
    });
  });

  /*
   * ADR 0026, decisão 3: toda mudança humana de status deixa linha. Agendar,
   * cancelar e descartar passavam sem rastro antes da 1e.
   */
  describe("o rastro das decisões que já existiam", () => {
    it("descartar um rascunho fica registrado", async () => {
      const autor = await editor();
      const accountId = await conta();
      const postId = await rascunho(autor, accountId);

      await acao(autor, accountId, postId, "discard", { version: 2 });

      expect(await trilha(postId)).toEqual(["CANCELED"]);
    });

    it("reagendar deixa uma linha por horário", async () => {
      const autor = await editor();
      const aprovador = await operador();
      const accountId = await conta();
      const postId = await emRevisao(autor, accountId);
      await acao(aprovador, accountId, postId, "approve-and-schedule", { version: 3, ...FUTURO });

      await acao(aprovador, accountId, postId, "schedule", { version: 4, day: "2030-01-16", time: "11:00" });

      const linhas = await api.db.approval.findMany({ where: { postId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      expect(linhas.map((linha) => [linha.action, linha.scheduledFor?.toISOString() ?? null])).toEqual([
        ["SUBMITTED_FOR_REVIEW", null],
        ["APPROVED", "2030-01-15T13:00:00.000Z"],
        ["SCHEDULED", "2030-01-16T14:00:00.000Z"],
      ]);
    });
  });
});
