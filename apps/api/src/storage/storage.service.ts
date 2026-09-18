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
 * Só o segundo existe nesta fase: a foto de perfil vem da Meta pela própria API,
 * não do navegador, então não passa por `recebidos/`. O envio direto com política
 * assinada entra na Fase 2, com `presignedPostPolicy`.
 */
export const PUBLIC_PREFIX = "publicas/";

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
