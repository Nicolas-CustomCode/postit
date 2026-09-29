import { callTool, connectAssistant, type ConnectedAssistant } from "../common/testing/assistant";
import { createTestAccount, type TestAccount } from "../common/testing/factories";
import { bootTestApp, type TestApp } from "../common/testing/test-app";

/**
 * As ferramentas do assistente (ADR 0029, docs/16), pelo `/mcp` e com o token do
 * fluxo OAuth de verdade: compor rascunho, e mais nada.
 */
describe("ferramentas do assistente", () => {
  let api: TestApp;
  let assistente: ConnectedAssistant;
  let conta: TestAccount;
  let fotoFeed: string;
  let fotoStories: string;

  beforeAll(async () => {
    api = await bootTestApp();
  });
  afterAll(() => api.close());
  beforeEach(async () => {
    await api.reset();
    conta = await createTestAccount(api.db, api.config.encryptionKey, { username: "loja.aurora" });
    assistente = await connectAssistant(api);
    fotoFeed = await midia(1080, 1350);
    fotoStories = await midia(1080, 1920);
  });

  /** Uma imagem do acervo, só a linha: nada aqui lê o arquivo. */
  async function midia(width: number, height: number): Promise<string> {
    const linha = await api.db.media.create({
      data: {
        objectKey: `publicas/postagens/${Math.random().toString(16).slice(2, 12)}.jpg`,
        mimeType: "image/jpeg",
        bytes: 500_000,
        width,
        height,
        sha256: "c".repeat(64),
      },
    });
    return linha.id;
  }

  const chamar = (nome: string, args: Record<string, unknown> = {}) =>
    callTool(api, assistente.accessToken, nome, args);

  function criar(args: Record<string, unknown> = {}) {
    return chamar("criar_rascunho", {
      conta: "@loja.aurora",
      formato: "FEED",
      legenda: "Chegou a coleção de primavera",
      imagens: [{ id: fotoFeed, textoAlternativo: "Vestido amarelo no cabide" }],
      ...args,
    });
  }

  it("cria o rascunho com imagens e texto alternativo, marcado como do assistente", async () => {
    const resultado = await criar();
    expect(resultado.isError).toBe(false);
    expect(resultado.data).toMatchObject({
      conta: "@loja.aurora",
      formato: "FEED",
      status: "Rascunho",
      versao: 2,
      legenda: "Chegou a coleção de primavera",
      imagens: [{ id: fotoFeed, textoAlternativo: "Vestido amarelo no cabide" }],
      pendencias: [],
    });
    expect(resultado.data["link"]).toMatch(/\/c\/loja\.aurora\/postagens\//);

    const post = await api.db.post.findUniqueOrThrow({ where: { id: resultado.data["id"] as string } });
    expect(post).toMatchObject({ origin: "ASSISTANT", createdById: assistente.userId, status: "DRAFT" });

    // A tela da conta vê o rascunho com a marca.
    const lista = await api.request({
      method: "GET",
      url: `/accounts/${conta.id}/posts`,
      token: assistente.sessionToken,
    });
    expect(lista.body).toEqual([expect.objectContaining({ id: post.id, origin: "ASSISTANT" })]);
  });

  it("imagem 9:16 no Feed entra, e a conferência aponta a foto", async () => {
    const resultado = await criar({ imagens: [{ id: fotoFeed }, { id: fotoStories }] });
    expect(resultado.isError).toBe(false);

    const conferencia = await chamar("conferir_rascunho", { id: resultado.data["id"] });
    expect(conferencia.data["pronto"]).toBe(false);
    const pendencias = conferencia.data["pendencias"] as string[];
    expect(pendencias.some((frase) => /foto 2 não serve ao Feed/i.test(frase))).toBe(true);
    // A primeira e a segunda estão sem texto alternativo: avisa, sem barrar.
    expect(pendencias.some((frase) => /Sem texto alternativo: foto 1, 2/.test(frase))).toBe(true);
  });

  it("a pessoa reordena na tela o rascunho do assistente com a foto que não serve", async () => {
    const criado = await criar({ imagens: [{ id: fotoFeed }, { id: fotoStories }] });
    const resposta = await api.request({
      method: "POST",
      url: `/accounts/${conta.id}/posts/${criado.data["id"] as string}/media`,
      token: assistente.sessionToken,
      payload: { version: 2, media: [{ mediaId: fotoStories }, { mediaId: fotoFeed }] },
    });
    expect(resposta.statusCode).toBe(200);

    // E a revisão continua barrada até o ajuste.
    const envio = await api.request({
      method: "POST",
      url: `/accounts/${conta.id}/posts/${criado.data["id"] as string}/submit`,
      token: assistente.sessionToken,
      payload: { version: 3 },
    });
    expect(envio.statusCode).toBe(422);
  });

  it("na postagem da tela, a mesma foto continua recusada", async () => {
    const criada = await api.request({
      method: "POST",
      url: `/accounts/${conta.id}/posts`,
      token: assistente.sessionToken,
      payload: { format: "FEED" },
    });
    const resposta = await api.request({
      method: "POST",
      url: `/accounts/${conta.id}/posts/${criada.body["id"] as string}/media`,
      token: assistente.sessionToken,
      payload: { version: 1, media: [{ mediaId: fotoStories }] },
    });
    expect(resposta.statusCode).toBe(422);
    expect(resposta.body["code"]).toBe("MEDIA_RATIO_UNSUPPORTED");
  });

  it("conta desconhecida e imagem fora do acervo são recusadas sem criar nada", async () => {
    const semConta = await criar({ conta: "@nao.existe" });
    expect(semConta).toMatchObject({ isError: true });
    expect(semConta.text).toMatch(/@nao\.existe não está conectada/);

    const semImagem = await criar({ imagens: [{ id: fotoFeed }, { id: "0199a000-0000-7000-8000-000000000000" }] });
    expect(semImagem.isError).toBe(true);
    expect(semImagem.text).toMatch(/imagem 2 não está no acervo/);

    const doisNoStories = await criar({ formato: "STORIES", imagens: [{ id: fotoStories }, { id: fotoStories }] });
    expect(doisNoStories.isError).toBe(true);

    expect(await api.db.post.count()).toBe(0);
  });

  it("edita legenda e troca Feed por Stories com a imagem certa, encadeando a versão", async () => {
    const criado = await criar();
    const editado = await chamar("editar_rascunho", {
      id: criado.data["id"],
      versao: criado.data["versao"],
      formato: "STORIES",
      imagens: [{ id: fotoStories, textoAlternativo: "Vitrine à noite" }],
      legenda: "Nova vitrine",
    });
    expect(editado.isError).toBe(false);
    expect(editado.data).toMatchObject({ formato: "STORIES", legenda: "Nova vitrine", versao: 5, pendencias: [] });
  });

  it("versão velha vira a explicação do conflito", async () => {
    const criado = await criar();
    await chamar("editar_rascunho", { id: criado.data["id"], versao: 2, legenda: "Primeira" });

    const velho = await chamar("editar_rascunho", { id: criado.data["id"], versao: 2, legenda: "Segunda" });
    expect(velho.isError).toBe(true);
    expect(velho.text).toMatch(/Leia de novo com ver_rascunho/);
  });

  it("rascunho enviado para revisão fica com a pessoa: editar recusa e o status não muda", async () => {
    const criado = await criar();
    const id = criado.data["id"] as string;
    await api.request({
      method: "POST",
      url: `/accounts/${conta.id}/posts/${id}/submit`,
      token: assistente.sessionToken,
      payload: { version: 2 },
    });

    const edicao = await chamar("editar_rascunho", { id, versao: 3, legenda: "Mudança tardia" });
    expect(edicao.isError).toBe(true);
    expect(edicao.text).toMatch(/em revisão/);
    expect(await api.db.post.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "IN_REVIEW", version: 3 });

    // E a lista mostra onde ele está.
    const lista = await chamar("listar_meus_rascunhos");
    expect(lista.data["rascunhos"]).toEqual([expect.objectContaining({ id, status: "Em revisão" })]);
  });

  it("rascunho da tela e rascunho de outra pessoa são inalcançáveis", async () => {
    const daTela = await api.request({
      method: "POST",
      url: `/accounts/${conta.id}/posts`,
      token: assistente.sessionToken,
      payload: { format: "FEED", caption: "Feito à mão" },
    });

    const outro = await connectAssistant(api);
    const deOutro = await callTool(api, outro.accessToken, "criar_rascunho", { conta: "loja.aurora", formato: "FEED" });

    for (const id of [daTela.body["id"], deOutro.data["id"]]) {
      expect(await chamar("ver_rascunho", { id })).toMatchObject({ isError: true });
      const edicao = await chamar("editar_rascunho", { id, versao: 1, legenda: "invadido" });
      expect(edicao.text).toMatch(/não encontrado/);
    }
    expect((await chamar("listar_meus_rascunhos")).data["rascunhos"]).toEqual([]);
  });

  it("o acervo mostra os formatos que cada imagem aceita", async () => {
    const acervo = await chamar("listar_acervo");
    const imagens = acervo.data["imagens"] as { id: string; serveA: string[] }[];
    expect(imagens.find((imagem) => imagem.id === fotoFeed)?.serveA).toContain("FEED");
    expect(imagens.find((imagem) => imagem.id === fotoStories)?.serveA).toEqual(["STORIES"]);
  });
});
