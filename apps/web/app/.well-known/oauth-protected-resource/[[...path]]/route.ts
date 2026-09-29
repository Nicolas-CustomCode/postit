import { protectedResourceMetadata } from "@/lib/oauth/metadata";

/**
 * Metadados do recurso protegido (RFC 9728). Responde também no caminho com o
 * recurso anexado (`/.well-known/oauth-protected-resource/mcp`), que é onde a
 * especificação do MCP manda o cliente procurar primeiro.
 */
export function GET(): Response {
  return Response.json(protectedResourceMetadata());
}
