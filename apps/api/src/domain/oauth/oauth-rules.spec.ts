import { OAUTH_SCOPE } from "@repo/shared";
import { decideAuthorize, isScopeAcceptable, sameResource } from "./authorize-request";
import {
  isAcceptableRedirectUri,
  isClientMetadataUrl,
  isClientProblem,
  parseClientMetadataDocument,
  parseRegistrationRequest,
} from "./client";
import { accessTokenExpiry, ACCESS_TOKEN_TTL_MS, refreshTokenState } from "./lifetimes";
import { pkceChallenge, pkceMatches } from "./pkce";

const AGORA = new Date("2026-09-29T12:00:00.000Z");
const RETORNO = "https://chatgpt.com/connector_platform_oauth_redirect";
const RECURSO = "https://postit.exemplo.com/mcp";
// O exemplo do RFC 7636, apêndice B.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

describe("PKCE", () => {
  it("o challenge é o sha256 do verifier em base64url, como no RFC 7636", () => {
    expect(pkceChallenge(VERIFIER)).toBe(CHALLENGE);
    expect(pkceMatches(VERIFIER, CHALLENGE)).toBe(true);
  });

  it("verifier errado não passa", () => {
    expect(pkceMatches(VERIFIER.replace("d", "e"), CHALLENGE)).toBe(false);
  });

  it("verifier curto demais não passa nem se o hash bater", () => {
    const curto = "a".repeat(42);
    expect(pkceMatches(curto, pkceChallenge(curto))).toBe(false);
  });
});

describe("pedido de autorização", () => {
  const valido = {
    responseType: "code",
    redirectUri: RETORNO,
    codeChallenge: CHALLENGE,
    codeChallengeMethod: "S256",
    scope: OAUTH_SCOPE,
    resource: RECURSO,
  };
  const decidir = (extra: Partial<typeof valido> = {}) => decideAuthorize({ ...valido, ...extra }, [RETORNO], RECURSO);

  it("pedido completo passa, com o recurso esperado", () => {
    expect(decidir()).toEqual({ kind: "OK", redirectUri: RETORNO, codeChallenge: CHALLENGE, resource: RECURSO });
  });

  it("endereço de retorno que não é do cliente não redireciona — nem com o resto errado", () => {
    expect(decidir({ redirectUri: "https://atacante.exemplo/cb", responseType: "token" }).kind).toBe("FATAL");
  });

  it("o endereço é comparado exatamente, sem normalizar", () => {
    expect(decidir({ redirectUri: `${RETORNO}/` }).kind).toBe("FATAL");
  });

  it("sem redirect_uri, serve o único registrado; com dois, não", () => {
    const semRetorno = { ...valido, redirectUri: undefined };
    expect(decideAuthorize(semRetorno, [RETORNO], RECURSO).kind).toBe("OK");
    expect(decideAuthorize(semRetorno, [RETORNO, "https://outro.exemplo/cb"], RECURSO).kind).toBe("FATAL");
  });

  it("sem PKCE, ou com plain, volta erro ao cliente", () => {
    expect(decidir({ codeChallenge: undefined })).toMatchObject({ kind: "REDIRECT", error: "invalid_request" });
    expect(decidir({ codeChallengeMethod: "plain" })).toMatchObject({ kind: "REDIRECT", error: "invalid_request" });
  });

  it("escopo estranho e recurso de outro servidor voltam erro ao cliente", () => {
    expect(decidir({ scope: "postagens:publicar" })).toMatchObject({ error: "invalid_scope" });
    expect(decidir({ resource: "https://outro.exemplo/mcp" })).toMatchObject({ error: "invalid_target" });
  });

  it("sem escopo e sem recurso, valem os do PostIt", () => {
    expect(decidir({ scope: undefined, resource: undefined }).kind).toBe("OK");
    expect(isScopeAcceptable(` ${OAUTH_SCOPE}  `)).toBe(true);
    expect(sameResource(`${RECURSO}/`, RECURSO)).toBe(true);
  });
});

