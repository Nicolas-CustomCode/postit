import { ageColumn } from "../common/testing/reset-database";
import { createTestUser, TEST_PASSWORD, totpCodeFor } from "../common/testing/factories";
import { bootTestApp, type TestApp } from "../common/testing/test-app";

/**
 * Verificação em duas etapas (ADR 0013, seção 1) e o desafio de login.
 * Cobre os marcos 4, 5 e a parte de 2FA do marco 15 da Fase 0.
 */
describe("duas etapas", () => {
  let api: TestApp;
  const IP = "203.0.113.20";

  beforeAll(async () => {
    api = await bootTestApp();
  });
  beforeEach(() => api.reset());
  afterAll(() => api.close());

  const login = (email: string) =>
    api.request({ method: "POST", url: "/auth/login", payload: { email, password: TEST_PASSWORD }, ip: IP });

  const verify = (token: string, code: string) =>
    api.request({ method: "POST", url: "/auth/challenge/verify", payload: { token, code }, ip: IP });

  it("primeiro acesso: QR, código e os dez códigos de recuperação", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey, { withTotp: false });

    const desafio = await login(user.email);
    expect(desafio.body["purpose"]).toBe("SETUP_2FA");
    const token = desafio.body["token"] as string;

    const setup = await api.request({ method: "POST", url: "/auth/challenge/totp-setup", payload: { token } });
    expect(setup.statusCode).toBe(200);
    expect(setup.body["otpauthUrl"]).toMatch(/^otpauth:\/\/totp\/PostIt:/);
    expect(setup.body["qrDataUrl"]).toMatch(/^data:image\/png;base64,/);

    // O segredo que a pessoa acabou de cadastrar sai do otpauth:// mostrado.
    const secret = new URL((setup.body["otpauthUrl"] as string).replace("otpauth://", "https://")).searchParams.get(
      "secret",
    ) as string;

    const entrou = await verify(token, totpCodeFor(secret));
    expect(entrou.statusCode).toBe(200);
    expect(entrou.body["recoveryCodes"]).toHaveLength(10);
    expect(typeof entrou.body["token"]).toBe("string");

    const gravado = await api.db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(gravado.totpEnabledAt).not.toBeNull();
    // Segredo ilegível no banco (marco 15).
    expect(gravado.totpSecretEncrypted).toMatch(/^v1:/);
    expect(gravado.totpSecretEncrypted).not.toContain(secret);
  });

  it("pedir o QR duas vezes devolve o MESMO segredo", async () => {
    // A tela de cadastro é renderizada mais de uma vez pelo Next. Se cada
    // renderização sorteasse um segredo, o QR lido pela pessoa deixaria de
    // valer, e o código certo apareceria como incorreto.
    const user = await createTestUser(api.db, api.config.encryptionKey, { withTotp: false });
    const token = (await login(user.email)).body["token"] as string;

    const primeiro = await api.request({ method: "POST", url: "/auth/challenge/totp-setup", payload: { token } });
    const segundo = await api.request({ method: "POST", url: "/auth/challenge/totp-setup", payload: { token } });

    expect(segundo.body["otpauthUrl"]).toBe(primeiro.body["otpauthUrl"]);
  });

  it("o mesmo código não entra duas vezes", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey);
    const codigo = totpCodeFor(user.totpSecret);

    const primeiro = await verify((await login(user.email)).body["token"] as string, codigo);
    expect(primeiro.statusCode).toBe(200);

    const segundo = await verify((await login(user.email)).body["token"] as string, codigo);
    expect(segundo.statusCode).toBe(401);
    expect(segundo.body).toMatchObject({ code: "INVALID_CODE" });
  });

  it("aceita o código do passo seguinte (relógio adiantado) e recusa o de dois passos atrás", async () => {
    const adiantado = await createTestUser(api.db, api.config.encryptionKey);
    const aceito = await verify((await login(adiantado.email)).body["token"] as string, totpCodeFor(adiantado.totpSecret, 1));
    expect(aceito.statusCode).toBe(200);

    const atrasado = await createTestUser(api.db, api.config.encryptionKey);
    const recusado = await verify(
      (await login(atrasado.email)).body["token"] as string,
      totpCodeFor(atrasado.totpSecret, -2),
    );
    expect(recusado.statusCode).toBe(401);
  });

  it("um código de recuperação entra uma vez e não entra na segunda", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey, { withTotp: false });

    // Cadastro completo, para receber os códigos.
    const cadastro = await login(user.email);
    const token = cadastro.body["token"] as string;
    const setup = await api.request({ method: "POST", url: "/auth/challenge/totp-setup", payload: { token } });
    const secret = new URL((setup.body["otpauthUrl"] as string).replace("otpauth://", "https://")).searchParams.get(
      "secret",
    ) as string;
    const primeiroLogin = await verify(token, totpCodeFor(secret));
    const codigos = primeiroLogin.body["recoveryCodes"] as string[];

    const usandoCodigo = await verify((await login(user.email)).body["token"] as string, codigos[0] as string);
    expect(usandoCodigo.statusCode).toBe(200);

    const reusando = await verify((await login(user.email)).body["token"] as string, codigos[0] as string);
    expect(reusando.statusCode).toBe(401);
  });

  it("cinco códigos errados esgotam o desafio", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey);
    const token = (await login(user.email)).body["token"] as string;

    for (let tentativa = 0; tentativa < 5; tentativa += 1) {
      expect((await verify(token, "000000")).statusCode).toBe(401);
    }

    // Da sexta em diante nem o código certo serve: o desafio acabou.
    const depois = await verify(token, totpCodeFor(user.totpSecret));
    expect(depois.statusCode).toBe(400);
    expect(depois.body).toMatchObject({ code: "CHALLENGE_INVALID" });
  });

  it("desafio vencido não vale mais", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey);
    const token = (await login(user.email)).body["token"] as string;

    const desafio = await api.db.loginChallenge.findFirstOrThrow({ where: { userId: user.id } });
    await ageColumn(api.db, "DesafioLogin", "expiraEm", desafio.id, "1 second");

    const resposta = await verify(token, totpCodeFor(user.totpSecret));
    expect(resposta.body).toMatchObject({ code: "CHALLENGE_INVALID" });
  });

  it("código errado conta no bloqueio, como a senha errada", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey);
    const token = (await login(user.email)).body["token"] as string;
    await verify(token, "000000");

    const tentativas = await api.db.accessAttempt.findMany({ where: { result: "WRONG_CODE" } });
    expect(tentativas).toHaveLength(1);
    expect(tentativas[0]).toMatchObject({ email: user.email, ip: IP });
  });

  it("um desafio só serve uma vez", async () => {
    const user = await createTestUser(api.db, api.config.encryptionKey);
    const token = (await login(user.email)).body["token"] as string;

    expect((await verify(token, totpCodeFor(user.totpSecret))).statusCode).toBe(200);
    const segundaVez = await verify(token, totpCodeFor(user.totpSecret, 1));
    expect(segundaVez.body).toMatchObject({ code: "CHALLENGE_INVALID" });
  });
});
