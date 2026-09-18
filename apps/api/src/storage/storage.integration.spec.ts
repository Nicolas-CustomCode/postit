import { randomBytes } from "node:crypto";
import { readApiEnv } from "../config/env";
import { jpegBytes } from "../common/testing/image-fixtures";
import { storageConfigFrom } from "./storage.config";
import { PUBLIC_PREFIX, RECEIVED_PREFIX, StorageService } from "./storage.service";

/**
 * A porta para o MinIO, contra o MinIO de verdade (docs/15).
 *
 * Um armazenamento falso não provaria o que importa aqui: que a política
 * assinada é aceita, que o limite de tamanho é imposto **pelo armazenamento** e
 * que `recebidos/` não é legível de fora. São exatamente os testes 12 e 13 do
 * roteiro da Fase 1.
 */
describe("armazenamento de mídia", () => {
  const env = readApiEnv({ ...process.env, NODE_ENV: "test" });
  const config = storageConfigFrom(env);
  const storage = new StorageService(config);

  /** Uma chave nova a cada caso, para os testes não disputarem o mesmo objeto. */
  const chave = (prefixo: string) => `${prefixo}testes/${randomBytes(16).toString("hex")}.jpg`;
  const lixo: string[] = [];

  afterAll(async () => {
    for (const k of lixo) {
      const apagar = k.startsWith(PUBLIC_PREFIX) ? storage.removePublic(k) : storage.removeReceived(k);
      await apagar.catch(() => undefined);
    }
  });

  /** Envia como o navegador faria: multipart, com os campos da política. */
  async function enviarComPolitica(
    politica: { url: string; fields: Record<string, string> },
    corpo: Buffer,
    contentType: string,
  ): Promise<number> {
    const form = new FormData();
    for (const [nome, valor] of Object.entries(politica.fields)) form.append(nome, valor);
    // O arquivo é o ÚLTIMO campo: é o que o protocolo do S3 exige.
    form.append("file", new Blob([new Uint8Array(corpo)], { type: contentType }));

    const resposta = await fetch(politica.url, { method: "POST", body: form });
    return resposta.status;
  }

  const politicaPara = (key: string, maxBytes = 8_000_000) =>
    storage.signedUpload({
      key,
      contentType: "image/jpeg",
      minBytes: 1,
      maxBytes,
      ttlSeconds: 300,
      now: new Date(),
    });

  /*
   * O erro que teria quebrado a fase inteira: o `postURL` que o SDK devolve é
   * montado com o endereço INTERNO. Se ele chegasse ao navegador, o envio
   * falharia e o endereço interno vazaria.
   */
  it("o destino é o endereço público, nunca o interno", async () => {
    const politica = await politicaPara(chave(RECEIVED_PREFIX));

    expect(politica.url.startsWith(config.publicUrl.replace(/\/$/, ""))).toBe(true);
    expect(politica.url).not.toContain(new URL(config.endpoint).host);
  });

  it("a política assinada é aceita pelo MinIO, com o host trocado", async () => {
    const key = chave(RECEIVED_PREFIX);
    lixo.push(key);

    const status = await enviarComPolitica(await politicaPara(key), jpegBytes({ width: 1080, height: 1080 }), "image/jpeg");

    expect(status).toBe(204);
  });

  /** Teste 13 do roteiro: sem os campos assinados, o armazenamento recusa. */
  it("envio sem política é recusado pelo armazenamento", async () => {
    const form = new FormData();
    form.append("key", chave(RECEIVED_PREFIX));
    form.append("file", new Blob([new Uint8Array(jpegBytes({ width: 1080, height: 1080 }))]));

    const resposta = await fetch(`${config.publicUrl.replace(/\/$/, "")}/${config.bucket}`, {
      method: "POST",
      body: form,
    });

    expect(resposta.status).toBeGreaterThanOrEqual(400);
  });

  /** A outra metade do teste 13: o limite é imposto antes de chegar à API. */
  it("arquivo acima do autorizado é recusado pelo armazenamento", async () => {
    const key = chave(RECEIVED_PREFIX);
    const politica = await politicaPara(key, 1_000);

    const status = await enviarComPolitica(politica, jpegBytes({ width: 1080, height: 1080, padToBytes: 50_000 }), "image/jpeg");

    expect(status).toBeGreaterThanOrEqual(400);
  });

  /** Teste 12 do roteiro: o que ainda não foi validado não é legível. */
  it("recebidos/ não é legível de fora, publicas/ é", async () => {
    const recebido = chave(RECEIVED_PREFIX);
    const publico = `${PUBLIC_PREFIX}testes/${randomBytes(16).toString("hex")}.jpg`;
    lixo.push(recebido, publico);

    await enviarComPolitica(await politicaPara(recebido), jpegBytes({ width: 1080, height: 1080 }), "image/jpeg");
    await storage.putPublic(publico, jpegBytes({ width: 1080, height: 1080 }), "image/jpeg");

    const base = config.publicUrl.replace(/\/$/, "");
    expect((await fetch(`${base}/${config.bucket}/${recebido}`)).status).toBe(403);
    expect((await fetch(`${base}/${config.bucket}/${publico}`)).status).toBe(200);
  });

  it("lê de volta exatamente o que foi enviado", async () => {
    const key = chave(RECEIVED_PREFIX);
    lixo.push(key);
    const original = jpegBytes({ width: 1080, height: 1350 });

    await enviarComPolitica(await politicaPara(key), original, "image/jpeg");

    expect(await storage.getReceived(key)).toEqual(original);
  });

  it("promover move para publicas/ e não deixa nada em recebidos/", async () => {
    const recebido = chave(RECEIVED_PREFIX);
    const publico = recebido.replace(RECEIVED_PREFIX, PUBLIC_PREFIX);
    lixo.push(publico);

    await enviarComPolitica(await politicaPara(recebido), jpegBytes({ width: 1080, height: 1080 }), "image/jpeg");
    await storage.promoteToPublic(recebido, publico);

    const base = config.publicUrl.replace(/\/$/, "");
    expect((await fetch(`${base}/${config.bucket}/${publico}`)).status).toBe(200);
    await expect(storage.getReceived(recebido)).rejects.toThrow();
  });

  /*
   * As guardas de prefixo. Sem elas, um argumento trocado apagaria a foto de
   * perfil de uma conta em uso, ou publicaria o que ainda não foi validado.
   */
  describe("guardas de prefixo", () => {
    it("recusa gravar fora de publicas/", async () => {
      await expect(storage.putPublic("recebidos/x.jpg", Buffer.alloc(1), "image/jpeg")).rejects.toThrow();
    });

    it("recusa apagar de recebidos/ uma chave pública", async () => {
      await expect(storage.removeReceived("publicas/contas/foto.jpg")).rejects.toThrow();
    });

    it("recusa promover para fora de publicas/", async () => {
      await expect(storage.promoteToPublic("recebidos/a.jpg", "recebidos/b.jpg")).rejects.toThrow();
    });

    it("recusa assinar envio fora de recebidos/", async () => {
      await expect(politicaPara("publicas/x.jpg")).rejects.toThrow();
    });
  });
});
