import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { Inject, Injectable, Logger } from "@nestjs/common";
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
  private readonly client: S3Client;

  constructor(@Inject(STORAGE_CONFIG) private readonly config: StorageConfig) {
    // S3 puro pelo SDK da AWS, e não pela biblioteca `minio`: é dela que vinham os
    // avisos aceitos do docs/15, e o mesmo código serve a MinIO ou RustFS (ADR 0028).
    this.client = new S3Client({
      endpoint: config.endpoint,
      // O MinIO não tem região de verdade; us-east-1 é a que ele assume quando
      // nenhuma é configurada, e a assinatura precisa bater com ela.
      region: "us-east-1",
      // Caminho (`/bucket/chave`), e não subdomínio: o endereço interno é um
      // nome de serviço ou 127.0.0.1, que não aceita `bucket.` na frente.
      forcePathStyle: true,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
      // Os checksums novos que o SDK passou a mandar por padrão não são garantidos
      // fora da AWS: só quando a operação exige.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
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
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /** Apaga um objeto do prefixo público. Usado ao trocar a foto de uma conta. */
  async removePublic(key: string): Promise<void> {
    assertPublic(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
  }

  /**
   * A permissão de envio: um formulário assinado, de vida curta, para **uma**
   * chave só (ADR 0012, "A permissão assinada").
   *
   * É o MinIO que passa a recusar tipo e tamanho errados, **antes de qualquer
   * byte chegar à API** — é isso que faz o teste 13 do roteiro da fase ("enviar
   * acima do autorizado é recusado pelo armazenamento") significar alguma coisa.
   *
   * ⚠️ **O endereço de destino não é o que o SDK devolve.** O `url` dele é
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

    const { fields } = await createPresignedPost(this.client, {
      Bucket: this.config.bucket,
      // Chave sem `${filename}`: o SDK a assina como caminho exato, então a
      // política não serve para gravar em outro lugar do bucket.
      Key: input.key,
      // Cada campo vira uma condição de igualdade na política.
      Fields: { "Content-Type": input.contentType },
      // O mínimo não é detalhe: com zero, um arquivo vazio passaria pelo MinIO e
      // só seria recusado depois, pela API.
      Conditions: [["content-length-range", input.minBytes, input.maxBytes]],
      // Sempre explícito: o padrão do SDK é uma hora.
      Expires: input.ttlSeconds,
    });

    return {
      url: `${this.config.publicUrl.replace(/\/$/, "")}/${this.config.bucket}`,
      fields,
      expiresAt,
    };
  }

  /**
   * Grava em `recebidos/` o que a própria API baixou — a imagem que o assistente
   * trouxe (ADR 0029). Entra pela mesma porta do envio do navegador: nada vai direto
   * para `publicas/` sem a conferência (regra 10).
   */
  async putReceived(key: string, body: Buffer, contentType: string): Promise<void> {
    assertReceived(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.config.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  /** Lê o que foi enviado, para inspecionar. Só `recebidos/`. */
  async getReceived(key: string): Promise<Buffer> {
    assertReceived(key);
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: key }));
    if (!response.Body) throw new Error("Objeto sem conteúdo.");
    return Buffer.from(await response.Body.transformToByteArray());
  }

  /** Apaga um envio: o recusado, e também o que já foi promovido. */
  async removeReceived(key: string): Promise<void> {
    assertReceived(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }));
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

    await this.client.send(
      new CopyObjectCommand({ Bucket: this.config.bucket, Key: to, CopySource: `${this.config.bucket}/${from}` }),
    );
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: from }));
  }

  /**
   * O bucket responde? É o que o `GET /health` reporta (docs/10).
   *
   * Não lança: quem chama quer o estado, não o erro. A causa vai para o log.
   */
  async healthy(): Promise<boolean> {
    try {
      // HeadBucket responde vazio quando o bucket existe e lança quando não.
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucket }));
      return true;
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
