import { createHash, randomBytes } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { createAccount, resetAccounts } from "./support/accounts-db";
import { ESTADO_COMUM, ESTADO_EDITOR } from "./support/estado";
import { criarMidia } from "./support/media-db";
import { semearPostagem } from "./support/posts-db";

/**
 * A tela de permissão do assistente (ADR 0029): o ChatGPT abre o link, a pessoa
 * confere quem pede e para onde volta, e permite ou recusa.
 *
 * O cliente é registrado pela rota de máquina de verdade (`/oauth/register`, pelo
 * Next). O endereço de retorno é de loopback no próprio servidor de teste: o
 * navegador não sai para a internet, e a página de retorno nem precisa existir —
 * o que se confere é o endereço, com o código ou o erro.
 */
const RETORNO = "http://localhost:3100/retorno-do-assistente";

async function registrarCliente(request: APIRequestContext): Promise<string> {
  const resposta = await request.post("/oauth/register", {
    data: { client_name: "ChatGPT", redirect_uris: [RETORNO] },
  });
  expect(resposta.status()).toBe(201);
  return ((await resposta.json()) as { client_id: string }).client_id;
}

function pedido(clientId: string): string {
  const challenge = createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url");
  return `/oauth/autorizar?${new URLSearchParams({
    client_id: clientId,
    redirect_uri: RETORNO,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "postagens:compor",
    state: "estado-do-teste",
  })}`;
}

test.describe("com POSTAGEM_EDITAR", () => {
  test.use({ storageState: ESTADO_EDITOR });

  test("mostra quem pede e para onde volta, e Permitir devolve o código ao cliente", async ({ page, request }) => {
    await page.goto(pedido(await registrarCliente(request)));

    await expect(
      page.getByRole("heading", { name: "Permitir que o ChatGPT componha rascunhos em seu nome?" }),
    ).toBeVisible();
    await expect(page.getByText("Depois, você volta para localhost:3100.")).toBeVisible();
    await expect(page.getByText("Enviar para revisão, aprovar, agendar ou publicar")).toBeVisible();

    await page.getByRole("button", { name: "Permitir" }).click();
    await page.waitForURL(/\/retorno-do-assistente\?/);
    const retorno = new URL(page.url());
    expect(retorno.searchParams.get("code")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(retorno.searchParams.get("state")).toBe("estado-do-teste");
  });

  test("Recusar devolve access_denied ao cliente", async ({ page, request }) => {
    await page.goto(pedido(await registrarCliente(request)));
    await page.getByRole("button", { name: "Recusar" }).click();

    await page.waitForURL(/\/retorno-do-assistente\?/);
    const retorno = new URL(page.url());
    expect(retorno.searchParams.get("error")).toBe("access_denied");
    expect(retorno.searchParams.get("code")).toBeNull();
  });

  test("cliente desconhecido não redireciona para lugar nenhum", async ({ page }) => {
    await page.goto(pedido("cliente-que-nao-existe"));
    await expect(page.getByRole("heading", { name: "Não foi possível autorizar" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Permitir" })).toBeHidden();
  });
});

test.describe("sem POSTAGEM_EDITAR", () => {
  test.use({ storageState: ESTADO_COMUM });

  test("explica e só oferece recusar", async ({ page, request }) => {
    await page.goto(pedido(await registrarCliente(request)));
    await expect(page.getByText(/não tem a permissão de editar postagens/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Permitir" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Recusar" })).toBeVisible();
  });
});

/**
 * O rascunho que o assistente compôs chega à tela marcado: a pessoa sabe que precisa
 * conferir antes de enviar (ADR 0029).
 */
test.describe("rascunho do assistente", () => {
  test.use({ storageState: ESTADO_EDITOR });
  const CONTA = "loja.aurora";

  test.beforeEach(async () => {
    await resetAccounts();
    await createAccount({ username: CONTA, name: "Loja Aurora" });
  });

  test("aparece marcado na lista e na composição", async ({ page }) => {
    const midia = await criarMidia({ width: 1080, height: 1350 });
    const doAssistente = await semearPostagem({
      status: "RASCUNHO",
      origin: "ASSISTENTE",
      author: "e2e-setup-editor",
      caption: "Composta na conversa",
      media: [{ id: midia.id, altText: "Vestido amarelo" }],
    });
    await semearPostagem({
      status: "RASCUNHO",
      author: "e2e-setup-editor",
      caption: "Composta na tela",
      media: [{ id: midia.id }],
    });

    await page.goto(`/c/${CONTA}/postagens`);
    const lista = page.getByRole("main");
    const itemDoAssistente = lista.getByRole("listitem").filter({ hasText: "Composta na conversa" });
    await expect(itemDoAssistente.getByText("Composta pelo assistente")).toBeVisible();
    const itemDaTela = lista.getByRole("listitem").filter({ hasText: "Composta na tela" });
    await expect(itemDaTela.getByText("Composta pelo assistente")).toHaveCount(0);

    await page.goto(`/c/${CONTA}/postagens/${doAssistente}`);
    await expect(
      page.locator(':text("Composta pelo assistente. Confira antes de enviar para revisão."):visible').first(),
    ).toBeVisible();
  });
});

test.describe("sem sessão", () => {
  test("vai ao login levando o pedido inteiro para voltar depois", async ({ page, request }) => {
    const caminho = pedido(await registrarCliente(request));
    await page.goto(caminho);

    await expect(page).toHaveURL(/\/entrar\?voltar=/);
    // O destino atravessa o login num campo escondido, com a query inteira.
    const voltar = new URL(page.url()).searchParams.get("voltar");
    expect(voltar).toBe(caminho);
    await expect(page.locator('input[name="voltar"]')).toHaveValue(caminho);
  });
});
