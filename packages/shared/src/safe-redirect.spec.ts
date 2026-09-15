import { safeRedirect, DEFAULT_REDIRECT } from "./safe-redirect";

describe("safeRedirect", () => {
  it.each([
    ["/c/conta-1/calendario", "/c/conta-1/calendario"],
    ["/postagens?status=FALHOU", "/postagens?status=FALHOU"],
    ["/", "/"],
  ])("aceita o caminho interno %s", (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });

  it.each([
    ["endereço absoluto", "https://site-falso.com"],
    ["protocolo relativo", "//site-falso.com"],
    ["barra invertida", "/\\site-falso.com"],
    ["tabulação", "/\t/site-falso.com"],
    ["quebra de linha", "/\n/site-falso.com"],
    ["espaço", "/ /site-falso.com"],
    ["javascript", "javascript:alert(1)"],
    ["vazio", ""],
  ])("recusa %s e volta para a tela inicial", (_case, input) => {
    expect(safeRedirect(input)).toBe(DEFAULT_REDIRECT);
  });

  it("recusa ausência de destino", () => {
    expect(safeRedirect(null)).toBe(DEFAULT_REDIRECT);
    expect(safeRedirect(undefined)).toBe(DEFAULT_REDIRECT);
  });
});
