import { passwordProblem } from "./password";

describe("passwordProblem", () => {
  const email = "pessoa@exemplo.com";

  it("aceita 12 caracteres sem exigir símbolo, número ou maiúscula", () => {
    expect(passwordProblem("frase simples", email)).toBeNull();
  });

  it("recusa 11 caracteres", () => {
    expect(passwordProblem("onzecaracte", email)).toBe("TOO_SHORT");
  });

  it("recusa mais de 128 caracteres", () => {
    expect(passwordProblem("a".repeat(129), email)).toBe("TOO_LONG");
    expect(passwordProblem("a".repeat(128), email)).toBeNull();
  });

  it("conta emoji como um caractere", () => {
    expect(passwordProblem("🔒".repeat(12), email)).toBeNull();
  });

  it("recusa senha igual ao e-mail, sem diferenciar maiúsculas", () => {
    expect(passwordProblem("Pessoa@Exemplo.com", email)).toBe("SAME_AS_EMAIL");
  });
});
