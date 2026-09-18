import { FEED_IMAGE_MAX_BYTES } from "@repo/shared";
import { createTestUser, TEST_PASSWORD, totpCodeFor } from "../common/testing/factories";
import { jpegBytes, pngBytes } from "../common/testing/image-fixtures";
import { bootTestApp, type TestApp } from "../common/testing/test-app";
import { PUBLIC_PREFIX, StorageService } from "../storage/storage.service";

/**
 * Enviar e validar uma imagem de feed, de ponta a ponta (RF-B01, RF-B02).
 *
 * Contra o Postgres e o MinIO de verdade: o que se quer provar é que o arquivo
 * recusado **some** e que o aceito **fica público**, e nenhum dos dois se prova
 * com armazenamento falso.
 *
 * Cobre os testes 3, 4 e 5 do roteiro da Fase 1 (docs/12): PNG, arquivo grande
 * demais e proporção 2:1, cada um com a recusa certa.
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
        jpegBytes({ width: 1080, height: 1080, padToBytes: FEED_IMAGE_MAX_BYTES + 1_000 }),
      );

      expect(status).toBeGreaterThanOrEqual(400);
      expect(await api.db.media.count()).toBe(0);
    });

    it("proporção 2:1 é recusada (teste 5)", async () => {
      await recusa(jpegBytes({ width: 2000, height: 1000 }), "MEDIA_RATIO_UNSUPPORTED");
    });

    it("imagem estreita demais é recusada", async () => {
      await recusa(jpegBytes({ width: 200, height: 200 }), "MEDIA_TOO_NARROW");
    });

    it("MPO é recusado, mesmo começando igual a um JPEG", async () => {
      await recusa(jpegBytes({ width: 1080, height: 1080, mpo: true }), "MEDIA_WRONG_TYPE");
    });

    /*
     * A foto tirada em pé no celular: chega deitada nos bytes, com marca de
     * rotação. Sem aplicar a rotação, passaria como paisagem válida e o
     * Instagram a cortaria sozinho.
     */
    it("foto de celular em pé é avaliada girada, e recusada pela proporção", async () => {
      await recusa(
        jpegBytes({ width: 4032, height: 3024, orientation: 6 }),
        "MEDIA_RATIO_UNSUPPORTED",
      );
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
