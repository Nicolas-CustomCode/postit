import { loginSchema, changePasswordSchema, consumeLinkSchema } from "./auth-schemas";
import { normalizeEmail } from "./email";
import { can } from "./permissions";
import { isRecoveryCodeShaped, isTotpCodeShaped, normalizeRecoveryCode } from "./recovery-code";

describe("normalizeEmail", () => {
  it("baixa a caixa e tira espaços das pontas", () => {
    expect(normalizeEmail("  Voce@Exemplo.COM ")).toBe("voce@exemplo.com");
  });

  it("é idempotente — aplicar duas vezes dá o mesmo", () => {
    const uma = normalizeEmail(" Alguem@Exemplo.com ");
    expect(normalizeEmail(uma)).toBe(uma);
  });
});

describe("can", () => {
  it("libera quem tem a permissão", () => {
    expect(can({ superAdmin: false, permissions: ["POST_EDIT"] }, "POST_EDIT")).toBe(true);
  });

  it("recusa quem não tem", () => {
    expect(can({ superAdmin: false, permissions: ["POST_EDIT"] }, "POST_APPROVE")).toBe(false);
  });

  it("super admin tem todas, mesmo com a lista vazia", () => {
    expect(can({ superAdmin: true, permissions: [] }, "ACCOUNT_MANAGE")).toBe(true);
  });
});

describe("códigos", () => {
  it("aceita o código de recuperação como a pessoa digitou", () => {
    expect(normalizeRecoveryCode(" a2b3c d4e5f ")).toBe("A2B3C-D4E5F");
    expect(isRecoveryCodeShaped(normalizeRecoveryCode("a2b3cd4e5f"))).toBe(true);
  });

  it("recusa código de recuperação com letra ambígua", () => {
    // O alfabeto não tem O nem 0, justamente para ninguém confundir no papel.
    expect(isRecoveryCodeShaped("ABCDO-12345")).toBe(false);
  });

  it("reconhece o código de 6 dígitos do aplicativo", () => {
    expect(isTotpCodeShaped("012345")).toBe(true);
    expect(isTotpCodeShaped("12345")).toBe(false);
    expect(isTotpCodeShaped("abcdef")).toBe(false);
  });
});

describe("schemas de entrada", () => {
  it("normaliza o e-mail do login", () => {
    const resultado = loginSchema.parse({ email: " Voce@Exemplo.com ", password: "uma-senha-qualquer" });
    expect(resultado.email).toBe("voce@exemplo.com");
  });

  it("recusa campo não previsto", () => {
    const resultado = loginSchema.safeParse({ email: "voce@exemplo.com", password: "x", lembrar: true });
    expect(resultado.success).toBe(false);
  });

  it("recusa senha acima do teto, que só serviria para pesar o argon2", () => {
    const enorme = "a".repeat(129);
    expect(loginSchema.safeParse({ email: "voce@exemplo.com", password: enorme }).success).toBe(false);
  });

  it("trocar senha exige o código do aplicativo junto", () => {
    const semCodigo = { currentPassword: "senha-atual-123", newPassword: "senha-nova-12345" };
    expect(changePasswordSchema.safeParse(semCodigo).success).toBe(false);
  });

  it("recusa token de link fora do formato, antes de qualquer consulta ao banco", () => {
    const entrada = { token: "curto-demais", purpose: "SIGNUP" as const, password: "senha-boa-de-teste" };
    expect(consumeLinkSchema.safeParse(entrada).success).toBe(false);
  });
});
