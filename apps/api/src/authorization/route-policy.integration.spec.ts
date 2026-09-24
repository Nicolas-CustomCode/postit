import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common";
import { DiscoveryService, MetadataScanner } from "@nestjs/core";
import { bootTestApp, type TestApp } from "../common/testing/test-app";
import { POLICY_KEY } from "./policy.decorators";

/**
 * Nenhuma rota sem política declarada (RNF-13, marco 3 da Fase 0).
 *
 * A descoberta é automática, pelo DiscoveryService do Nest. Uma lista escrita à
 * mão envelhece em silêncio — foi a falha do `nossobuncker`, onde um decorator
 * foi consumido por uma edição e ninguém viu.
 */
describe("política das rotas", () => {
  let api: TestApp;

  beforeAll(async () => {
    api = await bootTestApp();
  });
  afterAll(() => api.close());

  /** Cada handler de rota com a política que vale para ele. */
  function routes(): { name: string; policy: unknown; method: RequestMethod }[] {
    const discovery = api.app.get(DiscoveryService);
    const scanner = api.app.get(MetadataScanner);
    const found: { name: string; policy: unknown; method: RequestMethod }[] = [];

    for (const wrapper of discovery.getControllers()) {
      const instance = wrapper.instance as object | undefined;
      if (instance === undefined || instance === null) continue;
      const prototype = Object.getPrototypeOf(instance) as object;

      for (const method of scanner.getAllMethodNames(prototype)) {
        const handler = (prototype as Record<string, unknown>)[method] as (() => unknown) | undefined;
        if (handler === undefined) continue;
        // Só é rota o que tem caminho registrado por @Get/@Post/etc.
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;

        found.push({
          name: `${wrapper.metatype?.name ?? "?"}.${method}`,
          // A ordem é a mesma do guard: método primeiro, classe depois.
          policy:
            Reflect.getMetadata(POLICY_KEY, handler) ??
            Reflect.getMetadata(POLICY_KEY, wrapper.metatype ?? Object) ??
            undefined,
          method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod,
        });
      }
    }

    return found;
  }

  it("encontra rotas — senão este arquivo passaria vazio, que é o pior desfecho", () => {
    expect(routes().length).toBeGreaterThanOrEqual(10);
  });

  it("toda rota declara exatamente uma política de acesso", () => {
    const semPolitica = routes()
      .filter((route) => route.policy === undefined)
      .map((route) => route.name);

    expect(semPolitica).toEqual([]);
  });

  it("a política declarada é uma das conhecidas", () => {
    const conhecidas = ["PUBLIC", "AUTHENTICATED", "PERMISSION", "SUPER_ADMIN"];
    for (const route of routes()) {
      expect(conhecidas).toContain(route.policy);
    }
  });

  /*
   * A exceção da regra 5, fechada (ADR 0026): escrita com `@AnyAuthenticated` só
   * para o próprio perfil, para os próprios avisos do sino e para comentar postagem.
   * Escrita nova de qualquer logado
   * fora desta lista reprova — o lugar de uma ação sobre dado compartilhado é
   * `@RequirePermission`.
   */
  it("escrita de qualquer logado só nas rotas da lista fechada", () => {
    const escritasAbertas = routes()
      .filter((route) => route.policy === "AUTHENTICATED" && route.method !== RequestMethod.GET)
      .map((route) => route.name)
      .sort();

    expect(escritasAbertas).toEqual(
      [
        // O próprio perfil: sessão, senha, códigos de recuperação.
        "AuthController.logout",
        "AuthController.confirm",
        "AuthController.revokeSession",
        "AuthController.revokeOthers",
        "AuthController.changePassword",
        "AuthController.recoveryCodes",
        // Comentar postagem, e excluir o próprio comentário nos primeiros 5 minutos (ADR 0026).
        "PostsController.addComment",
        "PostsController.deleteComment",
        // Marcar os próprios avisos do sino como lidos (RF-J01): só a entrega de quem pede.
        "NotificationsController.markRead",
        "NotificationsController.markAllRead",
      ].sort(),
    );
  });
});
