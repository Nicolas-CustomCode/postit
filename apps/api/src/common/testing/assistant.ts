import { createHash, randomBytes } from "node:crypto";
import type { Permission } from "@repo/shared";
import { createTestUser, TEST_PASSWORD, totpCodeFor } from "./factories";
import { TEST_INTERNAL_KEY, type TestApp } from "./test-app";

/**
 * O assistente conectado de verdade, para os testes das ferramentas: login com as
 * duas etapas, registro do cliente, "Permitir" e a troca do código com PKCE — o
 * mesmo caminho do ChatGPT, sem atalho no banco.
 */
const RETORNO = "https://chatgpt.com/connector_platform_oauth_redirect";

export interface ConnectedAssistant {
  readonly userId: string;
  /** A sessão da pessoa, para agir pela API da tela no mesmo teste. */
  readonly sessionToken: string;
  readonly accessToken: string;
}

export async function connectAssistant(
  api: TestApp,
  permissions: readonly Permission[] = ["POST_EDIT"],
): Promise<ConnectedAssistant> {
  const user = await createTestUser(api.db, api.config.encryptionKey, { permissions });
  const desafio = await api.request({
    method: "POST",
    url: "/auth/login",
    payload: { email: user.email, password: TEST_PASSWORD },
  });
  const sessao = await api.request({
    method: "POST",
    url: "/auth/challenge/verify",
    payload: { token: desafio.body["token"], code: totpCodeFor(user.totpSecret) },
  });
  const sessionToken = sessao.body["token"] as string;

  const registro = await api.request({
    method: "POST",
    url: "/oauth/register",
    payload: { client_name: "ChatGPT", redirect_uris: [RETORNO] },
  });
  const clientId = registro.body["client_id"] as string;

  const verifier = randomBytes(32).toString("base64url");
  const aprovacao = await api.request({
    method: "POST",
    url: "/oauth/approve",
    token: sessionToken,
    payload: {
      client_id: clientId,
      redirect_uri: RETORNO,
      response_type: "code",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    },
  });
  const code = new URL(aprovacao.body["redirectTo"] as string).searchParams.get("code")!;

  const tokens = await api.request({
    method: "POST",
    url: "/oauth/token",
    payload: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      client_id: clientId,
    }).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  });

  return { userId: user.id, sessionToken, accessToken: tokens.body["access_token"] as string };
}

export interface ToolResult {
  readonly isError: boolean;
  /** O JSON devolvido, ou a frase da recusa quando `isError`. */
  readonly data: Record<string, unknown>;
  readonly text: string;
}

/** Chama uma ferramenta pelo `/mcp`, no protocolo de 2025, e lê o evento SSE da resposta. */
export async function callTool(
  api: TestApp,
  accessToken: string,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolResult> {
  const resposta = await api.app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      "x-internal-key": TEST_INTERNAL_KEY,
      authorization: `Bearer ${accessToken}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    payload: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  const dados = resposta.body.split("\n").find((linha) => linha.startsWith("data: "));
  if (dados === undefined) throw new Error(`/mcp respondeu ${resposta.statusCode} sem evento`);

  const corpo = JSON.parse(dados.slice(6)) as {
    result?: { isError?: boolean; content: { text: string }[] };
    error?: { message: string };
  };
  if (corpo.result === undefined) throw new Error(`erro de protocolo: ${corpo.error?.message ?? "?"}`);

  const text = corpo.result.content[0]!.text;
  const isError = corpo.result.isError === true;
  return { isError, text, data: isError ? {} : (JSON.parse(text) as Record<string, unknown>) };
}
