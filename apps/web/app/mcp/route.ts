import { apiForward } from "@/lib/api/forward";

/**
 * O servidor MCP do assistente (ADR 0029). Rota de máquina da exceção fechada da
 * regra 13: não lê cookie, só repassa à API, que confere o token.
 */
export function POST(request: Request): Promise<Response> {
  return apiForward(request, "/mcp");
}

/**
 * Sem estado: não há fluxo de eventos para abrir nem sessão para encerrar. O 405 é o
 * que a especificação manda responder nesse caso (Streamable HTTP, 2025-06-18).
 */
function notAllowed(): Response {
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}

export { notAllowed as GET, notAllowed as DELETE };
