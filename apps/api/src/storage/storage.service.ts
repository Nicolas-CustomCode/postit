import { Inject, Injectable, Logger } from "@nestjs/common";
import { Client } from "minio";
import { STORAGE_CONFIG, type StorageConfig } from "./storage.config";

/**
 * A porta para o MinIO (AGENTS.md, "integrações atrás de porta"; ADR 0012).
 *
 * É o único lugar do projeto que fala com o armazenamento. O bucket tem dois
 * prefixos, e a diferença entre eles é a regra 10:
 *
 * - `recebidos/` — o que o navegador envia, ilegível de fora, ainda não validado;
 * - `publicas/` — o que já passou pela validação, legível por quem souber a URL.
 *
 * Os dois prefixos têm guarda própria, e as guardas não são zelo: a chave é o
 * argumento mais fácil de trocar por engano, e trocá-la aqui significaria ou
 * publicar conteúdo não validado, ou apagar uma foto que estava em uso.
 */
export const PUBLIC_PREFIX = "publicas/";
export const RECEIVED_PREFIX = "recebidos/";

@Injectable()
export class StorageService {
  private readonly logger = new Logger("Storage");
  private readonly client: Client;

  constructor(@Inject(STORAGE_CONFIG) private readonly config: StorageConfig) {
    // O MinIO quer host e porta separados; o ambiente guarda uma URL, que é o
    // formato que o resto do projeto usa e o que o zod sabe validar.
    const url = new URL(config.endpoint);
    const secure = url.protocol === "https:";

    this.client = new Client({
      endPoint: url.hostname,
      port: url.port === "" ? (secure ? 443 : 80) : Number(url.port),
      useSSL: secure,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
  }

  /**
   * Grava um objeto no prefixo público.
   *
   * A chave é conferida aqui: um erro de montagem que escrevesse fora de
   * `publicas/` deixaria o arquivo ilegível na tela, ou — pior, no dia em que
   * `recebidos/` existir — colocaria conteúdo não validado onde o mundo lê.
   */
  async putPublic(key: string, body: Buffer, contentType: string): Promise<void> {
    assertPublic(key);
    await this.client.putObject(this.config.bucket, key, body, body.length, {
      "Content-Type": contentType,
    });
  }

  /** Apaga um objeto do prefixo público. Usado ao trocar a foto de uma conta. */
  async removePublic(key: string): Promise<void> {
    assertPublic(key);
    await this.client.removeObject(this.config.bucket, key);
  }

  /**
   * A permissão de envio: um formulário assinado, de vida curta, para **uma**
   * chave só (ADR 0012, "A permissão assinada").
   *
   * É o MinIO que passa a recusar tipo e tamanho errados, **antes de qualquer
   * byte chegar à API** — é isso que faz o teste 13 do roteiro da fase ("enviar
   * acima do autorizado é recusado pelo armazenamento") significar alguma coisa.
   *
   * ⚠️ **O endereço de destino não é o que o SDK devolve.** O `postURL` dele é
   * montado com o `MINIO_ENDPOINT`, que é interno (`127.0.0.1`): devolvê-lo ao
   * navegador falharia o envio e ainda vazaria o endereço interno (regra 4).
   * Trocar o host é seguro porque **a assinatura cobre só o documento da
   * política** — o host não entra no cálculo. É também a resposta do item V-15:
   * a assinatura sobrevive ao proxy porque nunca soube do host.
   */
  async signedUpload(input: {
    key: string;
    contentType: string;
    minBytes: number;
    maxBytes: number;
    ttlSeconds: number;
    now: Date;
  }): Promise<{ url: string; fields: Record<string, string>; expiresAt: Date }> {
    assertReceived(input.key);

    const expiresAt = new Date(input.now.getTime() + input.ttlSeconds * 1000);
    const policy = this.client.newPostPolicy();

    policy.setBucket(this.config.bucket);
    // `setKey`, e não `setKeyStartsWith`: a política vale para um caminho exato,
    // então ela não serve para gravar em outro lugar do bucket.
    policy.setKey(input.key);
    policy.setContentType(input.contentType);
    // O mínimo não é detalhe: com zero, um arquivo vazio passaria pelo MinIO e
    // só seria recusado depois, pela API.
    policy.setContentLengthRange(input.minBytes, input.maxBytes);
    // Sempre explícito: sem isto a biblioteca arbitra um prazo por um cálculo
    // torto, e a política ficaria válida por muito mais tempo que o desejado.
    policy.setExpires(expiresAt);

    const { formData } = await this.client.presignedPostPolicy(policy);

    return {
      url: `${this.config.publicUrl.replace(/\/$/, "")}/${this.config.bucket}`,
      fields: formData as Record<string, string>,
      expiresAt,
    };
  }

  /** Lê o que foi enviado, para inspecionar. Só `recebidos/`. */
  async getReceived(key: string): Promise<Buffer> {
    assertReceived(key);
    const stream = await this.client.getObject(this.config.bucket, key);

    const pedacos: Buffer[] = [];
    for await (const pedaco of stream) pedacos.push(pedaco as Buffer);
    return Buffer.concat(pedacos);
  }

  /** Apaga um envio: o recusado, e também o que já foi promovido. */
  async removeReceived(key: string): Promise<void> {
    assertReceived(key);
    await this.client.removeObject(this.config.bucket, key);
  }

  /**
   * Promove o arquivo validado: copia para `publicas/` e apaga o original.
   *
   * Confere **os dois lados**. Uma chave de origem trocada leria de onde não
   * devia; uma de destino trocada publicaria fora do prefixo legível.
   */
  async promoteToPublic(from: string, to: string): Promise<void> {
    assertReceived(from);
    assertPublic(to);

    await this.client.copyObject(this.config.bucket, to, `/${this.config.bucket}/${from}`);
    await this.client.removeObject(this.config.bucket, from);
  }

  /**
   * O bucket responde? É o que o `GET /health` reporta (docs/10).
   *
   * Não lança: quem chama quer o estado, não o erro. A causa vai para o log.
   */
  async healthy(): Promise<boolean> {
    try {
      return await this.client.bucketExists(this.config.bucket);
    } catch (error) {
      this.logger.error(`MinIO não respondeu: ${error instanceof Error ? error.name : "desconhecido"}`);
      return false;
    }
  }
}

function assertPublic(key: string): void {
  if (!key.startsWith(PUBLIC_PREFIX)) {
    throw new Error(`Chave de objeto fora de ${PUBLIC_PREFIX}: recusada.`);
  }
}

function assertReceived(key: string): void {
  if (!key.startsWith(RECEIVED_PREFIX)) {
    throw new Error(`Chave de objeto fora de ${RECEIVED_PREFIX}: recusada.`);
  }
}