describe("clientes", () => {
  const URL_FICHA = "https://openai.com/chatgpt.json";

  it("endereço de retorno: https, ou http só de loopback, e nunca com fragmento", () => {
    expect(isAcceptableRedirectUri(RETORNO)).toBe(true);
    expect(isAcceptableRedirectUri("http://127.0.0.1:33418/callback")).toBe(true);
    expect(isAcceptableRedirectUri("http://exemplo.com/cb")).toBe(false);
    expect(isAcceptableRedirectUri("https://exemplo.com/cb#x")).toBe(false);
    expect(isAcceptableRedirectUri("javascript:alert(1)")).toBe(false);
  });

  it("a URL do CIMD é https e tem caminho", () => {
    expect(isClientMetadataUrl(URL_FICHA)).toBe(true);
    expect(isClientMetadataUrl("https://openai.com/")).toBe(false);
    expect(isClientMetadataUrl("http://openai.com/chatgpt.json")).toBe(false);
    expect(isClientMetadataUrl("nao-e-url")).toBe(false);
  });

  it("a ficha do CIMD precisa trazer a própria URL como client_id", () => {
    const ficha = { client_id: URL_FICHA, client_name: "ChatGPT", redirect_uris: [RETORNO] };
    expect(parseClientMetadataDocument(URL_FICHA, ficha)).toEqual({ name: "ChatGPT", redirectUris: [RETORNO] });
    const trocada = { ...ficha, client_id: "https://atacante.exemplo/ficha.json" };
    expect(isClientProblem(parseClientMetadataDocument(URL_FICHA, trocada))).toBe(true);
  });

  it("a ficha real do ChatGPT passa: prefere private_key_jwt, mas aceita none", () => {
    const URL_CHATGPT = "https://chatgpt.com/oauth/client.json";
    // Lida em 29/09/2026, do próprio endereço.
    const ficha = {
      client_id: URL_CHATGPT,
      client_uri: "https://chatgpt.com/",
      redirect_uris: [RETORNO],
      token_endpoint_auth_method: "private_key_jwt",
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "ChatGPT",
    };
    expect(parseClientMetadataDocument(URL_CHATGPT, ficha)).toEqual({ name: "ChatGPT", redirectUris: [RETORNO] });

    const soComChave = { ...ficha, token_endpoint_auth_methods_supported: ["private_key_jwt"] };
    expect(isClientProblem(parseClientMetadataDocument(URL_CHATGPT, soComChave))).toBe(true);
  });

  it("sem nome, a ficha do CIMD usa o domínio", () => {
    expect(parseClientMetadataDocument(URL_FICHA, { client_id: URL_FICHA, redirect_uris: [RETORNO] })).toMatchObject({
      name: "openai.com",
    });
  });

  it("registro dinâmico: só cliente público, com retorno válido", () => {
    expect(parseRegistrationRequest({ client_name: "Claude", redirect_uris: [RETORNO] })).toEqual({
      name: "Claude",
      redirectUris: [RETORNO],
    });
    const comSegredo = { redirect_uris: [RETORNO], token_endpoint_auth_method: "client_secret_basic" };
    expect(isClientProblem(parseRegistrationRequest(comSegredo))).toBe(true);
    expect(isClientProblem(parseRegistrationRequest({ redirect_uris: [] }))).toBe(true);
    expect(isClientProblem(parseRegistrationRequest({ redirect_uris: ["http://exemplo.com/cb"] }))).toBe(true);
    expect(isClientProblem(parseRegistrationRequest("texto"))).toBe(true);
  });
});

describe("prazos", () => {
  it("o acesso dura uma hora, mas nunca passa do teto da autorização", () => {
    const longe = new Date(AGORA.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(accessTokenExpiry(AGORA, longe)).toEqual(new Date(AGORA.getTime() + ACCESS_TOKEN_TTL_MS));
    const perto = new Date(AGORA.getTime() + 10 * 60 * 1000);
    expect(accessTokenExpiry(AGORA, perto)).toEqual(perto);
  });

  it("renovação usada de novo é reuso — mesmo vencida ou revogada", () => {
    const base = { expiresAt: new Date(AGORA.getTime() + 1000), usedAt: null, revokedAt: null };
    expect(refreshTokenState(base, AGORA)).toBe("USABLE");
    expect(refreshTokenState({ ...base, usedAt: AGORA }, AGORA)).toBe("REUSED");
    expect(refreshTokenState({ ...base, usedAt: AGORA, expiresAt: AGORA }, AGORA)).toBe("REUSED");
    expect(refreshTokenState({ ...base, revokedAt: AGORA }, AGORA)).toBe("REVOKED");
    expect(refreshTokenState({ ...base, expiresAt: AGORA }, AGORA)).toBe("EXPIRED");
  });
});
