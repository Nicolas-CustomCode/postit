import { expect, test, type Page } from "@playwright/test";
import { createAccount, resetAccounts } from "./support/accounts-db";
import { ESTADO_APROVADOR, ESTADO_COMUM, ESTADO_EDITOR, ESTADO_SUPER_ADMIN } from "./support/estado";
import { criarMidia } from "./support/media-db";
import { semearPostagem, type PostagemSemeada } from "./support/posts-db";

/**
 * A revisão com papéis de verdade (ADR 0026; docs/15): quem só edita envia, quem
 * aprova decide, quem só vê comenta. Cada papel é um usuário da preparação, com as
 * permissões no banco — as mesmas que a API confere a cada requisição.
 *
 * As postagens semeadas são do **editor**: aprovar a própria exige
 * `POSTAGEM_APROVAR_PROPRIA`, e a autoaprovação não é o assunto aqui (tem teste no
 * Jest).
 */
const CONTA = "loja.aurora";
const url = (id: string) => `/c/${CONTA}/postagens/${id}`;

test.beforeEach(async () => {
  await resetAccounts();
  await createAccount({ username: CONTA, name: "Loja Aurora" });
});

/** Uma postagem do editor, já enviada para revisão por ele. */
async function doEditor(extra: Partial<PostagemSemeada> = {}): Promise<string> {
  const midia = await criarMidia({ width: 1080, height: 1350 });
  return semearPostagem({
    status: "EM_REVISAO",
    author: "e2e-setup-editor",
    media: [{ id: midia.id, altText: "Três copos de cold brew" }],
    decisions: [{ action: "ENVIOU_REVISAO" }],
    ...extra,
  });
}

/** A etapa atual no indicador do topo — só a lista visível conta. */
function etapaAtual(page: Page) {
  return page.locator('ol[aria-label="Etapas da postagem"]:visible li[aria-current="step"]');
}

const cartao = (page: Page) => page.getByRole("region", { name: "Situação da postagem" });

test.describe("quem só edita", () => {
  test.use({ storageState: ESTADO_EDITOR });

  test("envia para revisão — e não vê como aprovar", async ({ page }) => {
    await criarMidia({ width: 1080, height: 1350 });
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await page.getByRole("main").getByRole("button", { name: "Adicionar imagem" }).click();
    await page.getByRole("menuitem", { name: "Do acervo" }).click();
    const folha = page.getByRole("dialog");
    await folha.getByRole("listitem").first().getByRole("button").click();
    await folha.getByRole("button", { name: /^usar/i }).click();

    // Quem não aprova "envia"; "continuar" é de quem vai decidir na etapa 2.
    await expect(page.getByRole("button", { name: "Continuar para revisão" })).toHaveCount(0);
    await page.getByRole("button", { name: "Enviar para revisão" }).click();

    await expect(page).toHaveURL(/\/postagens\/[0-9a-f-]+$/);
    await expect(etapaAtual(page)).toContainText("Revisão");
    await expect(page.getByRole("heading", { name: "Aguardando aprovação" })).toBeVisible();
    await expect(page.getByRole("button", { name: /aprovar/i })).toHaveCount(0);
    await expect(page.getByText(/Quem aprova escolhe o dia e a hora/)).toBeVisible();
    await expect(page.getByText(/Enviada para revisão/).first()).toBeVisible();
  });
});

