import { expect, test, type Page } from "@playwright/test";
import { createAccount, resetAccounts } from "./support/accounts-db";
import { ESTADO_SUPER_ADMIN } from "./support/estado";
import { criarMidia } from "./support/media-db";
import {
  inscricoesDePush,
  limparAvisos,
  limparPush,
  preferenciaDePush,
  semearAviso,
} from "./support/notifications-db";
import { semearPostagem } from "./support/posts-db";

/**
 * As notificações no Perfil (RF-J02, RF-J04; docs/04, 11.1) e o toque no push.
 *
 * O serviço de push do navegador não existe aqui: o `PushManager` e a permissão
 * são simulados antes de a página carregar. O que se prova é a tela — o estado dito
 * antes do botão, a inscrição chegando à API, o pedido de teste, desativar — e
 * não a entrega, que é roteiro manual (o envio tem teste próprio no Jest).
 */
test.use({ storageState: ESTADO_SUPER_ADMIN });

test.beforeEach(async () => {
  await limparPush();
});

const cartao = (page: Page) => page.getByRole("region", { name: "Notificações" });

/** Simula o navegador: permissão e inscrição, com o estado guardado na própria página. */
async function simularPush(page: Page, permissao: NotificationPermission = "default"): Promise<void> {
  await page.addInitScript((inicial) => {
    let estado = inicial;
    let inscricao: PushSubscription | null = null;
    const endpoint = `https://push.teste/e2e/${Math.random().toString(16).slice(2)}`;

    Object.defineProperty(Notification, "permission", { get: () => estado, configurable: true });
    Notification.requestPermission = () => {
      estado = "granted";
      return Promise.resolve("granted");
    };

    const falsa = {
      endpoint,
      toJSON: () => ({ endpoint, keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } }),
      unsubscribe: () => {
        inscricao = null;
        return Promise.resolve(true);
      },
    } as unknown as PushSubscription;

    PushManager.prototype.subscribe = () => {
      inscricao = falsa;
      return Promise.resolve(falsa);
    };
    PushManager.prototype.getSubscription = () => Promise.resolve(inscricao);
  }, permissao);
}

test("ativar neste aparelho grava a inscrição e já pede o push de teste", async ({ page }) => {
  await simularPush(page);
  await page.goto("/perfil");

  await expect(cartao(page)).toContainText("Desligadas");
  await cartao(page).getByRole("button", { name: "Ativar notificações neste aparelho" }).click();

  await expect(cartao(page)).toContainText("Notificações ativas neste aparelho");
  await expect(cartao(page).getByRole("status")).toContainText("notificação de teste chega");
  await expect.poll(inscricoesDePush).toEqual([{ endpoint: expect.stringContaining("push.teste/e2e/"), testePendente: true }]);
});

test("desativar tira a inscrição da API e volta a oferecer o botão", async ({ page }) => {
  await simularPush(page);
  await page.goto("/perfil");
  await cartao(page).getByRole("button", { name: "Ativar notificações neste aparelho" }).click();
  await expect(cartao(page)).toContainText("Notificações ativas neste aparelho");

  await cartao(page).getByRole("button", { name: "Desativar neste aparelho" }).click();

  await expect(cartao(page).getByRole("button", { name: "Ativar notificações neste aparelho" })).toBeVisible();
  await expect.poll(inscricoesDePush).toEqual([]);
});

test("permissão bloqueada diz como liberar, sem botão que não funcionaria", async ({ page }) => {
  await simularPush(page, "denied");
  await page.goto("/perfil");

  await expect(cartao(page)).toContainText("bloqueadas neste navegador");
  await expect(cartao(page).getByRole("button", { name: /ativar/i })).toHaveCount(0);
});

test("desligar um tipo vale depois de recarregar, e religar volta", async ({ page }) => {
  await page.goto("/perfil");
  const interruptor = cartao(page).getByRole("switch", { name: "Postagem aguardando aprovação" });
  await expect(interruptor).toHaveAttribute("aria-checked", "true");

  await interruptor.click();
  await expect(interruptor).toHaveAttribute("aria-checked", "false");
  // O interruptor responde no toque; recarregar antes de a ação gravar testaria a corrida, não a escolha.
  await expect.poll(() => preferenciaDePush("AGUARDANDO_APROVACAO")).toBe(false);
  await page.reload();
  await expect(interruptor).toHaveAttribute("aria-checked", "false");
  // Os outros continuam ligados: a escolha é por tipo.
  await expect(cartao(page).getByRole("switch", { name: "Publicação que falhou" })).toHaveAttribute(
    "aria-checked",
    "true",
  );

  await interruptor.click();
  await expect(interruptor).toHaveAttribute("aria-checked", "true");
  await expect.poll(() => preferenciaDePush("AGUARDANDO_APROVACAO")).toBe(true);
});

test("o cartão de instalação diz o caminho do sistema", async ({ page, isMobile }) => {
  await page.goto("/perfil");
  const instalar = page.getByRole("region", { name: "Instalar o PostIt" });

  // O "celular" do Playwright é um Pixel: Android.
  await expect(instalar).toContainText(isMobile ? "Instalar app" : "ícone de instalar");
});

/*
 * O toque no push: o link é só /notificacoes/<id>, sem nome de conta. A página
 * marca como lido e leva à postagem — como tocar na linha do sino.
 */
test("o link do push abre o aviso, marca como lido e leva à postagem", async ({ page }) => {
  await resetAccounts();
  await limparAvisos();
  await createAccount({ username: "loja.aurora", name: "Loja Aurora" });
  const midia = await criarMidia({ width: 1080, height: 1350 });
  const postagem = await semearPostagem({ status: "FALHOU", failureCause: "TOKEN_INVALID", media: [{ id: midia.id }] });
  const aviso = await semearAviso({ type: "PUBLICACAO_FALHOU", target: { post: postagem }, to: "e2e-setup-super" });

  await page.goto(`/notificacoes/${aviso}`);

  await expect(page).toHaveURL(new RegExp(`/c/loja\\.aurora/postagens/${postagem}$`));
  await page.goto("/notificacoes");
  await expect(page.getByText("Tudo lido")).toBeVisible();
});
