"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { AccountSummary, SessionUser } from "@repo/shared";
import { AccountSwitcher } from "@/components/nav/account-switcher";
import { UserCard } from "@/components/nav/user-card";
import { BrandSvg } from "@/components/brand";
import { hrefFor, visibleItems, type NavItem } from "@/lib/nav/items";
import { useActiveAccount } from "@/lib/nav/use-active-account";
import { cn } from "@/lib/utils";

/**
 * A barra lateral do computador (docs/13, "Navegação"; artboard
 * `ComposicaoDesktop` do artefato de identidade).
 *
 * De cima para baixo: marca, seletor de conta, "Nova postagem", os dois grupos
 * do menu — "Nesta conta", que segue o seletor, e "Geral", que vale para todas
 * as contas — e o cartão de quem está usando, colado no rodapé.
 *
 * Só aparece a partir de `md`; no celular quem navega é a barra inferior.
 */
export function Sidebar({
  user,
  accounts,
}: {
  readonly user: SessionUser;
  readonly accounts: readonly AccountSummary[];
}): ReactNode {
  const { username: activeUsername } = useActiveAccount();
  const itens = visibleItems({ superAdmin: user.superAdmin, permissions: user.permissions });
  const daConta = itens.filter((item) => item.scope === "account");
  const gerais = itens.filter((item) => item.scope === "general");

  return (
    <aside className="hidden w-[248px] shrink-0 flex-col gap-5 border-r bg-card px-3.5 py-5 md:flex">
      <div className="flex items-center gap-2.5 px-1.5">
        <BrandSvg className="size-8" />
        <span className="font-heading text-[22px] font-extrabold tracking-[-0.02em]">PostIt</span>
      </div>

      <AccountSwitcher accounts={accounts} variant="sidebar" />

      <NovaPostagem activeUsername={activeUsername} />

      <nav className="flex min-h-0 flex-col gap-0.5 overflow-y-auto" aria-label="Menu principal">
        <NavGroup title="Nesta conta" items={daConta} activeUsername={activeUsername} />
        <NavGroup title="Geral" items={gerais} activeUsername={activeUsername} spaced />
      </nav>

      {/* Empurra o cartão do usuário para o rodapé, seja qual for o tamanho do menu. */}
      <div className="flex-1" />

      <UserCard user={user} />
    </aside>
  );
}

/**
 * O botão principal da tela. Sem conta conectada ele leva às contas, porque
 * compor sem conta não é possível — e um botão desabilitado sem explicação é o
 * que faz a pessoa achar que o sistema quebrou.
 */
function NovaPostagem({ activeUsername }: { readonly activeUsername: string | null }): ReactNode {
  return (
    <Link
      href={activeUsername === null ? "/contas" : `/c/${activeUsername}/postagens`}
      className={cn(
        "flex h-10 items-center justify-center gap-2 rounded-[10px] bg-primary text-sm font-semibold text-primary-foreground",
        "hover:bg-primary/90 focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
      )}
    >
      <Plus className="size-4.5" strokeWidth={2.5} aria-hidden />
      Nova postagem
    </Link>
  );
}

function NavGroup({
  title,
  items,
  activeUsername,
  spaced = false,
}: {
  readonly title: string;
  readonly items: readonly NavItem[];
  readonly activeUsername: string | null;
  readonly spaced?: boolean;
}): ReactNode {
  const pathname = usePathname();

  return (
    <>
      <p
        className={cn(
          "px-2.5 pb-1.5 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase",
          spaced && "pt-[18px]",
        )}
      >
        {title}
      </p>

      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const href = hrefFor(item, activeUsername);
          const indisponivel = item.comingIn !== undefined || href === null;
          const ativo = href !== null && (pathname === href || pathname.startsWith(`${href}/`));
          const Icone = item.icon;
          const linha = "flex h-10 items-center gap-3 rounded-[10px] px-2.5 text-sm";

          // Tela que ainda não existe aparece apagada, dizendo quando chega. É
          // mais honesto do que um link que abre uma página vazia.
          if (indisponivel) {
            return (
              <li key={item.key}>
                <span
                  className={cn(linha, "cursor-not-allowed font-medium text-muted-foreground/60")}
                  title={item.comingIn === undefined ? "Conecte uma conta primeiro" : `Chega na ${item.comingIn}`}
                >
                  <Icone className="size-5" strokeWidth={2} aria-hidden />
                  <span className="flex-1">{item.label}</span>
                  <span className="text-[11px]">{item.comingIn ?? "—"}</span>
                </span>
              </li>
            );
          }

          return (
            <li key={item.key}>
              <Link
                href={href}
                aria-current={ativo ? "page" : undefined}
                className={cn(
                  linha,
                  "hover:bg-muted focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                  ativo ? "bg-accent font-bold text-primary hover:bg-accent" : "font-medium",
                )}
              >
                <Icone className="size-5" strokeWidth={2} aria-hidden />
                <span className="flex-1">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
