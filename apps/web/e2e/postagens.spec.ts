import { expect, test } from "@playwright/test";
import { createAccount, resetAccounts } from "./support/accounts-db";
import { salvarComoOutraPessoa } from "./support/posts-db";
import { ESTADO_SUPER_ADMIN } from "./support/estado";
import { criarMidia } from "./support/media-db";
import { imagemDe } from "./support/imagem";

/**
 * Compor uma postagem pela tela (RF-C01, RF-C03, RF-C12).
 *
 * O que só o navegador prova: que os contadores acompanham o que se digita, que
 * o caminho de criar leva à composição, e — o mais importante — que o aviso de
 * conflito **não apaga o que a pessoa escreveu**.
 */
test.describe("postagens", () => {
  test.use({ storageState: ESTADO_SUPER_ADMIN });

  const CONTA = "loja.aurora";

  /*
   * Tudo dentro de `main`. A barra inferior existe no HTML nos dois tamanhos de
   * tela — só o CSS a esconde no computador —, e o botão "+" dela tem o mesmo
   * nome acessível do link da página: sem este recorte, o locator casa com dois
   * elementos e o Playwright recusa.
   */
  const conteudo = (page: import("@playwright/test").Page) => page.getByRole("main");

  test.beforeEach(async ({ page }) => {
    await resetAccounts();
    await createAccount({ username: CONTA, name: "Loja Aurora" });
    await page.goto(`/c/${CONTA}/postagens`);
  });

  test("sem postagem nenhuma, a tela convida a criar a primeira", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Postagens" })).toBeVisible();
    await expect(page.getByText("Nenhuma postagem ainda")).toBeVisible();
    await expect(conteudo(page).getByRole("link", { name: /nova postagem/i })).toBeVisible();
  });

  /*
   * A tela de nova postagem **é** a composição (artboard `ComposicaoDesktop`):
   * formato, mídia, legenda e prévia, sem passo intermediário. A postagem só
   * nasce no banco quando se salva — senão cada visita a este endereço deixaria
   * um rascunho vazio para trás.
   */
  test("a tela de nova postagem já é a composição, com a prévia", async ({ page }) => {
    await conteudo(page).getByRole("link", { name: /nova postagem/i }).click();

    await expect(page.getByRole("heading", { name: "Nova postagem" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Formato" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Mídia" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Legenda" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Prévia" })).toBeVisible();
    // `exact` porque getByText é insensível a maiúsculas: sem ele, "Rascunho" da
    // pílula casa também com o botão "Salvar rascunho".
    await expect(page.getByText("Rascunho", { exact: true })).toBeVisible();
  });

  test("a prévia acompanha a legenda enquanto se digita", async ({ page }) => {
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await expect(page.getByText("A legenda aparece aqui")).toBeVisible();
    await page.getByLabel("Legenda").fill("Um dia bonito na loja");

    /*
     * Sem contar ocorrências na página: o destaque de hashtags e menções desenha uma
     * cópia do texto atrás do campo. O que se prova é a prévia trocando o exemplo
     * pela legenda — ela vem depois do formulário, por isso o `last()`.
     */
    await expect(page.getByLabel("Legenda")).toHaveValue("Um dia bonito na loja");
    await expect(page.getByText("A legenda aparece aqui")).toHaveCount(0);
    await expect(page.getByText("Um dia bonito na loja").last()).toBeVisible();
    await expect(page.getByText("Sem imagem ainda")).toBeVisible();
  });

  test("salvar na tela nova cria a postagem e leva para o endereço dela", async ({ page }) => {
    await page.goto(`/c/${CONTA}/postagens/nova`);
    await page.getByLabel("Legenda").fill("Um dia bonito na loja");
    await page.getByRole("button", { name: /salvar rascunho/i }).click();

    await expect(page).toHaveURL(new RegExp(`/c/${CONTA}/postagens/[0-9a-f-]+$`));
    await expect(page.getByLabel("Legenda")).toHaveValue("Um dia bonito na loja");
  });

  /*
   * A pergunta que motivou esta parte: "consigo enviar as imagens para o
   * Acervo, mas quando que uso?" — até 21/09/2026, nunca.
   *
   * O envio em si não roda aqui: o arquivo vai do navegador direto ao MinIO,
   * com política assinada e CORS, e isso é roteiro manual (docs/12, V-15). A
   * mídia é semeada no banco, e o que se prova é o que vem depois.
   */
  test("dá para escolher uma imagem do acervo na composição", async ({ page }) => {
    await criarMidia({ width: 1080, height: 1080 });
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await expect(page.getByText("Sem imagem ainda")).toBeVisible();
    await escolherDoAcervo(page);

    // A prévia passa a mostrar a imagem…
    await expect(page.getByText("Sem imagem ainda")).toHaveCount(0);
    // …e a tela continua sendo "Nova postagem": escolher não cria nada.
    await expect(page.getByRole("heading", { name: "Nova postagem" })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/c/${CONTA}/postagens/nova$`));
  });

  test("a imagem escolhida é anexada quando se salva", async ({ page }) => {
    await criarMidia({ width: 1080, height: 1080 });
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await page.getByLabel("Legenda").fill("Com foto");
    await escolherDoAcervo(page);
    await page.getByRole("button", { name: /salvar rascunho/i }).click();

    await expect(page).toHaveURL(new RegExp(`/c/${CONTA}/postagens/[0-9a-f-]+$`));
    // A postagem existe com a imagem: o botão de ir para a revisão libera.
    await expect(page.getByRole("button", { name: /continuar para revisão/i })).toBeEnabled();
  });

  /*
   * As incompatíveis aparecem, e desde 22/09/2026 com saída: quem enviou uma
   * arte 9:16 e compõe para o feed não perde a imagem — o card vira a porta do
   * ajuste (ADR 0025). Antes disso ele ficava apagado e inerte.
   */
  test("no acervo, a imagem que não serve ao formato oferece o ajuste", async ({ page }) => {
    await criarMidia({ width: 1080, height: 1920 });
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await abrirMenuDeMidia(page);
    await page.getByRole("menuitem", { name: "Do acervo" }).click();

    const folha = page.getByRole("dialog");
    await expect(folha.getByText(/ajustar para Feed/i)).toBeVisible();
    await expect(folha.getByRole("listitem").first().getByRole("button")).toBeEnabled();
  });

  /*
   * O ajuste é **irmão** do acervo, não filho: aninhar duas folhas do Radix faz
   * a de fora arrancar o foco da de dentro ao fechar.
   *
   * E o que mais custaria caro: pedir o ajuste de uma **não pode** perder o que
   * já estava escolhido. A folha zera a seleção ao fechar, então quem sai por
   * aqui precisa confirmar antes.
   *
   * ⚠️ **O ajuste em si não roda no Playwright**: a mídia semeada não tem objeto
   * no MinIO, e o canvas precisa dos pixels de verdade. Recortar e enviar é
   * roteiro manual (docs/12), como o envio. O que se prova aqui é a navegação.
   */
  test("pedir o ajuste troca de folha sem perder o que já foi escolhido", async ({ page }) => {
    // A mais nova vem primeiro na grade: a quadrada é a de índice 0.
    await criarMidia({ width: 1080, height: 1920 });
    await criarMidia({ width: 1080, height: 1080 });
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await abrirMenuDeMidia(page);
    await page.getByRole("menuitem", { name: "Do acervo" }).click();

    const acervo = page.getByRole("dialog", { name: "Escolher do acervo" });
    await acervo.getByRole("listitem").nth(0).getByRole("button").click();
    await acervo.getByRole("listitem").nth(1).getByRole("button").click();

    await expect(page.getByRole("dialog", { name: "Ajustar imagem" })).toBeVisible();
    await expect(acervo).toHaveCount(0);
    // A quadrada foi anexada mesmo sem ninguém clicar em "Usar".
    await expect(page.getByText("Sem imagem ainda")).toHaveCount(0);
  });

  /*
   * O guarda-costas de uma decisão que vive só em classes: o acervo é folha
   * colada embaixo no celular e caixa centrada no computador, sem JavaScript de
   * breakpoint. Um `md:right-auto` esquecido deixa a "caixa centrada" grudada
   * nas duas bordas, e nada além desta medida perceberia.
   */
  test("o acervo é folha embaixo no celular e caixa centrada no computador", async ({ page, isMobile }) => {
    await criarMidia({ width: 1080, height: 1080 });
    await page.goto(`/c/${CONTA}/postagens/nova`);
    await abrirMenuDeMidia(page);
    await page.getByRole("menuitem", { name: "Do acervo" }).click();

    const caixa = await page.getByRole("dialog").boundingBox();
    const tela = page.viewportSize();
    expect(caixa).not.toBeNull();
    expect(tela).not.toBeNull();

    if (isMobile === true) {
      expect(caixa!.x).toBe(0);
      expect(Math.round(caixa!.y + caixa!.height)).toBe(tela!.height);
    } else {
      expect(caixa!.x).toBeGreaterThan(0);
      expect(Math.abs(caixa!.x + caixa!.width / 2 - tela!.width / 2)).toBeLessThan(2);
    }
  });

  /*
   * A seção de mídia trocou dois botões soltos por um quadrado pontilhado que
   * fecha a faixa — o "próximo lugar", em vez de um controle sem relação visual
   * com as miniaturas.
   */
  test("o quadrado de adicionar é a única porta, mesmo sem imagem nenhuma", async ({ page }) => {
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await expect(conteudo(page).getByRole("button", { name: "Adicionar imagem" })).toBeVisible();
    // Os dois botões que ele substituiu não existem mais.
    await expect(page.getByRole("button", { name: /escolher do acervo/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /enviar nova/i })).toHaveCount(0);
  });

  test("o quadrado oferece as duas portas", async ({ page }) => {
    await page.goto(`/c/${CONTA}/postagens/nova`);
    await abrirMenuDeMidia(page);

    await expect(page.getByRole("menuitem", { name: "Do acervo" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Enviar nova" })).toBeVisible();
  });

  /*
   * O teste que pega o defeito conhecido do Radix: sem `modal={false}` e sem o
   * `onCloseAutoFocus`, o menu ao fechar arranca o foco do diálogo que acabou de
   * abrir, e o Escape não chega nele.
   */
  test("o acervo abre num diálogo e o Escape fecha", async ({ page }) => {
    await criarMidia({ width: 1080, height: 1080 });
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await abrirMenuDeMidia(page);
    await page.getByRole("menuitem", { name: "Do acervo" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Desistir não anexa nada.
    await expect(page.getByText("Sem imagem ainda")).toBeVisible();
  });

  /*
   * A corrente inteira do "Enviar nova": o item do menu chama o handle
   * imperativo do UploadField, e o clique no input precisa acontecer **dentro**
   * da ativação do usuário — adiá-lo falharia no Safari.
   *
   * O envio de verdade não roda aqui (MinIO e CORS, roteiro manual do V-15). O
   * que se prova é que nada sobe antes de a pessoa confirmar.
   */
  test("'Enviar nova' abre o seletor, e a imagem é confirmada antes de subir", async ({ page }) => {
    await page.goto(`/c/${CONTA}/postagens/nova`);
    await abrirMenuDeMidia(page);

    const [seletor] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("menuitem", { name: "Enviar nova" }).click(),
    ]);
    await seletor.setFiles({
      name: "quadrada.jpg",
      mimeType: "image/jpeg",
      buffer: imagemDe(1080, 1080),
    });

    await expect(conteudo(page).getByRole("img", { name: /prévia da imagem escolhida/i })).toBeVisible();
    await expect(conteudo(page).getByRole("button", { name: /usar esta imagem/i })).toBeVisible();
    // E nada subiu: a faixa continua vazia e a prévia, sem imagem.
    await expect(page.getByText("Sem imagem ainda")).toBeVisible();
  });

  /*
   * A regra 10 pelo lado da composição: aqui "enviar como está" seria um beco —
   * o arquivo entraria no acervo e a API recusaria anexá-lo. Recortar continua
   * sendo oferta, com a saída de escolher outra sempre ao lado.
   */
  test("na composição, a imagem que não cabe oferece recortar, nunca enviar assim", async ({ page }) => {
    await page.goto(`/c/${CONTA}/postagens/nova`);
    await abrirMenuDeMidia(page);

    const [seletor] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("menuitem", { name: "Enviar nova" }).click(),
    ]);
    await seletor.setFiles({
      name: "em-pe.jpg",
      mimeType: "image/jpeg",
      buffer: imagemDe(1512, 2016),
    });

    await expect(conteudo(page).getByRole("img", { name: /prévia da imagem escolhida/i })).toBeVisible();
    await expect(conteudo(page).getByRole("button", { name: /ajustar para feed/i })).toBeVisible();
    await expect(conteudo(page).getByRole("button", { name: /escolher outra/i })).toBeVisible();
    await expect(conteudo(page).getByRole("button", { name: /enviar como está/i })).toHaveCount(0);
  });

  /*
   * Carrossel (RF-C04; ADR 0024). Não é formato, é quantidade: a segunda imagem
   * é que o cria, e a ordem decide qual delas recorta todas as outras.
   */
  test("dá para escolher três imagens de uma vez, e elas ficam na ordem", async ({ page }) => {
    for (let i = 0; i < 3; i += 1) await criarMidia({ width: 1080, height: 1080 });
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await escolherDoAcervo(page, 3);

    await expect(page.getByText("3 de 10")).toBeVisible();
    // A prévia virou carrossel: contador, pontinhos e o aviso do recorte.
    await expect(page.getByText("1/3")).toBeVisible();
    await expect(page.getByText(/a primeira imagem define o recorte de todas/i)).toBeVisible();
  });

  test("mover a primeira imagem para depois troca quem manda no recorte", async ({ page }) => {
    for (let i = 0; i < 3; i += 1) await criarMidia({ width: 1080, height: 1080 });
    await page.goto(`/c/${CONTA}/postagens/nova`);
    await escolherDoAcervo(page, 3);

    await conteudo(page).getByRole("button", { name: "Mover a imagem 1 para depois" }).click();

    // O selo "1" agora é de outra imagem — e a de antes virou a 2.
    await expect(conteudo(page).getByRole("button", { name: "Mover a imagem 1 para antes" })).toBeDisabled();
    await expect(conteudo(page).getByRole("button", { name: "Remover a imagem 3" })).toBeVisible();
  });

  /*
   * Arrastar com Pointer Events próprios, sem biblioteca.
   *
   * ⚠️ **Só no computador, e não por preguiça:** num contexto com toque
   * emulado, o `page.mouse` do Playwright não gera evento de ponteiro nenhum —
   * o `pointerdown` simplesmente não acontece, e o teste passaria ou falharia
   * sem relação com o código. O caminho do dedo (segurar 250 ms para não roubar
   * a rolagem da faixa) se confere no aparelho, pelo túnel, e as setas `◀ ▶`
   * são a garantia de que ninguém fica sem reordenar se ele falhar.
   */
  test("arrastar a primeira imagem sobre a segunda troca a ordem", async ({ page, isMobile }) => {
    test.skip(isMobile === true, "O Playwright não emula arrasto por toque; a conferência é manual.");
    for (let i = 0; i < 3; i += 1) await criarMidia({ width: 1080, height: 1080 });
    await page.goto(`/c/${CONTA}/postagens/nova`);
    await escolherDoAcervo(page, 3);

    const faixa = conteudo(page).getByRole("list", { name: "Imagens da postagem" }).getByRole("listitem");
    // O endereço da imagem é a única identidade visível de cada miniatura: as
    // setas e os selos dizem a posição, e continuariam iguais sem arrasto nenhum.
    const antes = await faixa.first().locator("img").getAttribute("src");
    const eraSegunda = await faixa.nth(1).locator("img").getAttribute("src");

    const primeira = await faixa.first().boundingBox();
    const segunda = await faixa.nth(1).boundingBox();
    expect(primeira).not.toBeNull();
    expect(segunda).not.toBeNull();

    await page.mouse.move(primeira!.x + primeira!.width / 2, primeira!.y + 40);
    await page.mouse.down();
    /*
     * Segurar antes de mover. No computador é indiferente — com mouse o arrasto
     * começa na hora —, mas onde o ponteiro é toque, sair do lugar antes dos
     * 250 ms é rolagem da faixa e cancela o arrasto de propósito. Esperar aqui
     * exercita justamente esse gesto.
     */
    await page.waitForTimeout(350);
    // Em dois passos: um salto único não gera o `pointermove` intermediário.
    await page.mouse.move(segunda!.x, segunda!.y + 40);
    await page.mouse.move(segunda!.x + segunda!.width / 2, segunda!.y + 40);
    await page.mouse.up();

    // As duas trocaram de lugar.
    await expect(faixa.first().locator("img")).toHaveAttribute("src", eraSegunda!);
    await expect(faixa.nth(1).locator("img")).toHaveAttribute("src", antes!);
  });

  test("remover uma imagem tira ela da faixa", async ({ page }) => {
    for (let i = 0; i < 3; i += 1) await criarMidia({ width: 1080, height: 1080 });
    await page.goto(`/c/${CONTA}/postagens/nova`);
    await escolherDoAcervo(page, 3);

    await conteudo(page).getByRole("button", { name: "Remover a imagem 2" }).click();

    await expect(page.getByText("2 de 10")).toBeVisible();
    await expect(conteudo(page).getByRole("button", { name: "Remover a imagem 3" })).toHaveCount(0);
  });

  /*
   * Stories não tem `children` na API da Meta: cada mídia é uma publicação. A
   * tela nem oferece a segunda.
   */
  test("em Stories não dá para adicionar a segunda imagem", async ({ page }) => {
    await criarMidia({ width: 1080, height: 1920 });
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await page.getByRole("button", { name: "Stories", exact: true }).click();
    await escolherDoAcervo(page);

    await expect(page.getByText(/stories aceita uma mídia só/i)).toBeVisible();
    await expect(page.getByRole("main").getByRole("button", { name: "Adicionar imagem" })).toHaveCount(0);
  });

  /*
   * O outro jeito de ficar com uma imagem que não serve: escolhê-la para
   * Stories e então trocar para Feed. A imagem já está anexada, e até
   * 22/09/2026 a única saída era removê-la e recomeçar.
   */
  test("trocar de formato oferece ajustar a imagem que deixou de servir", async ({ page }) => {
    await criarMidia({ width: 1080, height: 1920 });
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await page.getByRole("button", { name: "Stories", exact: true }).click();
    await escolherDoAcervo(page);
    await page.getByRole("button", { name: "Feed", exact: true }).click();

    const tarja = conteudo(page).getByRole("button", { name: /ajustar a imagem 1 para Feed/i });
    await expect(tarja).toBeVisible();

    await tarja.click();
    await expect(page.getByRole("dialog", { name: "Ajustar imagem" })).toBeVisible();
  });

  test("mudar para Stories com três imagens é recusado antes de chamar a API", async ({ page }) => {
    for (let i = 0; i < 3; i += 1) await criarMidia({ width: 1080, height: 1080 });
    await page.goto(`/c/${CONTA}/postagens/nova`);
    await escolherDoAcervo(page, 3);

    await page.getByRole("button", { name: "Stories", exact: true }).click();

    await expect(page.getByText(/remova 2 antes de mudar o formato/i)).toBeVisible();
    // O formato não mudou: a prévia continua a do feed.
    await expect(page.getByText("Como vai aparecer no feed")).toBeVisible();
  });

  /*
   * O outro defeito: bastava digitar uma data numa postagem nunca agendada para
   * a tela dizer que o horário tinha sido desmarcado.
   */
  test("o formato muda o que a tela cobra", async ({ page }) => {
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await expect(page.getByText(/proporção de 4:5 a 1\.91:1/i)).toBeVisible();
    await expect(page.getByText(/figurinhas, enquetes/i)).toHaveCount(0);

    await page.getByRole("button", { name: "Stories", exact: true }).click();

    // Stories não tem faixa, e ganha o aviso do RF-C11.
    await expect(page.getByText(/qualquer proporção/i)).toBeVisible();
    await expect(page.getByText(/figurinhas, enquetes/i)).toBeVisible();
    await expect(page.getByText("Como vai aparecer nos Stories")).toBeVisible();
  });

  test("Carrossel e Vídeo de feed deixaram de existir; Reels espera a Fase 2", async ({ page }) => {
    await page.goto(`/c/${CONTA}/postagens/nova`);

    // Carrossel virou quantidade de mídias, e vídeo de feed virou Reels (ADR
    // 0024): os dois saíram da tela, não ficaram apagados.
    for (const sumiu of ["Carrossel", "Vídeo de feed"]) {
      await expect(page.getByRole("button", { name: new RegExp(sumiu, "i") })).toHaveCount(0);
    }

    // Sem `exact`: o nome acessível inclui o selo "Fase 2".
    await expect(page.getByRole("button", { name: /reels/i })).toBeDisabled();
  });

  test("a postagem criada aparece na lista, com o trecho e a situação", async ({ page }) => {
    await criarRascunho(page, "Promoção de inverno");
    await page.goto(`/c/${CONTA}/postagens`);

    const item = conteudo(page).getByRole("link", { name: /promoção de inverno/i });
    await expect(item).toBeVisible();
    await expect(item.getByText("Rascunho", { exact: true })).toBeVisible();
  });

  /*
   * Os três contadores do RF-C03. O limite não impede digitar — impede marcar
   * como pronta —, então o que se prova aqui é o aviso, não o bloqueio.
   */
  test("os contadores acompanham a legenda e avisam ao passar do limite", async ({ page }) => {
    await criarRascunho(page, "");

    const legenda = page.getByLabel("Legenda");
    await legenda.fill("Olha isso #sol #mar #praia com @loja.aurora");

    await expect(page.getByText("3 / 30 hashtags")).toBeVisible();
    await expect(page.getByText("1 / 20 menções")).toBeVisible();
    await expect(page.getByText("43 / 2.200 caracteres")).toBeVisible();

    // E-mail não conta como menção: sem essa regra, escrever um contato na
    // legenda daria uma recusa incompreensível.
    await legenda.fill("Fale com contato@empresa.com");
    await expect(page.getByText("0 / 20 menções")).toBeVisible();
  });

  test("sem imagem, não dá para ir para a revisão", async ({ page }) => {
    await criarRascunho(page, "Só texto por enquanto");

    await expect(page.getByRole("button", { name: /continuar para revisão/i })).toBeDisabled();
  });

  // ADR 0026: a Composição só monta; o horário é decisão da Revisão.
  test("a Composição não tem horário, e marcações e colaboradores esperam a Fase 2", async ({ page }) => {
    await page.goto(`/c/${CONTA}/postagens/nova`);

    await expect(page.getByLabel("Data")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Quando publicar" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Marcar pessoas" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Colaboradores" })).toBeVisible();
    await expect(
      page.locator('ol[aria-label="Etapas da postagem"]:visible li[aria-current="step"]'),
    ).toContainText("Composição");
  });

  /*
   * RF-C12, o requisito que mais custa se sair errado: quem salva por último
   * não pode perder o que digitou.
   */
  test("no conflito de edição, o texto digitado continua na tela", async ({ page }) => {
    const postId = await criarRascunho(page, "Versão original");

    // Outra pessoa salva primeiro — aqui, direto pela API interna, que é o
    // equivalente a outra aba com a postagem aberta.
    await salvarComoOutraPessoa(postId, "Mexida por outra pessoa");

    const legenda = page.getByLabel("Legenda");
    await legenda.fill("O que eu estava escrevendo");
    await page.getByRole("button", { name: /salvar rascunho/i }).click();

    // Dentro de `main`: o anunciador de rotas do Next também tem role="alert".
    await expect(conteudo(page).getByRole("alert")).toContainText(/foi alterada por/i);
    // O ponto do requisito: o texto não foi embora.
    await expect(legenda).toHaveValue("O que eu estava escrevendo");
    await expect(page.getByRole("button", { name: /descartar minhas alterações/i })).toBeVisible();
  });

  /*
   * Descartar traz o texto de **quem salvou antes**, não o desta tela: o valor
   * certo é o que está no servidor agora. Trazer de volta a legenda de quando a
   * tela carregou seria restaurar justamente a versão que acabou de ficar velha.
   */
  test("descartar as alterações traz o texto de quem salvou antes", async ({ page }) => {
    const postId = await criarRascunho(page, "Versão original");
    await salvarComoOutraPessoa(postId, "Mexida por outra pessoa");

    await page.getByLabel("Legenda").fill("O que eu estava escrevendo");
    await page.getByRole("button", { name: /salvar rascunho/i }).click();
    await page.getByRole("button", { name: /descartar minhas alterações/i }).click();

    await expect(page.getByLabel("Legenda")).toHaveValue("Mexida por outra pessoa");
  });

  test("descartar o rascunho volta para a lista", async ({ page }) => {
    await criarRascunho(page, "Rascunho a descartar");

    await page.getByRole("button", { name: "Descartar" }).click();

    await expect(page).toHaveURL(new RegExp(`/c/${CONTA}/postagens$`));
    await expect(conteudo(page).getByRole("link", { name: /rascunho a descartar/i })).toHaveCount(0);
  });
});

/**
 * Cria um rascunho pela tela e devolve o identificador dele.
 *
 * Salvar é o que cria: a tela de nova postagem não grava nada ao abrir.
 */
/**
 * Escolhe as `quantas` primeiras imagens do acervo, pela folha.
 *
 * Clicar agora **alterna** a seleção em vez de fechar: montar um carrossel de
 * cinco reabrindo a folha cinco vezes seria castigo. Quem fecha é o botão do
 * rodapé.
 */
async function escolherDoAcervo(page: import("@playwright/test").Page, quantas = 1): Promise<void> {
  await abrirMenuDeMidia(page);
  await page.getByRole("menuitem", { name: "Do acervo" }).click();

  const folha = page.getByRole("dialog");
  // Pela lista da grade, e nao por ordinal cego sobre todos os botoes do
  // dialogo: o X de fechar entra naquela contagem, e so nao quebra hoje porque
  // ele e o ultimo no DOM.
  for (let i = 0; i < quantas; i += 1) {
    await folha.getByRole("listitem").nth(i).getByRole("button").click();
  }

  await folha.getByRole("button", { name: /^usar/i }).click();
  await expect(folha).toHaveCount(0);
}

/** Abre o menu do quadrado pontilhado que fecha a faixa de miniaturas. */
async function abrirMenuDeMidia(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("main").getByRole("button", { name: "Adicionar imagem" }).click();
}

async function criarRascunho(page: import("@playwright/test").Page, caption: string): Promise<string> {
  await page.goto(`/c/loja.aurora/postagens/nova`);
  if (caption !== "") await page.getByLabel("Legenda").fill(caption);
  await page.getByRole("button", { name: /salvar rascunho/i }).click();

  await expect(page).toHaveURL(/\/postagens\/[0-9a-f-]+$/);
  return page.url().split("/").pop() as string;
}

