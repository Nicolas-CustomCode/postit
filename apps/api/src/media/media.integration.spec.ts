import { IMAGE_MAX_BYTES, type PostStatus } from "@repo/shared";
import { createTestAccount, createTestUser, TEST_PASSWORD, totpCodeFor } from "../common/testing/factories";
import { jpegBytes, pngBytes } from "../common/testing/image-fixtures";
import { bootTestApp, type TestApp } from "../common/testing/test-app";
import { PUBLIC_PREFIX, StorageService } from "../storage/storage.service";

/**
 * Enviar e validar uma imagem, de ponta a ponta (RF-B01, RF-B02).
 *
 * Contra o Postgres e o MinIO de verdade: o que se quer provar é que o arquivo
 * recusado **some** e que o aceito **fica público**, e nenhum dos dois se prova
 * com armazenamento falso.
 *
 * Cobre os testes 3 e 4 do roteiro da Fase 1 (docs/12) — PNG e arquivo grande
 * demais. O teste 5 mudou de sinal: proporção deixou de ser condição de envio
 * (RF-B03), e o bloco "proporção não impede o envio" registra o porquê.
 */
describe("envio de mídia", () => {
  let api: TestApp;
  const IP = "203.0.113.90";

  beforeAll(async () => {
    api = await bootTestApp();
  });
  beforeEach(() => api.reset());
  afterAll(() => api.close());

  /** Entra de verdade — sem atalho, como manda a regra 11. */
  async function entrar(permissions: readonly "POST_EDIT"[] = ["POST_EDIT"]): Promise<string> {
    const user = await createTestUser(api.db, api.config.encryptionKey, { permissions });
    const desafio = await api.request({
      method: "POST",
      url: "/auth/login",
      payload: { email: user.email, password: TEST_PASSWORD },
      ip: IP,
    });
    const sessao = await api.request({
      method: "POST",
      url: "/auth/challenge/verify",
      payload: { token: desafio.body["token"], code: totpCodeFor(user.totpSecret) },
      ip: IP,
    });
    return sessao.body["token"] as string;
  }

  const pedirPermissao = (token: string) =>
    api.request({ method: "POST", url: "/media/upload-policy", token });

  /** Envia ao MinIO como o navegador faria, com os campos assinados. */
  async function enviar(permissao: Record<string, unknown>, corpo: Buffer): Promise<number> {
    const form = new FormData();
    for (const [nome, valor] of Object.entries(permissao["fields"] as Record<string, string>)) {
      form.append(nome, valor);
    }
    // O arquivo por último: é o que o protocolo do S3 exige.
    form.append("file", new Blob([new Uint8Array(corpo)], { type: "image/jpeg" }));

    const resposta = await fetch(permissao["url"] as string, { method: "POST", body: form });
    return resposta.status;
  }

  /** O caminho inteiro: autoriza, envia, confirma. */
  async function enviarEConfirmar(token: string, corpo: Buffer) {
    const permissao = (await pedirPermissao(token)).body;
    expect(await enviar(permissao, corpo)).toBe(204);

    return api.request({
      method: "POST",
      url: "/media/confirm",
      token,
      payload: { ticket: permissao["ticket"] },
    });
  }

  const objetoPublico = async (id: string) => {
    const midia = await api.db.media.findUniqueOrThrow({ where: { id } });
    return midia.objectKey;
  };

  /**
   * Prende a mídia a uma postagem no estado pedido — o que decide se ela pode
   * ser excluída (RF-B07).
   *
   * Escreve direto pelo Prisma: passar pelas rotas de composição exigiria conta
   * conectada, formato compatível e a máquina de estados inteira, para provar
   * algo que é sobre a **linha** em `PostagemMidia`, não sobre como ela nasceu.
   */
  async function anexar(mediaId: string, status: PostStatus): Promise<string> {
    const conta = await createTestAccount(api.db, api.config.encryptionKey, {
      username: `conta.${Math.random().toString(16).slice(2, 8)}`,
    });
    const autor = await createTestUser(api.db, api.config.encryptionKey, {});

    const postagem = await api.db.post.create({
      data: { accountId: conta.id, format: "FEED", status, createdById: autor.id },
    });
    await api.db.postMedia.create({ data: { postId: postagem.id, mediaId, position: 0 } });

    return postagem.id;
  }

  describe("acesso", () => {
    it("recusa quem não está logado", async () => {
      expect((await api.request({ method: "POST", url: "/media/upload-policy" })).statusCode).toBe(401);
    });

    it("recusa quem não pode editar postagens", async () => {
      const token = await entrar([]);
      const resposta = await pedirPermissao(token);

      expect(resposta.statusCode).toBe(403);
      expect(resposta.body).toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("a permissão de envio", () => {
    /*
     * A chave do objeto **vai** para o navegador, e tem de ir: o campo `key` é
     * parte do formulário do S3, é como o MinIO sabe onde gravar. Ela não é
     * segredo nesta etapa — `recebidos/` não é legível de fora.
     *
     * O que não pode sair é o endereço interno (regra 4), e o que o comprovante
     * protege é a **autorização para confirmar**, não o sigilo da chave.
     */
    it("não vaza o endereço interno do armazenamento", async () => {
      const token = await entrar();
      const corpo = JSON.stringify((await pedirPermissao(token)).body);

      expect(corpo).not.toContain("127.0.0.1");
      expect(corpo).not.toContain(new URL(process.env["MINIO_ENDPOINT"] ?? "http://x").host);
    });

    it("traz destino, campos assinados, comprovante e prazo", async () => {
      const token = await entrar();
      const permissao = (await pedirPermissao(token)).body;

      expect(permissao["url"]).toEqual(expect.any(String));
      expect(permissao["ticket"]).toEqual(expect.any(String));
      expect(Object.keys(permissao["fields"] as object)).toEqual(
        expect.arrayContaining(["key", "policy", "x-amz-signature"]),
      );
      expect(new Date(permissao["expiresAt"] as string).getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe("caminho feliz", () => {
    it("um JPEG válido vira Midia em publicas/", async () => {
      const token = await entrar();

      const resposta = await enviarEConfirmar(token, jpegBytes({ width: 1080, height: 1350 }));

      expect(resposta.statusCode).toBe(201);
      expect(resposta.body).toMatchObject({ width: 1080, height: 1350 });

      const chave = await objetoPublico(resposta.body["id"] as string);
      expect(chave.startsWith(PUBLIC_PREFIX)).toBe(true);

      // E está mesmo lá, legível.
      await api.app.get(StorageService).removePublic(chave);
    });

    it("guarda o hash, para reconhecer o mesmo arquivo depois", async () => {
      const token = await entrar();
      const resposta = await enviarEConfirmar(token, jpegBytes({ width: 1080, height: 1080 }));

      const midia = await api.db.media.findUniqueOrThrow({ where: { id: resposta.body["id"] as string } });
      expect(midia.sha256).toMatch(/^[0-9a-f]{64}$/);

      await api.app.get(StorageService).removePublic(midia.objectKey);
    });
  });

  /*
   * Os testes 3, 4 e 5 do roteiro da fase. Em todos, o arquivo recusado precisa
   * SUMIR: conteúdo não validado não fica ocupando o bucket nem esperando que
   * alguém descubra a URL.
   */
  describe("recusas — e o arquivo sempre some", () => {
    const recusa = async (corpo: Buffer, codigo: string) => {
      const token = await entrar();
      const resposta = await enviarEConfirmar(token, corpo);

      expect(resposta.statusCode).toBe(422);
      expect(resposta.body).toMatchObject({ code: codigo });
      // Nada foi gravado, nem no banco.
      expect(await api.db.media.count()).toBe(0);
    };

    it("PNG é recusado, ainda que enviado como image/jpeg (teste 3)", async () => {
      await recusa(pngBytes(), "MEDIA_WRONG_TYPE");
    });

    /*
     * Teste 4 do roteiro, e ele é recusado **no envio**, não na confirmação: o
     * limite está na política assinada, então o MinIO nem aceita o arquivo. É o
     * que o RF-B02 pede — "recusados no envio" —, e significa que 8 MB inúteis
     * nunca chegam a ocupar o bucket.
     *
     * O `MEDIA_TOO_LARGE` da API continua existindo como rede de segurança, para
     * o caso de uma política ter sido emitida com outro limite.
     */
    it("acima de 8 MB é recusado pelo próprio armazenamento (teste 4)", async () => {
      const token = await entrar();
      const permissao = (await pedirPermissao(token)).body;

      const status = await enviar(
        permissao,
        jpegBytes({ width: 1080, height: 1080, padToBytes: IMAGE_MAX_BYTES + 1_000 }),
      );

      expect(status).toBeGreaterThanOrEqual(400);
      expect(await api.db.media.count()).toBe(0);
    });

    it("imagem estreita demais é recusada", async () => {
      await recusa(jpegBytes({ width: 200, height: 200 }), "MEDIA_TOO_NARROW");
    });

    it("MPO é recusado, mesmo começando igual a um JPEG", async () => {
      await recusa(jpegBytes({ width: 1080, height: 1080, mpo: true }), "MEDIA_WRONG_TYPE");
    });
  });

  /*
   * O teste 5 do roteiro dizia "proporção 2:1 é recusada". **Deixou de valer**:
   * a faixa de 4:5 a 1.91:1 é do feed, e o acervo é compartilhado entre formatos
   * (RF-B03, RF-B04). Uma arte 9:16 de Stories é válida, e recusá-la aqui — ou
   * recortá-la para 4:5 — destruiria o formato pretendido.
   *
   * A proporção volta a ser conferida na composição, contra o formato escolhido.
   */
  describe("proporção não impede o envio", () => {
    const aceita = async (corpo: Buffer, medidas: { width: number; height: number }) => {
      const token = await entrar();
      const resposta = await enviarEConfirmar(token, corpo);

      expect(resposta.statusCode).toBe(201);
      expect(resposta.body).toMatchObject(medidas);

      await api.app.get(StorageService).removePublic(await objetoPublico(resposta.body["id"] as string));
    };

    it("2:1 entra no acervo, ainda que não sirva ao feed", async () => {
      await aceita(jpegBytes({ width: 2000, height: 1000 }), { width: 2000, height: 1000 });
    });

    it("9:16 entra no acervo — é a proporção de Stories", async () => {
      await aceita(jpegBytes({ width: 1080, height: 1920 }), { width: 1080, height: 1920 });
    });

    /*
     * A foto tirada em pé no celular: chega deitada nos bytes, com marca de
     * rotação. O que a rotação decide agora não é aceitar ou recusar, e sim
     * **quais medidas ficam gravadas** — e é delas que a composição vai tirar os
     * formatos que a imagem atende.
     */
    it("a foto de celular em pé é gravada girada, não deitada", async () => {
      await aceita(jpegBytes({ width: 4032, height: 3024, orientation: 6 }), { width: 3024, height: 4032 });
    });
  });

  /*
   * O acervo (RF-B04). Sem esta leitura, o que se envia nunca é usado — era
   * exatamente o estado do sistema até 21/09/2026.
   */
  describe("listar o acervo", () => {
    it("devolve o que foi enviado, com o endereço público", async () => {
      const token = await entrar();
      const resposta = await enviarEConfirmar(token, jpegBytes({ width: 1080, height: 1350 }));
      const id = resposta.body["id"] as string;

      const acervo = (await api.request({ method: "GET", url: "/media", token }))
        .body as unknown as { id: string; url: string; width: number; height: number }[];

      expect(acervo).toHaveLength(1);
      expect(acervo[0]).toMatchObject({ id, width: 1080, height: 1350 });
      expect(acervo[0]?.url).toMatch(/^https?:\/\/.+\/publicas\/postagens\/.+\.jpg$/);

      await api.app.get(StorageService).removePublic(await objetoPublico(id));
    });

    it("mais recentes primeiro", async () => {
      const token = await entrar();
      const primeira = (await enviarEConfirmar(token, jpegBytes({ width: 1080, height: 1080 }))).body[
        "id"
      ] as string;
      const segunda = (await enviarEConfirmar(token, jpegBytes({ width: 1080, height: 1350 }))).body[
        "id"
      ] as string;

      const acervo = (await api.request({ method: "GET", url: "/media", token }))
        .body as unknown as { id: string }[];

      expect(acervo.map((item) => item.id)).toEqual([segunda, primeira]);

      const storage = api.app.get(StorageService);
      for (const id of [primeira, segunda]) await storage.removePublic(await objetoPublico(id));
    });

    /*
     * A `Midia` não tem conta no schema: o acervo é compartilhado de propósito
     * (docs/13), e por isso a leitura é `@AnyAuthenticated` — não exige
     * POSTAGEM_EDITAR, que é permissão de ação.
     */
    it("qualquer pessoa logada lê, mesmo sem permissão de editar", async () => {
      const comEdicao = await entrar();
      const resposta = await enviarEConfirmar(comEdicao, jpegBytes({ width: 1080, height: 1080 }));

      const semPermissao = await entrar([]);
      const acervo = await api.request({ method: "GET", url: "/media", token: semPermissao });

      expect(acervo.statusCode).toBe(200);
      expect(acervo.body).toHaveLength(1);

      await api.app.get(StorageService).removePublic(await objetoPublico(resposta.body["id"] as string));
    });

    it("sem sessão, ninguém lê", async () => {
      expect((await api.request({ method: "GET", url: "/media" })).statusCode).toBe(401);
    });

    /*
     * O `inUse` existe para a tela desligar a lixeira **antes** de a pessoa
     * tentar (RF-B07). Postagem descartada não conta: é justamente o que a
     * exclusão libera, e sem isso um rascunho jogado fora prenderia a imagem
     * para sempre — `discard()` não apaga o vínculo.
     */
    it("diz quais imagens estão presas a uma postagem", async () => {
      const token = await entrar();
      const presa = (await enviarEConfirmar(token, jpegBytes({ width: 1080, height: 1080 }))).body[
        "id"
      ] as string;
      const solta = (await enviarEConfirmar(token, jpegBytes({ width: 1080, height: 1350 }))).body[
        "id"
      ] as string;

      await anexar(presa, "DRAFT");
      await anexar(solta, "CANCELED");

      const acervo = (await api.request({ method: "GET", url: "/media", token }))
        .body as unknown as { id: string; inUse: boolean }[];

      expect(acervo.find((item) => item.id === presa)?.inUse).toBe(true);
      expect(acervo.find((item) => item.id === solta)?.inUse).toBe(false);

      const storage = api.app.get(StorageService);
      for (const id of [presa, solta]) await storage.removePublic(await objetoPublico(id));
    });
  });

  /**
   * Excluir do acervo (RF-B07) — a única exclusão física de conteúdo.
   *
   * Contra o MinIO de verdade: o que se quer provar é que o **arquivo** some, e
   * isso não se prova com armazenamento falso. A prova é a URL pública passar a
   * responder 404 — pedir o `removePublic` de novo não serve, porque o S3 trata
   * apagar chave inexistente como sucesso.
   */
  describe("excluir do acervo", () => {
    const excluir = (token: string, ids: readonly string[]) =>
      api.request({ method: "POST", url: "/media/delete", token, payload: { ids } });

    /** O endereço público de uma mídia, como a listagem o entrega. */
    async function urlDe(token: string, id: string): Promise<string> {
      const acervo = (await api.request({ method: "GET", url: "/media", token }))
        .body as unknown as { id: string; url: string }[];
      return acervo.find((item) => item.id === id)!.url;
    }

    it("uma imagem sem uso some do banco e do armazenamento", async () => {
      const token = await entrar();
      const id = (await enviarEConfirmar(token, jpegBytes({ width: 1080, height: 1080 }))).body[
        "id"
      ] as string;
      const url = await urlDe(token, id);
      expect((await fetch(url)).status).toBe(200);

      const resposta = await excluir(token, [id]);

      expect(resposta.statusCode).toBe(200);
      expect(resposta.body).toMatchObject({ deleted: 1 });
      expect(await api.db.media.count()).toBe(0);
      expect((await fetch(url)).status).toBe(404);
    });

    it.each(["DRAFT", "PUBLISHED", "PROCESSING"] as const)(
      "recusa enquanto a postagem está em %s, e o arquivo continua lá",
      async (status) => {
        const token = await entrar();
        const id = (await enviarEConfirmar(token, jpegBytes({ width: 1080, height: 1080 }))).body[
          "id"
        ] as string;
        const url = await urlDe(token, id);
        await anexar(id, status);

        const resposta = await excluir(token, [id]);

        expect(resposta.statusCode).toBe(409);
        expect(resposta.body).toMatchObject({ code: "MEDIA_IN_USE" });
        expect(await api.db.media.count()).toBe(1);
        expect((await fetch(url)).status).toBe(200);

        await api.app.get(StorageService).removePublic(await objetoPublico(id));
      },
    );

    /*
     * O beco que este requisito abre: `discard()` só marca CANCELADO e **não**
     * apaga o vínculo. Sem isto, uma imagem anexada a um rascunho descartado
     * ficaria refém do acervo para sempre.
     */
    it("postagem descartada solta a imagem, e o vínculo sai junto", async () => {
      const token = await entrar();
      const id = (await enviarEConfirmar(token, jpegBytes({ width: 1080, height: 1080 }))).body[
        "id"
      ] as string;
      await anexar(id, "CANCELED");

      expect((await excluir(token, [id])).statusCode).toBe(200);
      expect(await api.db.media.count()).toBe(0);
      expect(await api.db.postMedia.count()).toBe(0);
    });

    it("uma postagem viva segura, mesmo havendo outra descartada", async () => {
      const token = await entrar();
      const id = (await enviarEConfirmar(token, jpegBytes({ width: 1080, height: 1080 }))).body[
        "id"
      ] as string;
      await anexar(id, "CANCELED");
      await anexar(id, "SCHEDULED");

      expect((await excluir(token, [id])).statusCode).toBe(409);
      expect(await api.db.media.count()).toBe(1);

      await api.app.get(StorageService).removePublic(await objetoPublico(id));
    });

    /*
     * `Marcacao` aponta para `PostagemMidia` com RESTRICT, e **nada a grava
     * hoje** — sem este caso escrito à mão, o 500 só apareceria na Fase 2.
     */
    it("marcação de postagem descartada não trava a exclusão", async () => {
      const token = await entrar();
      const id = (await enviarEConfirmar(token, jpegBytes({ width: 1080, height: 1080 }))).body[
        "id"
      ] as string;
      await anexar(id, "CANCELED");

      const vinculo = await api.db.postMedia.findFirstOrThrow({ where: { mediaId: id } });
      await api.db.userTag.create({
        data: { postMediaId: vinculo.id, username: "alguem", x: 0.5, y: 0.5 },
      });

      expect((await excluir(token, [id])).statusCode).toBe(200);
      expect(await api.db.media.count()).toBe(0);
      expect(await api.db.userTag.count()).toBe(0);
    });

    it("a capa de um Reels segura a imagem", async () => {
      const token = await entrar();
      const id = (await enviarEConfirmar(token, jpegBytes({ width: 1080, height: 1080 }))).body[
        "id"
      ] as string;
      const postId = await anexar(id, "CANCELED");
      await api.db.post.update({ where: { id: postId }, data: { coverMediaId: id } });

      expect((await excluir(token, [id])).statusCode).toBe(409);
      expect(await api.db.media.count()).toBe(1);

      await api.db.post.update({ where: { id: postId }, data: { coverMediaId: null } });
      await api.app.get(StorageService).removePublic(await objetoPublico(id));
    });

    it("um lote sai inteiro", async () => {
      const token = await entrar();
      const ids: string[] = [];
      for (const altura of [1080, 1350, 1080]) {
        ids.push(
          (await enviarEConfirmar(token, jpegBytes({ width: 1080, height: altura }))).body["id"] as string,
        );
      }

      expect((await excluir(token, ids)).body).toMatchObject({ deleted: 3 });
      expect(await api.db.media.count()).toBe(0);
    });

    /** A prova do tudo-ou-nada: uma presa, e nenhuma sai. */
    it("num lote com uma presa, nenhuma é excluída", async () => {
      const token = await entrar();
      const ids: string[] = [];
      for (const altura of [1080, 1350, 1080]) {
        ids.push(
          (await enviarEConfirmar(token, jpegBytes({ width: 1080, height: altura }))).body["id"] as string,
        );
      }
      await anexar(ids[1]!, "DRAFT");

      expect((await excluir(token, ids)).statusCode).toBe(409);
      expect(await api.db.media.count()).toBe(3);

      const storage = api.app.get(StorageService);
      for (const id of ids) await storage.removePublic(await objetoPublico(id));
    });

    it("id que já não existe é ignorado, sem erro", async () => {
      const token = await entrar();

      const resposta = await excluir(token, ["00000000-0000-4000-8000-000000000000"]);

      expect(resposta.statusCode).toBe(200);
      expect(resposta.body).toMatchObject({ deleted: 0 });
    });

    it("recusa quem não pode editar postagens", async () => {
      expect((await excluir(await entrar([]), ["00000000-0000-4000-8000-000000000000"])).statusCode).toBe(403);
    });

    it("sem sessão, ninguém exclui", async () => {
      const resposta = await api.request({
        method: "POST",
        url: "/media/delete",
        payload: { ids: ["00000000-0000-4000-8000-000000000000"] },
      });
      expect(resposta.statusCode).toBe(401);
    });

    it("o schema recusa lista vazia, id inválido e lote acima do teto", async () => {
      const token = await entrar();
      const umId = "00000000-0000-4000-8000-000000000000";

      expect((await excluir(token, [])).statusCode).toBe(400);
      expect((await excluir(token, ["nao-e-uuid"])).statusCode).toBe(400);
      expect((await excluir(token, Array.from({ length: 61 }, () => umId))).statusCode).toBe(400);
    });
  });

  describe("o comprovante", () => {
    it("recusa um comprovante inventado", async () => {
      const token = await entrar();
      const resposta = await api.request({
        method: "POST",
        url: "/media/confirm",
        token,
        payload: { ticket: "nao.presta" },
      });

      expect(resposta.statusCode).toBe(400);
      expect(resposta.body).toMatchObject({ code: "MEDIA_UPLOAD_INVALID" });
    });

    /*
     * O buraco que a revisão pegou: sem amarrar o comprovante a quem o pediu,
     * qualquer pessoa com permissão de editar ficaria com a mídia de outra.
     */
    it("recusa o comprovante de outra pessoa", async () => {
      const dono = await entrar();
      const outro = await entrar();
      const permissao = (await pedirPermissao(dono)).body;
      await enviar(permissao, jpegBytes({ width: 1080, height: 1080 }));

      const resposta = await api.request({
        method: "POST",
        url: "/media/confirm",
        token: outro,
        payload: { ticket: permissao["ticket"] },
      });

      expect(resposta.statusCode).toBe(400);
      expect(resposta.body).toMatchObject({ code: "MEDIA_UPLOAD_INVALID" });
    });

    it("recusa confirmar sem ter enviado nada", async () => {
      const token = await entrar();
      const permissao = (await pedirPermissao(token)).body;

      const resposta = await api.request({
        method: "POST",
        url: "/media/confirm",
        token,
        payload: { ticket: permissao["ticket"] },
      });

      expect(resposta.statusCode).toBe(400);
      expect(resposta.body).toMatchObject({ code: "MEDIA_UPLOAD_INVALID" });
    });

    /*
     * Acontece de verdade: a tela repete a confirmação depois de um tempo
     * esgotado que na verdade tinha dado certo. Sem tratar, a segunda vez
     * estoura a unicidade e vira "Algo deu errado" — com o arquivo publicado.
     */
    it("confirmar duas vezes dá erro claro, não 500", async () => {
      const token = await entrar();
      const permissao = (await pedirPermissao(token)).body;
      await enviar(permissao, jpegBytes({ width: 1080, height: 1080 }));

      const primeira = await api.request({
        method: "POST",
        url: "/media/confirm",
        token,
        payload: { ticket: permissao["ticket"] },
      });
      expect(primeira.statusCode).toBe(201);

      const segunda = await api.request({
        method: "POST",
        url: "/media/confirm",
        token,
        payload: { ticket: permissao["ticket"] },
      });

      expect(segunda.statusCode).toBe(409);
      expect(segunda.body).toMatchObject({ code: "MEDIA_ALREADY_CONFIRMED" });

      await api.app.get(StorageService).removePublic(await objetoPublico(primeira.body["id"] as string));
    });
  });
});
