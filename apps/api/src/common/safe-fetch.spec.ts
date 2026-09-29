import { isPublicAddress, nextHop, safeFetch, SafeFetchError } from "./safe-fetch";

const OPCOES = { maxBytes: 1024, timeoutMs: 2000 };

describe("safe-fetch", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.20.0.5",
    "192.168.0.10",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "::1",
    "::",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:8.8.8.8",
    "64:ff9b::a00:1",
  ])("recusa %s", (endereco) => {
    expect(isPublicAddress(endereco)).toBe(false);
  });

  it.each(["8.8.8.8", "104.18.32.7", "2606:4700::6810:2007"])("aceita %s", (endereco) => {
    expect(isPublicAddress(endereco)).toBe(true);
  });

  it("nome que não é IP não é endereço público", () => {
    expect(isPublicAddress("exemplo.com")).toBe(false);
  });

  it.each([
    ["http", "http://exemplo.com/ficha.json", "só https"],
    ["IP privado escrito na URL", "https://10.0.0.5/ficha.json", "o endereço não é público"],
    ["IPv6 de loopback escrito na URL", "https://[::1]/ficha.json", "o endereço não é público"],
    ["metadados da nuvem", "https://169.254.169.254/latest/", "o endereço não é público"],
    ["credencial na URL", "https://a:b@exemplo.com/", "endereço com credenciais"],
    ["lixo", "não é url", "endereço inválido"],
  ])("recusa %s antes de conectar", async (_caso, url, motivo) => {
    await expect(safeFetch(url, OPCOES)).rejects.toThrow(new SafeFetchError(motivo));
  });

  it("recusa nome que resolve para loopback, na hora da conexão", async () => {
    await expect(safeFetch("https://localhost:1/ficha.json", OPCOES)).rejects.toThrow(
      new SafeFetchError("o endereço não é público"),
    );
  });

  describe("o próximo salto", () => {
    const ATUAL = "https://arquivos.exemplo.com/download/abc?sig=1";

    it("relativo resolve contra o atual", () => {
      expect(nextHop(ATUAL, "/blob/xyz")).toBe("https://arquivos.exemplo.com/blob/xyz");
    });

    it("absoluto em outro domínio segue — e passa pelas travas na busca seguinte", () => {
      expect(nextHop(ATUAL, "https://cdn.exemplo.net/x.jpg")).toBe("https://cdn.exemplo.net/x.jpg");
    });

    it("http, sem destino ou lixo são recusados", () => {
      expect(() => nextHop(ATUAL, "http://cdn.exemplo.net/x.jpg")).toThrow(new SafeFetchError("só https"));
      expect(() => nextHop(ATUAL, null)).toThrow(new SafeFetchError("redirecionamento sem destino"));
      expect(() => nextHop(ATUAL, "https://[::zz]/")).toThrow(new SafeFetchError("redirecionamento inválido"));
    });

    it("destino interno é recusado na busca do salto, antes de conectar", async () => {
      await expect(safeFetch(nextHop(ATUAL, "https://10.0.0.5/segredo"), OPCOES)).rejects.toThrow(
        new SafeFetchError("o endereço não é público"),
      );
    });
  });

  it("a mensagem de erro nunca traz a URL", async () => {
    const url = "https://10.0.0.5/download?sig=segredo";
    await expect(safeFetch(url, OPCOES)).rejects.not.toThrow(/segredo/);
  });
});
