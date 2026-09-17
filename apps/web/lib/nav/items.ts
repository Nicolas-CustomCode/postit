import {
  BarChart3,
  Bell,
  CalendarDays,
  HeartPulse,
  Images,
  AtSign,
  ShieldCheck,
  SquarePen,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@repo/shared";

/**
 * Os itens do menu, num lugar só.
 *
 * A barra lateral do computador, a barra inferior do celular e a folha "Mais"
 * leem daqui. Três listas separadas divergiriam, e o sintoma seria um item que
 * existe num tamanho de tela e some no outro.
 *
 * `scope` diz se a tela segue o seletor de conta ou vale para todas as contas
 * (docs/13, "Conta ativa"). `phase` marca o que ainda não existe: o item aparece
 * desabilitado, dizendo quando chega, em vez de levar a uma página vazia.
 */
export interface NavItem {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly scope: "account" | "general";
  /** Caminho dentro de /c/<conta>/ quando é da conta; caminho absoluto quando é geral. */
  readonly path: string;
  readonly permission?: Permission;
  readonly superAdminOnly?: boolean;
  /** Quando a tela ainda não existe, a fase em que ela chega. */
  readonly comingIn?: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "calendario", label: "Calendário", icon: CalendarDays, scope: "account", path: "calendario" },
  { key: "postagens", label: "Postagens", icon: SquarePen, scope: "account", path: "postagens" },
  { key: "metricas", label: "Métricas", icon: BarChart3, scope: "account", path: "metricas" },
  { key: "notificacoes", label: "Notificações", icon: Bell, scope: "general", path: "/notificacoes", comingIn: "Fase 1" },
  { key: "acervo", label: "Acervo", icon: Images, scope: "general", path: "/acervo", comingIn: "Fase 1" },
  { key: "contas", label: "Contas", icon: AtSign, scope: "general", path: "/contas" },
  { key: "saude", label: "Saúde", icon: HeartPulse, scope: "general", path: "/saude", comingIn: "Fase 5" },
  { key: "perfil", label: "Perfil", icon: UserRound, scope: "general", path: "/perfil" },
  {
    key: "admin",
    label: "Administração",
    icon: ShieldCheck,
    scope: "general",
    path: "/admin",
    superAdminOnly: true,
    comingIn: "Fase 4",
  },
];

/** O endereço final do item, já com a conta ativa quando for tela da conta. */
export function hrefFor(item: NavItem, activeAccount: string | null): string | null {
  if (item.scope === "general") return item.path;
  return activeAccount === null ? null : `/c/${activeAccount}/${item.path}`;
}

/**
 * Esconde o que a pessoa não pode fazer. **Não é proteção** — quem decide é a
 * API (AGENTS.md, regra 17). Serve para não mostrar botão que vai dar erro.
 */
export function visibleItems(actor: { superAdmin: boolean; permissions: readonly Permission[] }): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    if (item.superAdminOnly === true && !actor.superAdmin) return false;
    if (item.permission !== undefined && !actor.superAdmin && !actor.permissions.includes(item.permission)) return false;
    return true;
  });
}

/** Os cinco da barra inferior do celular, nesta ordem (docs/13, "Navegação"). */
export const MOBILE_KEYS = ["calendario", "postagens", "nova", "notificacoes", "mais"] as const;
