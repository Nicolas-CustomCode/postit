import { Injectable } from "@nestjs/common";
import { safeFetch } from "../common/safe-fetch";

/**
 * Lê a ficha do cliente no endereço que ele usa como `client_id` (CIMD).
 *
 * Classe à parte por um motivo só: o teste de integração troca a busca por uma
 * resposta pronta. A ficha verdadeira mora num servidor público, e a busca segura
 * recusa, de propósito, o servidor falso local.
 */
@Injectable()
export class ClientMetadataFetcher {
  async fetch(url: string): Promise<unknown> {
    // 5 KB é o teto que o rascunho do CIMD sugere; ficha de verdade tem poucas linhas.
    const response = await safeFetch(url, { maxBytes: 5 * 1024, timeoutMs: 5000, accept: "application/json" });
    return JSON.parse(response.body.toString("utf8")) as unknown;
  }
}
