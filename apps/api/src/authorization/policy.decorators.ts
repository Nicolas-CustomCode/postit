import { applyDecorators, SetMetadata } from "@nestjs/common";
import type { Permission } from "@repo/shared";

/**
 * Como cada rota declara quem pode chamá-la (ADR 0015, seção 7).
 *
 * **Toda rota declara exatamente uma política.** Rota sem declaração é recusada
 * pelo guard e reprova o teste de política de rotas — de propósito: o contrário
 * (guard com exceção) faz esquecer ABRIR a rota, e ninguém revisa o que não
 * aparece.
 */
export const POLICY_KEY = "postit:policy";
export const PERMISSION_KEY = "postit:permission";
export const RECENT_CONFIRMATION_KEY = "postit:recent-confirmation";

export type RoutePolicy = "PUBLIC" | "AUTHENTICATED" | "PERMISSION" | "SUPER_ADMIN";

/** Sem sessão. Continua exigindo a chave interna: público é para o navegador. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(POLICY_KEY, "PUBLIC" satisfies RoutePolicy);

/** Qualquer pessoa logada. É a política das leituras. */
export const AnyAuthenticated = (): MethodDecorator & ClassDecorator =>
  SetMetadata(POLICY_KEY, "AUTHENTICATED" satisfies RoutePolicy);

/** Toda ação exige permissão do catálogo fixo. */
export const RequirePermission = (...permissions: Permission[]): MethodDecorator & ClassDecorator =>
  applyDecorators(SetMetadata(POLICY_KEY, "PERMISSION" satisfies RoutePolicy), SetMetadata(PERMISSION_KEY, permissions));

export const SuperAdmin = (): MethodDecorator & ClassDecorator =>
  SetMetadata(POLICY_KEY, "SUPER_ADMIN" satisfies RoutePolicy);

/**
 * Exige um código do aplicativo digitado há menos de 15 minutos (RF-I08).
 * Combina com as outras: é um adjetivo, não uma política.
 */
export const RecentConfirmation = (): MethodDecorator & ClassDecorator => SetMetadata(RECENT_CONFIRMATION_KEY, true);
