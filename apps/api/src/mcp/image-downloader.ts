import { Injectable } from "@nestjs/common";
import { IMAGE_MAX_BYTES } from "@repo/shared";
import { safeFetch } from "../common/safe-fetch";

/**
 * Baixa a imagem que o assistente trouxe — o anexo da conversa ou uma URL (ADR 0029,
 * decisão 5).
 *
 * Classe à parte por um motivo só: o teste de integração troca a busca por bytes
 * prontos. A de verdade vai à internet, e a busca segura recusa, de propósito, o
 * servidor falso local.
 */
@Injectable()
export class ImageDownloader {
  async download(url: string): Promise<Buffer> {
    const response = await safeFetch(url, {
      maxBytes: IMAGE_MAX_BYTES,
      timeoutMs: 20_000,
      // Link de download costuma levar a um armazenamento assinado; cada salto passa
      // pelas travas de novo.
      maxRedirects: 3,
      accept: "image/jpeg",
    });
    return response.body;
  }
}
