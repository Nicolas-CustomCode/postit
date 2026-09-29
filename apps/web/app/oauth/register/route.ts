import { apiForward } from "@/lib/api/forward";

/**
 * Registro dinâmico do cliente do assistente (RFC 7591; ADR 0029). Rota de máquina
 * da exceção fechada da regra 13: não lê cookie, só repassa à API.
 */
export function POST(request: Request): Promise<Response> {
  return apiForward(request, "/oauth/register");
}
