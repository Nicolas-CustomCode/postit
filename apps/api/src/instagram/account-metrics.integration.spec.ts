import type { FastifyInstance } from "fastify";
import type { AccountMetricValues } from "@repo/shared";
import { createTestAccount } from "../common/testing/factories";
import { bootTestApp, type TestApp } from "../common/testing/test-app";
import { createFakeMeta, FAKE_META_LONG_TOKEN, FAKE_META_REDIRECT_URI } from "../fake-meta/fake-meta";
import { dayFromDatabase, dayLabel, daysBefore, nextDay } from "../domain/metrics/day-window";
import { InstagramAccountMetricsService } from "./account-metrics.service";

/**
 * A coleta diária das métricas da conta (RF-G06; docs/09).
 *
 * Contra a **Meta falsa** (AGENTS.md, regra 23) e o Postgres de verdade. A Meta
 * falsa é roteirizada para os três casos que importam: uma métrica que a conta
 * não tem, uma que volta sem valor escalar, e a recusa que derruba a chamada
 * inteira.
 *
 * O relógio nunca é falsificado — `jest.useFakeTimers()` trava a suíte. Onde o
 * tempo importa, o dado é que envelhece (`ageColumn`), e o `now` entra por
 * parâmetro.
 */
describe("coleta de métricas da conta", () => {
  let api: TestApp;
  let meta: FastifyInstance;
  let metrics: InstagramAccountMetricsService;
  const SP = "America/Sao_Paulo";
  /** Os mesmos números do serviço: 3 dias relidos, 30 no retroativo. */
  const OVERLAP = 3;
  const BACKFILL = 30;

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

    metrics = api.app.get(InstagramAccountMetricsService);
  });

  beforeEach(() => api.reset());

  afterAll(async () => {
    await api.close();
    await meta.close();
  });

  const conta = (options: { timezone?: string } = {}) =>
    createTestAccount(api.db, api.config.encryptionKey, {
      token: FAKE_META_LONG_TOKEN,
      timezone: options.timezone ?? SP,
    });

  /** As linhas gravadas, em ordem de dia, já com o JSON tipado. */
  async function linhas(accountId: string) {
    const gravadas = await api.db.accountMetric.findMany({
      where: { accountId },
      orderBy: { day: "asc" },
    });
    return gravadas.map((linha) => ({
      dia: dayFromDatabase(linha.day),
      valores: linha.values as AccountMetricValues,
    }));
  }

  /** Uma conta que já passou pelo retroativo, pronta para o regime de rotina. */
  async function contaEmDia(agora: Date, options: { timezone?: string } = {}) {
    const c = await conta(options);
    await metrics.collectDue(agora);
    return c;
  }

  it("grava uma linha por dia, em dias consecutivos até hoje", async () => {
    const c = await conta();
    const agora = new Date();

    const resultado = await metrics.collectDue(agora);

    expect(resultado).toMatchObject({ accounts: 1, recoverable: 0, fatal: 0 });

    const gravadas = await linhas(c.id);
    const hoje = dayLabel(agora, SP);
    expect(gravadas.at(-1)?.dia).toBe(hoje);
    // Consecutivos, sem buraco: cada dia é o seguinte do anterior.
    for (let i = 1; i < gravadas.length; i += 1) {
      expect(gravadas[i]?.dia).toBe(nextDay(gravadas[i - 1]?.dia ?? ""));
    }
  });

  it("na rotina relê só os 3 dias da sobreposição", async () => {
    const agora = new Date();
    await contaEmDia(agora);

    expect(await metrics.collectDue(agora)).toMatchObject({ days: OVERLAP });
  });

  /*
   * O coração da RF-G07: a tela precisa distinguir "aconteceu zero vez" de "a
   * Meta não fornece". Se a chave existir com 0, a distinção se perde para
   * sempre — e contas com menos de 100 seguidores caem nisso todo dia.
   */
  it("métrica que a conta não tem fica AUSENTE, nunca zero", async () => {
    const c = await conta();

    await metrics.collectDue(new Date());

    const insights = (await linhas(c.id)).at(-1)?.valores.insights ?? {};
    expect(insights.reach).toBe(100);
    expect("profile_links_taps" in insights).toBe(false);
  });

  it("métrica que volta sem valor escalar também fica ausente", async () => {
    const c = await conta();

    await metrics.collectDue(new Date());

    const insights = (await linhas(c.id)).at(-1)?.valores.insights ?? {};
    expect("follows_and_unfollows" in insights).toBe(false);
  });

  it("o perfil entra só na linha de hoje, não nos dias anteriores", async () => {
    const c = await conta();
    const agora = new Date();

    await metrics.collectDue(agora);

    const gravadas = await linhas(c.id);
    const hoje = dayLabel(agora, SP);
    for (const linha of gravadas) {
      if (linha.dia === hoje) expect(linha.valores.profile).toMatchObject({ followers_count: 42 });
      else expect(linha.valores.profile).toBeUndefined();
    }
  });

  /*
   * A releitura existe porque a Meta atrasa números em até 48 h. Ela precisa
   * atualizar os insights SEM apagar o perfil daquele dia — que é o merge do
   * `||` do jsonb, e não um sobrescrever cego.
   */
  it("recoletar atualiza os insights e preserva o perfil já gravado", async () => {
    const c = await conta();
    const agora = new Date();
    await metrics.collectDue(agora);

    const hoje = dayLabel(agora, SP);
    const antes = (await linhas(c.id)).find((l) => l.dia === hoje);
    expect(antes?.valores.profile).toBeDefined();

    await metrics.collectDue(agora);

    const gravadas = await linhas(c.id);
    expect(gravadas).toHaveLength(BACKFILL);
    const depois = gravadas.find((l) => l.dia === hoje);
    expect(depois?.valores.profile).toEqual(antes?.valores.profile);
    expect(depois?.valores.insights?.reach).toBe(100);
  });

  /*
   * O erro que a revisão pegou: se o critério fosse "a conta já tem alguma
   * linha", um retroativo interrompido no meio jamais seria completado, e os
   * dias do meio sumiriam depois de 90 dias — exatamente o que esta tabela
   * existe para impedir.
   */
  it("completa lacuna deixada por uma coleta que parou no meio", async () => {
    const c = await conta();
    const agora = new Date();
    await metrics.collectDue(agora);

    const hoje = dayLabel(agora, SP);
    const buraco = daysBefore(hoje, 1);
    await api.db.accountMetric.deleteMany({
      where: { accountId: c.id, day: new Date(`${buraco}T00:00:00.000Z`) },
    });
    expect(await linhas(c.id)).toHaveLength(BACKFILL - 1);

    await metrics.collectDue(agora);

    expect((await linhas(c.id)).map((l) => l.dia)).toContain(buraco);
  });

  /*
   * O retroativo busca antes da conexão de propósito: a Meta guarda 90 dias das
   * métricas da conta independentemente do nosso app, então uma conta conectada
   * hoje tem um mês de histórico real esperando. É para isso que ele existe.
   */
  it("na primeira coleta busca 30 dias, e depois só os 3 da sobreposição", async () => {
    await conta();

    expect(await metrics.collectDue(new Date())).toMatchObject({ days: BACKFILL });
    expect(await metrics.collectDue(new Date())).toMatchObject({ days: OVERLAP });
  });

  it("o dia é o da conta: contas em fusos diferentes podem gravar dias diferentes", async () => {
    const brasil = await conta({ timezone: SP });
    const tokyo = await conta({ timezone: "Asia/Tokyo" });
    // 02:00 UTC: ainda é o dia anterior no Brasil, já é o dia seguinte em Tóquio.
    const agora = new Date("2026-09-16T02:00:00.000Z");

    await metrics.collectDue(agora);

    const ultimoDoBrasil = (await linhas(brasil.id)).at(-1)?.dia;
    const ultimoDeTokyo = (await linhas(tokyo.id)).at(-1)?.dia;
    expect(ultimoDoBrasil).toBe("2026-09-15");
    expect(ultimoDeTokyo).toBe("2026-09-16");
  });

  it("deixa de fora conta desativada e conta com token vencido", async () => {
    await createTestAccount(api.db, api.config.encryptionKey, {
      token: FAKE_META_LONG_TOKEN,
      active: false,
    });
    await createTestAccount(api.db, api.config.encryptionKey, {
      token: FAKE_META_LONG_TOKEN,
      tokenExpiresAt: new Date(Date.now() - 1000),
    });

    expect(await metrics.collectDue(new Date())).toMatchObject({ accounts: 0, days: 0 });
  });

  it("uma conta com problema não impede as outras de coletar", async () => {
    await createTestAccount(api.db, api.config.encryptionKey, { token: "token-que-a-meta-recusa" });
    const boa = await conta();

    const resultado = await metrics.collectDue(new Date());

    expect(resultado.accounts).toBe(2);
    expect(await linhas(boa.id)).toHaveLength(BACKFILL);
  });
});
