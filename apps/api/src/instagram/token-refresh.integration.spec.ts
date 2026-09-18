import type { FastifyInstance } from "fastify";
import { decryptSecret } from "../common/crypto";
import { createTestAccount } from "../common/testing/factories";
import { ageColumn } from "../common/testing/reset-database";
import { bootTestApp, type TestApp } from "../common/testing/test-app";
import { createFakeMeta, FAKE_META_LONG_TOKEN, FAKE_META_REDIRECT_URI } from "../fake-meta/fake-meta";
import { StorageService } from "../storage/storage.service";
import { InstagramTokenRefreshService } from "./token-refresh.service";

/**
 * A renovação automática do token (docs/08, "Renovação"; docs/09,
 * "renovar-tokens-instagram").
 *
 * Roda contra a **Meta falsa** (AGENTS.md, regra 23) e contra o Postgres e o
 * MinIO de verdade — é onde os erros desta tarefa aparecem.
 *
 * Nenhum teste adianta o relógio: o dado é que envelhece, com `ageColumn`. Um
 * `jest.useFakeTimers()` aqui sequestraria os temporizadores do driver do
 * Postgres e travaria a suíte.
 */
describe("renovação de token do Instagram", () => {
  let api: TestApp;
  let meta: FastifyInstance;
  let refresh: InstagramTokenRefreshService;
  let storage: StorageService;

  beforeAll(async () => {
    meta = createFakeMeta("test");
    await meta.listen({ port: 0, host: "127.0.0.1" });
    const base = `http://127.0.0.1:${meta.addresses()[0]?.port ?? 0}`;

    api = await bootTestApp({
      META_AUTH_URL: base,
      META_TOKEN_URL: base,
      META_GRAPH_URL: base,
      IG_APP_ID: "app-de-teste",
      IG_APP_SECRET: "segredo-de-teste",
      IG_REDIRECT_URI: FAKE_META_REDIRECT_URI,
    });

    refresh = api.app.get(InstagramTokenRefreshService);
    storage = api.app.get(StorageService);
  });

  /**
   * Apaga do MinIO as fotos que este arquivo copiou.
   *
   * Vai pelas contas que **ainda estão no banco**, e não por uma lista escrita à
   * mão: lista manual esquece um caso e o bucket de desenvolvimento acumula
   * lixo. Varrer `publicas/contas/` inteiro seria pior — o teste divide o bucket
   * com o desenvolvimento, e apagaria a foto de uma conta de verdade.
   */
  async function limparFotos(): Promise<void> {
    const contas = await api.db.account.findMany({
      where: { photoObjectKey: { not: null } },
      select: { photoObjectKey: true },
    });
    for (const { photoObjectKey } of contas) {
      if (photoObjectKey !== null) await storage.removePublic(photoObjectKey).catch(() => undefined);
    }
  }

  beforeEach(async () => {
    await limparFotos();
    await api.reset();
  });

  afterAll(async () => {
    await limparFotos();
    await api.close();
    await meta.close();
  });

  /** Uma conta conectada há `dias`, com um token que a Meta falsa reconhece. */
  async function contaConectadaHa(dias: number, token = FAKE_META_LONG_TOKEN) {
    const conta = await createTestAccount(api.db, api.config.encryptionKey, { token });
    await ageColumn(api.db, "Conta", "criadoEm", conta.id, `${dias} days`);
    return conta;
  }

  const lerConta = (id: string) =>
    api.db.account.findUniqueOrThrow({
      where: { id },
      select: { tokenEncrypted: true, tokenExpiresAt: true, tokenRefreshedAt: true, photoObjectKey: true },
    });

  it("renova o token de quem passou de 30 dias e empurra o vencimento", async () => {
    const conta = await contaConectadaHa(31);
    const antes = await lerConta(conta.id);

    const resultado = await refresh.refreshDue(new Date());

    expect(resultado).toMatchObject({ due: 1, refreshed: 1, recoverable: 0, fatal: 0 });

    const depois = await lerConta(conta.id);
    expect(depois.tokenExpiresAt.getTime()).toBeGreaterThan(antes.tokenExpiresAt.getTime());
    expect(depois.tokenRefreshedAt).not.toBeNull();
  });

  it("não toca em conta cujo token ainda é novo", async () => {
    const conta = await contaConectadaHa(5);
    const antes = await lerConta(conta.id);

    const resultado = await refresh.refreshDue(new Date());

    expect(resultado).toMatchObject({ due: 0, refreshed: 0 });
    expect((await lerConta(conta.id)).tokenExpiresAt).toEqual(antes.tokenExpiresAt);
    expect((await lerConta(conta.id)).tokenRefreshedAt).toBeNull();
  });

  /*
   * Renovar aos 30 dias de um prazo de 60 existe para isto: a segunda execução
   * do dia seguinte não tem o que fazer. É a folga que permite a tarefa falhar
   * um mês seguido sem nenhuma conta expirar (docs/08).
   */
  it("é idempotente: renovar de novo no mesmo dia não acha nada a fazer", async () => {
    await contaConectadaHa(31);
    await refresh.refreshDue(new Date());

    expect(await refresh.refreshDue(new Date())).toMatchObject({ due: 0 });
  });

  it("grava uma linha em EventoToken a cada renovação", async () => {
    const conta = await contaConectadaHa(31);

    await refresh.refreshDue(new Date());

    const eventos = await api.db.tokenEvent.findMany({ where: { accountId: conta.id } });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ action: "REFRESH", result: "SUCCESS" });
  });

  /*
   * Token que a Meta não reconhece mais: acesso revogado, senha trocada, ou os
   * 60 dias passados. Repetir não ajuda, então a falha é fatal — fica gravada e
   * a tarefa termina sem pedir repetição.
   */
  it("marca como sem recuperação quando a Meta recusa o token", async () => {
    const conta = await contaConectadaHa(31, "token-revogado-pela-pessoa");
    const antes = await lerConta(conta.id);

    const resultado = await refresh.refreshDue(new Date());

    expect(resultado).toMatchObject({ due: 1, refreshed: 0, recoverable: 0, fatal: 1 });
    expect((await lerConta(conta.id)).tokenExpiresAt).toEqual(antes.tokenExpiresAt);

    const eventos = await api.db.tokenEvent.findMany({ where: { accountId: conta.id } });
    expect(eventos[0]).toMatchObject({ action: "REFRESH", result: "FATAL_ERROR" });
  });

  it("uma conta com problema não impede as outras de renovar", async () => {
    await contaConectadaHa(31, "token-revogado-pela-pessoa");
    const boa = await contaConectadaHa(31);

    const resultado = await refresh.refreshDue(new Date());

    expect(resultado).toMatchObject({ due: 2, refreshed: 1, fatal: 1 });
    expect((await lerConta(boa.id)).tokenRefreshedAt).not.toBeNull();
  });

  it("deixa de fora conta desativada e conta com token já vencido", async () => {
    const desativada = await createTestAccount(api.db, api.config.encryptionKey, {
      token: FAKE_META_LONG_TOKEN,
      active: false,
    });
    const vencida = await createTestAccount(api.db, api.config.encryptionKey, {
      token: FAKE_META_LONG_TOKEN,
      tokenExpiresAt: new Date(Date.now() - 1000),
    });
    for (const conta of [desativada, vencida]) {
      await ageColumn(api.db, "Conta", "criadoEm", conta.id, "40 days");
    }

    // A Meta recusa renovar token vencido, e conta desativada não publica nada.
    expect(await refresh.refreshDue(new Date())).toMatchObject({ due: 0 });
  });

  /*
   * O endereço que a Meta dá para a foto é assinado e vence. Por isso a cópia é
   * refeita a cada renovação, e a chave nova é sempre outra: o domínio de mídia
   * serve com cache longo (docs/10).
   */
  it("copia a foto de perfil de novo, numa chave nova, e apaga a anterior", async () => {
    const conta = await contaConectadaHa(31);

    await refresh.refreshDue(new Date());
    const primeira = (await lerConta(conta.id)).photoObjectKey;
    expect(primeira).toMatch(/^publicas\/contas\/[0-9a-f]{32}\.png$/);

    // Envelhece de novo para a segunda execução ter o que renovar.
    await ageColumn(api.db, "Conta", "tokenRenovadoEm", conta.id, "31 days");
    await refresh.refreshDue(new Date());

    const segunda = (await lerConta(conta.id)).photoObjectKey;
    expect(segunda).not.toBe(primeira);
  });

  it("nunca devolve o token em claro: o que fica no banco está cifrado", async () => {
    const conta = await contaConectadaHa(31);

    await refresh.refreshDue(new Date());

    const { tokenEncrypted } = await lerConta(conta.id);
    expect(tokenEncrypted).toMatch(/^v1:/);
    expect(tokenEncrypted).not.toContain(FAKE_META_LONG_TOKEN);
    expect(decryptSecret(tokenEncrypted, api.config.encryptionKey, "instagram-token")).toBe(FAKE_META_LONG_TOKEN);
  });
});
