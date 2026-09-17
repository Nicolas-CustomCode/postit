import { accountFromPath } from "./account-path";

/**
 * Esta função decide em que conta o sistema acha que a pessoa está. Duas partes
 * a consultam — o proxy, para gravar o cookie da última conta, e a casca, para
 * marcar a conta ativa — e elas **têm que concordar**. O teste existe para essa
 * concordância não depender de ninguém lembrar dela.
 */
describe("accountFromPath", () => {
  it("lê a conta e a seção de um endereço de conta", () => {
    expect(accountFromPath("/c/loja.aurora/postagens")).toEqual({
      username: "loja.aurora",
      section: "postagens",
    });
  });

  it("sem seção no endereço, abre no calendário", () => {
    expect(accountFromPath("/c/loja.aurora")).toEqual({ username: "loja.aurora", section: "calendario" });
  });

  it("ignora o que vem depois da seção", () => {
    // /c/<conta>/postagens/<id> continua sendo a seção "postagens": é isso que
    // faz trocar de conta manter a pessoa na mesma tela.
    expect(accountFromPath("/c/loja.aurora/postagens/0195f2a0").section).toBe("postagens");
  });

  it.each(["/contas", "/perfil", "/", "/entrar", "/contas/conectar"])(
    "tela geral não tem conta ativa: %s",
    (caminho) => {
      expect(accountFromPath(caminho).username).toBeNull();
    },
  );

  it.each(["/c", "/c/", "/c//calendario"])("endereço de conta incompleto não inventa conta: %s", (caminho) => {
    expect(accountFromPath(caminho).username).toBeNull();
  });

  it("decodifica o @ que veio escapado no endereço", () => {
    expect(accountFromPath("/c/loja%2Eaurora/metricas").username).toBe("loja.aurora");
  });

  /**
   * O caso que apagaria a tela: `decodeURIComponent` lança em percentual
   * malformado. Dentro de um componente de cliente, isso derruba o render da
   * casca inteira — e o projeto não tem `error.tsx` para segurar.
   */
  it.each(["/c/%zz/calendario", "/c/%/calendario", "/c/%E0%A4%A/calendario"])(
    "endereço malformado vira 'nenhuma conta' em vez de lançar: %s",
    (caminho) => {
      expect(() => accountFromPath(caminho)).not.toThrow();
      expect(accountFromPath(caminho).username).toBeNull();
    },
  );

  it("não confunde caminho que só começa com c", () => {
    expect(accountFromPath("/contas/conectar").username).toBeNull();
    expect(accountFromPath("/calendario").username).toBeNull();
  });
});
