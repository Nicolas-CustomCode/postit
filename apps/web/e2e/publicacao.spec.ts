import { expect, test, type Page } from "@playwright/test";
import { createAccount, resetAccounts } from "./support/accounts-db";
import { ESTADO_COMUM, ESTADO_SUPER_ADMIN } from "./support/estado";
import { criarMidia } from "./support/media-db";
import { semearPostagem } from "./support/posts-db";

/**
 * A postagem depois do agendamento (Fase 1d, parte F): o caminho inteiro até
 * `PUBLICADO` pelo worker de verdade contra a Meta falsa (cenário 8 do docs/15), e
 * as telas de cada estado que o motor deixa — só leitura, falha, e quem só vê.
 *
 * As telas de estado usam postagem **semeada**: o motor tem os seus testes no Jest;
 * aqui o que se prova é o que a pessoa vê.
 */
const CONTA = "loja.aurora";
const url = (id: string) => `/c/${CONTA}/postagens/${id}`;

test.describe("publicação", () => {
  test.use({ storageState: ESTADO_SUPER_ADMIN });

  test.beforeEach(async () => {
    await resetAccounts();
    await createAccount({ username: CONTA, name: "Loja Aurora", publishable: true });
  });

  /*
   * O caminho inteiro, pelo worker (docs/15, cenário 8; RF-F01 a RF-F03): compor,
   * marcar como pronta, agendar para o minuto corrente — e esperar o motor. O
   * despachante varre a cada 2 s neste ambiente (`DISPATCH_TICK_SECONDS`).
   */
  test("agendada pela tela, sai publicada pelo worker, com o link", async ({ page }) => {
    await criarMidia({ width: 1080, height: 1350 });
    await page.goto(`/c/${CONTA}/postagens/nova`);
    await escolherDoAcervo(page);
    await page.getByLabel("Legenda").fill("Saindo pelo motor");
    await page.getByLabel("Foto 1").fill("Uma xícara de café sobre a mesa");
    await page.getByRole("button", { name: /salvar rascunho/i }).click();
    await expect(page).toHaveURL(/\/postagens\/[0-9a-f-]+$/);

    await page.getByRole("button", { name: "Marcar como pronta" }).click();
    // Pronta: o botão some, porque a postagem já não precisa dele.
    await expect(page.getByRole("button", { name: "Marcar como pronta" })).toHaveCount(0);

    // O botão de agendar só acende com data e hora preenchidas.
    const agora = await minutoCorrenteEmBrasilia();
    await page.getByLabel("Data").fill(agora.day);
    await page.getByLabel("Hora").fill(agora.time);
    await expect(page.getByRole("button", { name: "Agendar", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Agendar", exact: true }).click();

    // A tela não se atualiza sozinha: recarrega até o motor terminar.
    await expect(async () => {
      await page.reload();
      await expect(page.getByRole("link", { name: "Ver no Instagram" })).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });

    await expect(page.getByRole("heading", { name: "Postagem", exact: true })).toBeVisible();
    await expect(page.getByText("Uma xícara de café sobre a mesa")).toBeVisible();
  });

  test.describe("a publicada abre só para ver", () => {
    test("com quando saiu, o link e o texto de cada foto — e nenhum campo ou botão", async ({ page }) => {
      const midia = await criarMidia({ width: 1080, height: 1350 });
      const id = await semearPostagem({
        status: "PUBLICADO",
        media: [{ id: midia.id, altText: "Três copos de café gelado" }],
        publication: { permalink: "https://www.instagram.com/p/abc123/", publishedAt: new Date() },
      });

      await page.goto(url(id));

      await expect(page.getByRole("heading", { name: "Postagem", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Ver no Instagram" })).toHaveAttribute(
        "href",
        "https://www.instagram.com/p/abc123/",
      );
      await expect(page.getByText("Três copos de café gelado")).toBeVisible();

      // O que confundia (pedido de 23/09/2026): nada de editar numa publicada.
      await expect(page.getByLabel("Legenda")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Marcar como pronta" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /reagendar|agendar/i })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Adicionar imagem" })).toHaveCount(0);
    });

    // V-28: confirmada pelo estado do container, sem o id da mídia.
    test("sem link, diz que o link não veio — e continua publicada", async ({ page }) => {
      const midia = await criarMidia({ width: 1080, height: 1350 });
      const id = await semearPostagem({
        status: "PUBLICADO",
        media: [{ id: midia.id }],
        publication: { permalink: null, publishedAt: new Date() },
      });

      await page.goto(url(id));

      await expect(page.getByText(/Link indisponível/)).toBeVisible();
      await expect(page.getByText(/Texto alternativo não preenchido/)).toBeVisible();
    });

    test("saindo, diz em que tentativa está e por quê", async ({ page }) => {
      const midia = await criarMidia({ width: 1080, height: 1350 });
      const id = await semearPostagem({
        status: "PROCESSANDO",
        leased: true,
        attempts: 2,
        failureCause: "META_UNSTABLE",
        scheduledAt: new Date(Date.now() + 60 * 60_000),
        media: [{ id: midia.id }],
      });

      await page.goto(url(id));

      await expect(page.getByText("Saindo em instantes.")).toBeVisible();
      await expect(page.getByText(/Tentativa 2 de 5 — O Instagram está instável/)).toBeVisible();
    });
  });

  test.describe("a que falhou", () => {
    async function falhada(): Promise<string> {
      const midia = await criarMidia({ width: 1080, height: 1350 });
      return semearPostagem({
        status: "FALHOU",
        failureCause: "TOKEN_INVALID",
        attempts: 1,
        media: [{ id: midia.id }],
        events: [
          { step: "DESPACHAR", result: "SUCESSO" },
          { step: "CRIAR_CONTAINER", result: "ERRO_FATAL", detail: { code: 190, type: "OAuthException" } },
        ],
      });
    }

    test("mostra a causa, o botão da causa, as saídas e o histórico", async ({ page }) => {
      await page.goto(url(await falhada()));

      await expect(page.getByRole("heading", { name: "A publicação não saiu" })).toBeVisible();
      await expect(page.getByText(/A conexão com o Instagram expirou ou foi revogada/)).toBeVisible();
      await expect(page.getByRole("link", { name: `Reconectar @${CONTA}` })).toHaveAttribute("href", "/contas/conectar");

      await expect(page.getByRole("button", { name: "Reagendar" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Voltar para rascunho" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Cancelar postagem" })).toBeVisible();

      await expect(page.getByText(/Enviada ao Instagram:/)).toBeVisible();
      await page.getByText("detalhe técnico").first().click();
      await expect(page.getByText(/"code": 190/)).toBeVisible();
    });

    test("a lista destaca a que falhou, com a causa", async ({ page }) => {
      await falhada();
      await page.goto(`/c/${CONTA}/postagens`);

      await expect(page.getByRole("main").getByText(/A conexão com o Instagram expirou/)).toBeVisible();
    });

    test("voltar para rascunho leva à composição, sem horário", async ({ page }) => {
      await page.goto(url(await falhada()));

      await page.getByRole("button", { name: "Voltar para rascunho" }).click();

      await expect(page.getByRole("heading", { name: "Compor", exact: true })).toBeVisible();
      await expect(page.getByLabel("Legenda")).toBeVisible();
      await expect(page.getByLabel("Data")).toHaveValue("");
    });

    test("reagendar volta a Agendada, com o horário sugerido", async ({ page }) => {
      await page.goto(url(await falhada()));

      // Pré-preenchido com a próxima hora cheia no fuso da conta.
      await expect(page.getByLabel("Hora")).toHaveValue(/^\d{2}:00$/);
      await page.getByRole("button", { name: "Reagendar" }).click();

      await expect(page.getByText("Agendada", { exact: true }).first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Compor", exact: true })).toBeVisible();
    });

    test("cancelar pede confirmação antes", async ({ page }) => {
      await page.goto(url(await falhada()));

      await page.getByRole("button", { name: "Cancelar postagem" }).click();
      await page.getByRole("button", { name: "Confirmar cancelamento" }).click();

      await expect(page).toHaveURL(new RegExp(`/c/${CONTA}/postagens$`));
    });
  });
});

/*
 * ADR 0015: todo logado **vê** postagens. Até 23/09/2026 esta página dava 404 a quem
 * não tinha POSTAGEM_EDITAR. Fora do `main` de propósito na primeira conferência:
 * a casca também precisa estar lá (memória: teste escopado no main não cobre a casca).
 */
test.describe("quem só vê", () => {
  test.use({ storageState: ESTADO_COMUM });

  test.beforeEach(async () => {
    await resetAccounts();
    await createAccount({ username: CONTA, name: "Loja Aurora" });
  });

  test("abre a postagem em leitura, sem campo nem botão", async ({ page }) => {
    const midia = await criarMidia({ width: 1080, height: 1350 });
    const id = await semearPostagem({ status: "RASCUNHO", media: [{ id: midia.id }] });

    await page.goto(url(id));

    await expect(page.getByRole("navigation", { name: "Menu principal" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Postagem", exact: true })).toBeVisible();
    await expect(page.getByText("Você pode ver esta postagem, mas não editar.")).toBeVisible();
    await expect(page.getByLabel("Legenda")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /salvar rascunho/i })).toHaveCount(0);
  });

  test("a que falhou mostra a causa, mas não as saídas", async ({ page }) => {
    const midia = await criarMidia({ width: 1080, height: 1350 });
    const id = await semearPostagem({ status: "FALHOU", failureCause: "RATE_LIMITED", media: [{ id: midia.id }] });

    await page.goto(url(id));

    await expect(page.getByRole("heading", { name: "A publicação não saiu" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reagendar" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Voltar para rascunho" })).toHaveCount(0);
  });
});

/** Escolhe a primeira imagem do acervo pela folha do quadrado de adicionar. */
async function escolherDoAcervo(page: Page): Promise<void> {
  await page.getByRole("main").getByRole("button", { name: "Adicionar imagem" }).click();
  await page.getByRole("menuitem", { name: "Do acervo" }).click();

  const folha = page.getByRole("dialog");
  await folha.getByRole("listitem").first().getByRole("button").click();
  await folha.getByRole("button", { name: /^usar/i }).click();
  await expect(folha).toHaveCount(0);
}

/**
 * O minuto corrente no fuso da conta (Brasília). Perto da virada do minuto, espera
 * o próximo: a API recusa minuto já passado, e o clique pode cair no seguinte.
 */
async function minutoCorrenteEmBrasilia(): Promise<{ day: string; time: string }> {
  if (new Date().getSeconds() > 45) await new Promise((resolve) => setTimeout(resolve, 16_000));

  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((parte) => [parte.type, parte.value]),
  );

  return { day: `${partes["year"]}-${partes["month"]}-${partes["day"]}`, time: `${partes["hour"]}:${partes["minute"]}` };
}
