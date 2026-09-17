import { createTestUser } from "../common/testing/factories";
import { ageColumn } from "../common/testing/reset-database";
import { bootTestApp, type TestApp } from "../common/testing/test-app";
import { LinksService } from "./links.service";

/**
 * Links de cadastro e de redefinição (ADR 0013, seção 6), pelas rotas HTTP.
 * É o caminho do primeiro acesso: o comando gera o link, a pessoa define a senha.
 */
describe("links de acesso", () => {
  let api: TestApp;
  let links: LinksService;
  const SENHA_NOVA = "senha-definida-agora-1";

  beforeAll(async () => {
    api = await bootTestApp();
    links = api.app.get(LinksService);
  });
  beforeEach(() => api.reset());
  afterAll(() => api.close());

  const inspect = (token: string, purpose: "SIGNUP" | "PASSWORD_RESET") =>
    api.request({ method: "POST", url: "/auth/links/inspect", payload: { token, purpose } });

  const consume = (token: string, purpose: "SIGNUP" | "PASSWORD_RESET", password = SENHA_NOVA) =>
    api.request({ method: "POST", url: "/auth/links/consume", payload: { token, purpose, password } });

  it("mostra de quem é o link antes de pedir a senha", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey, { password: null, withTotp: false });
    const { token } = await links.issue(user.id, "SIGNUP", new Date());

    const resposta = await inspect(token, "SIGNUP");
    expect(resposta.statusCode).toBe(200);
    expect(resposta.body).toMatchObject({ email: user.email, purpose: "SIGNUP" });
  });

  it("define a senha, marca o link como usado e NÃO cria sessão", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey, { password: null, withTotp: false });
    const { token } = await links.issue(user.id, "SIGNUP", new Date());

    expect((await consume(token, "SIGNUP")).statusCode).toBe(204);

    const gravado = await api.db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(gravado.passwordHash).not.toBeNull();
    // O primeiro acesso também carimba a data: é "senha definida", não "trocada",
    // e é o que a tela de Perfil mostra.
    expect(gravado.passwordSetAt).not.toBeNull();
    expect((await api.db.accessLink.findFirstOrThrow()).usedAt).not.toBeNull();
    // Sessão só nasce depois das duas etapas: aqui não pode haver nenhuma.
    expect(await api.db.session.count()).toBe(0);

    // E a senha definida entra de verdade.
    const login = await api.request({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: SENHA_NOVA },
      ip: "203.0.113.40",
    });
    expect(login.statusCode).toBe(200);
    expect(login.body["purpose"]).toBe("SETUP_2FA");
  });

  it("o mesmo link não serve duas vezes", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey, { password: null, withTotp: false });
    const { token } = await links.issue(user.id, "SIGNUP", new Date());

    await consume(token, "SIGNUP");
    const segundaVez = await consume(token, "SIGNUP");
    expect(segundaVez.statusCode).toBe(400);
    expect(segundaVez.body).toMatchObject({ code: "ACCESS_LINK_INVALID" });
  });

  it("link inexistente, vencido e de outra finalidade dão a MESMA resposta", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey);
    const vencido = await links.issue(user.id, "SIGNUP", new Date());
    const linkVencido = await api.db.accessLink.findFirstOrThrow({ where: { userId: user.id } });
    await ageColumn(api.db, "LinkAcesso", "expiraEm", linkVencido.id, "1 second");

    const outroProposito = await links.issue(user.id, "PASSWORD_RESET", new Date());
    const inexistente = "z".repeat(43);

    const respostas = [
      await inspect(inexistente, "SIGNUP"),
      await inspect(vencido.token, "SIGNUP"),
      await inspect(outroProposito.token, "SIGNUP"),
    ];

    for (const resposta of respostas) {
      expect(resposta.statusCode).toBe(400);
      expect(resposta.body).toEqual({ code: "ACCESS_LINK_INVALID", message: "Este link não vale mais" });
    }
  });

  it("token fora do formato é recusado na validação, antes de qualquer consulta", async () => {
    const resposta = await inspect("curto-demais", "SIGNUP");
    expect(resposta.statusCode).toBe(400);
    expect(resposta.body).toMatchObject({ code: "VALIDATION_FAILED", fields: ["token"] });
  });

  it("redefinir a senha derruba todas as sessões", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey);
    await api.db.session.create({
      data: {
        userId: user.id,
        tokenHash: "1".repeat(64),
        expiresAt: new Date(Date.now() + 86_400_000),
        lastUsedAt: new Date(),
        verifiedAt: new Date(),
      },
    });
    const { token } = await links.issue(user.id, "PASSWORD_RESET", new Date());

    expect((await consume(token, "PASSWORD_RESET")).statusCode).toBe(204);

    const sessao = await api.db.session.findFirstOrThrow();
    expect(sessao.revokedAt).not.toBeNull();
    expect(sessao.revocationReason).toBe("PASSWORD_RESET");
  });

  it("recusa senha fora da política e o link continua valendo", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey, { password: null, withTotp: false });
    const { token } = await links.issue(user.id, "SIGNUP", new Date());

    // Senha igual ao e-mail: recusada pela política de @repo/shared.
    const resposta = await consume(token, "SIGNUP", user.email);
    expect(resposta.body).toMatchObject({ code: "PASSWORD_POLICY" });

    // O link NÃO foi gasto: quem errou a senha tenta de novo, sem pedir outro.
    expect((await api.db.accessLink.findFirstOrThrow()).usedAt).toBeNull();
    expect((await consume(token, "SIGNUP")).statusCode).toBe(204);
  });
});
