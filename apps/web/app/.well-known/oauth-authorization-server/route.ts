import { authorizationServerMetadata } from "@/lib/oauth/metadata";

/** Metadados do servidor de autorização (RFC 8414). */
export function GET(): Response {
  return Response.json(authorizationServerMetadata());
}