test.describe("quem aprova e agenda", () => {
  test.use({ storageState: ESTADO_SUPER_ADMIN });

  test("reprova com motivo, e o autor encontra o motivo na composição", async ({ page, browser }) => {
    const id = await doEditor();
    await page.goto(url(id));

    await page.getByRole("button", { name: "Reprovar com motivo" }).click();
    // RF-E03: sem motivo não se reprova.
    const reprovar = page.getByRole("button", { name: "Reprovar", exact: true });
    await expect(reprovar).toBeDisabled();
    await page.getByLabel("Motivo da reprovação").fill("A foto 2 está escura; troque pela versão com mais luz.");
    await reprovar.click();

    // Voltou para rascunho: a etapa 1, e a decisão na linha do tempo.
    await expect(etapaAtual(page)).toContainText("Composição");

    // Quem escreveu abre e vê o motivo no topo, antes de mexer em qualquer coisa.
    const autor = await browser.newContext({ storageState: ESTADO_EDITOR });
    const pagina = await autor.newPage();
    await pagina.goto(url(id));
    await expect(pagina.getByRole("status").filter({ hasText: "Reprovada por" })).toContainText(
      "A foto 2 está escura; troque pela versão com mais luz.",
    );
    await expect(pagina.getByLabel("Legenda")).toBeVisible();
    await autor.close();
  });

  test("cancelar o agendamento deixa a postagem aprovada, sem horário", async ({ page }) => {
    const id = await doEditor({
      status: "AGENDADO",
      // Longe no futuro: o worker dos testes não pode despachar no meio do teste.
      scheduledAt: new Date(Date.now() + 24 * 60 * 60_000),
      decisions: [{ action: "ENVIOU_REVISAO" }, { action: "APROVOU" }],
    });
    await page.goto(url(id));
    await expect(cartao(page).getByText("Sai em", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Cancelar agendamento" }).click();
    await expect(page.getByText(/A postagem continua aprovada/)).toBeVisible();
    await page.getByRole("button", { name: "Cancelar agendamento" }).click();

    await expect(page.getByRole("heading", { name: "Aprovada — falta agendar" })).toBeVisible();
    await expect(page.getByText(/Agendamento cancelado/).first()).toBeVisible();
  });

  test("editar uma agendada pede confirmação e volta para a composição", async ({ page }) => {
    const id = await doEditor({
      status: "AGENDADO",
      scheduledAt: new Date(Date.now() + 24 * 60 * 60_000),
      decisions: [{ action: "ENVIOU_REVISAO" }, { action: "APROVOU" }],
    });
    await page.goto(url(id));

    await page.getByRole("button", { name: "Editar" }).click();
    await expect(page.getByText(/volta para rascunho e passa pela revisão de novo/)).toBeVisible();
    await page.getByRole("button", { name: "Voltar para a composição" }).click();

    await expect(etapaAtual(page)).toContainText("Composição");
    await expect(page.getByLabel("Legenda")).toBeVisible();
  });

  /*
   * No celular a barra de navegação some nesta página (ADR 0026), e a decisão fica
   * fixa no rodapé — visível sem rolar até depois dos comentários.
   */
  test("no celular, a decisão fica no rodapé, no lugar da barra", async ({ page, isMobile }) => {
    test.skip(isMobile !== true, "o rodapé fixo é do celular");
    const id = await doEditor();
    await page.goto(url(id));

    await expect(page.getByRole("navigation", { name: "Menu principal" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Aprovar e agendar" })).toBeInViewport();
    await expect(page.getByRole("button", { name: "Reprovar com motivo" })).toBeInViewport();
  });
});

test.describe("quem aprova e não agenda", () => {
  test.use({ storageState: ESTADO_APROVADOR });

  test("aprova, e a postagem fica esperando quem agenda", async ({ page }) => {
    const id = await doEditor();
    await page.goto(url(id));

    // Sem permissão de agendar, nem o campo de horário aparece.
    await expect(page.getByLabel("Data")).toHaveCount(0);
    await page.getByRole("button", { name: "Aprovar", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Aprovada — falta agendar" })).toBeVisible();
    await expect(page.getByText("Quem agenda escolhe o horário.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Agendar", exact: true })).toHaveCount(0);
  });
});

test.describe("quem só vê", () => {
  test.use({ storageState: ESTADO_COMUM });

  test("comenta na revisão, sem decidir nada", async ({ page }) => {
    const id = await doEditor();
    await page.goto(url(id));

    await expect(page.getByRole("button", { name: /aprovar|reprovar|voltar para a composição/i })).toHaveCount(0);

    await page.getByLabel("Comentário").fill("O preço entra aqui ou fica para o story?");
    await page.getByRole("button", { name: "Comentar" }).click();

    await expect(page.getByText("O preço entra aqui ou fica para o story?")).toBeVisible();
  });
});
