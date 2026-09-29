import { apiForward } from "@/lib/api/forward";

/**
 * Troca do código e renovação do token do assistente (ADR 0029). Rota de máquina
 * da exceção fechada da regra 13: não lê cookie, só repassa à API.
 */
export function POST(request: Request): Promise<Response> {
  return apiForward(request, "/oauth/token");
}
