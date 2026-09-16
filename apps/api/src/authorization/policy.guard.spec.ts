import "reflect-metadata";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { AuthContext } from "../auth/session.service";
import { AppError } from "../common/errors";
import { AnyAuthenticated, Public, RecentConfirmation, RequirePermission, SuperAdmin } from "./policy.decorators";
import { PolicyGuard } from "./policy.guard";

/**
 * A matriz de permissões (RF-I04) e o "negar por padrão" (RNF-13).
 *
 * As rotas abaixo existem só neste arquivo: elas representam cada política sem
 * depender de o produto já ter rotas de postagem ou de conta.
 */
class Rotas {
  @Public()
  aberta(): void {}

  @AnyAuthenticated()
  lendo(): void {}

  @RequirePermission("POST_EDIT")
  editando(): void {}

  @RequirePermission("POST_EDIT", "POST_APPROVE")
  aprovandoEEditando(): void {}

  @SuperAdmin()
  administrando(): void {}

  @AnyAuthenticated()
  @RecentConfirmation()
  confirmando(): void {}

  /** De propósito sem decorator: é o caso que o guard precisa recusar. */
  esquecida(): void {}
}

const guard = new PolicyGuard(new Reflector());

function auth(overrides: Partial<AuthContext> = {}): AuthContext {
  const agora = new Date();
  return {
    sessionId: "sessao",
    userId: "usuario",
    name: "Pessoa",
    email: "pessoa@exemplo.com",
    superAdmin: false,
    permissions: [],
    verifiedAt: agora,
    recentlyConfirmed: true,
    createdAt: agora,
    expiresAt: agora,
    ...overrides,
  };
}

function contexto(method: keyof Rotas, logada?: AuthContext): ExecutionContext {
  const request = { auth: logada };
  return {
    getHandler: () => Rotas.prototype[method],
    getClass: () => Rotas,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

/** O código do erro, que é o que a tela lê — nunca a mensagem. */
function recusa(method: keyof Rotas, logada?: AuthContext): string {
  try {
    guard.canActivate(contexto(method, logada));
    return "PASSOU";
  } catch (erro) {
    return erro instanceof AppError ? erro.code : "OUTRO ERRO";
  }
}

describe("PolicyGuard", () => {
  it("recusa rota sem política declarada, mesmo para super admin", () => {
    expect(recusa("esquecida")).toBe("ROUTE_WITHOUT_POLICY");
    expect(recusa("esquecida", auth({ superAdmin: true }))).toBe("ROUTE_WITHOUT_POLICY");
  });

  it("rota pública passa sem sessão", () => {
    expect(recusa("aberta")).toBe("PASSOU");
  });

  it("rota autenticada exige sessão", () => {
    expect(recusa("lendo")).toBe("UNAUTHENTICATED");
    expect(recusa("lendo", auth())).toBe("PASSOU");
  });

  describe("permissões", () => {
    it("recusa quem não tem a permissão e aceita quem tem", () => {
      expect(recusa("editando", auth())).toBe("FORBIDDEN");
      expect(recusa("editando", auth({ permissions: ["POST_EDIT"] }))).toBe("PASSOU");
    });

    it("exige TODAS as permissões declaradas na rota", () => {
      expect(recusa("aprovandoEEditando", auth({ permissions: ["POST_EDIT"] }))).toBe("FORBIDDEN");
      expect(recusa("aprovandoEEditando", auth({ permissions: ["POST_EDIT", "POST_APPROVE"] }))).toBe("PASSOU");
    });

    it("super admin passa sem nenhuma permissão na lista", () => {
      expect(recusa("editando", auth({ superAdmin: true }))).toBe("PASSOU");
      expect(recusa("aprovandoEEditando", auth({ superAdmin: true }))).toBe("PASSOU");
    });

    it("permissão não vira super admin", () => {
      const comTudo = auth({ permissions: ["POST_EDIT", "POST_APPROVE", "POST_SCHEDULE", "ACCOUNT_MANAGE"] });
      expect(recusa("administrando", comTudo)).toBe("FORBIDDEN");
      expect(recusa("administrando", auth({ superAdmin: true }))).toBe("PASSOU");
    });
  });

  it("confirmação recente é exigida além da sessão", () => {
    expect(recusa("confirmando", auth({ recentlyConfirmed: false }))).toBe("RECENT_CONFIRMATION_REQUIRED");
    expect(recusa("confirmando", auth({ recentlyConfirmed: true }))).toBe("PASSOU");
    // Nem super admin fura: é justamente para ação administrativa que ela existe.
    expect(recusa("confirmando", auth({ superAdmin: true, recentlyConfirmed: false }))).toBe(
      "RECENT_CONFIRMATION_REQUIRED",
    );
  });
});
