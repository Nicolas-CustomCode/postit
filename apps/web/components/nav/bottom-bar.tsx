"use client";

import { Bell, CalendarDays, Menu, Plus, SquarePen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import type { SessionUser } from "@repo/shared";
import { UserCard } from "@/components/nav/user-card";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { hidesBottomBar, hrefFor, visibleItems } from "@/lib/nav/items";
import { useShellAccount } from "@/lib/nav/use-shell-account";
import { cn } from "@/lib/utils";

/**
 * A barra inferior do celular: **cinco alvos**, com "Nova postagem" no centro
 * (docs/13, "Navegação"; artboard `CalendarioCelular`). O que não cabe vai para
 * a folha "Mais".
 *
 * Detalhes que não são enfeite:
 * - a folga de baixo soma `env(safe-area-inset-bottom)`: sem isso a barra fica
 *   atrás da barra de gestos do Android e do indicador do iPhone;
 * - cada alvo tem no mínimo 44 px, como manda a acessibilidade, e o teste de
 *   tela mede isso;
 * - o item ativo fica em peso 700, além de mudar de cor: cor sozinha não é
 *   sinal suficiente.
 */
export function BottomBar({
  user,
  rememberedAccount,
}: {
  readonly user: SessionUser;
  readonly rememberedAccount: string | null;
}): ReactNode {
  const pathname = usePathname();
  const [aberto, setAberto] = useState(false);

  /*
   * Nas telas gerais — Contas, Perfil, Acervo — o endereço não tem conta, e a
   * pílula do topo não aparece. Sem um destino, os dois primeiros alvos
   * apontavam para `/contas`: de lá, tocar em Calendário devolvia para a mesma
   * tela, e no celular não sobrava caminho de volta para as telas da conta.
   *
   * ⚠️ **Pelo `useShellAccount`, e não por `?? rememberedAccount`.** A prop vem
   * do layout, que no App Router congela na primeira carga completa (regra 25):
   * entrar numa conta, trocar para outra e ir ao Perfil mandava a barra de volta
   * para a **primeira**, não para a última usada.
   */
  const destino = useShellAccount(rememberedAccount);
  const conta = (secao: string) => (destino === null ? "/contas" : `/c/${destino}/${secao}`);
  const restantes = visibleItems({ superAdmin: user.superAdmin, permissions: user.permissions }).filter(
    (item) => !["calendario", "postagens", "notificacoes"].includes(item.key),
  );

  // Depois dos hooks: a ordem deles não pode depender do endereço.
  if (hidesBottomBar(pathname)) return null;

  return (
    <nav
      aria-label="Menu principal"
      className="sticky bottom-0 z-10 grid grid-cols-5 items-center border-t bg-card px-2 pt-2 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:hidden"
    >
      <BottomLink href={conta("calendario")} label="Calendário" icon={CalendarDays} pathname={pathname} />
      <BottomLink href={conta("postagens")} label="Postagens" icon={SquarePen} pathname={pathname} />

      {/* O "+" leva direto a compor. Antes caía na lista, e era um toque a mais
          para chegar onde a pessoa já queria ir. */}
      <Link href={conta("postagens/nova")} className="flex justify-center" aria-label="Nova postagem">
        <span className="flex size-14 items-center justify-center rounded-[18px] bg-primary text-primary-foreground shadow-[0_6px_18px_rgba(53,68,230,0.35)]">
          <Plus className="size-6.5" strokeWidth={2.5} aria-hidden />
        </span>
      </Link>

      <BottomLink href="/notificacoes" label="Notificações" icon={Bell} pathname={pathname} disabled />

      <Sheet open={aberto} onOpenChange={setAberto}>
        <SheetTrigger
          className="flex min-h-12 flex-col items-center justify-center gap-1 text-[11px] font-semibold text-muted-foreground"
          aria-label="Mais telas"
        >
          <Menu className="size-5.5" strokeWidth={2} aria-hidden />
          Mais
        </SheetTrigger>

        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle className="font-heading">Mais</SheetTitle>
          </SheetHeader>

          <ul className="flex flex-col gap-0.5 px-2 pb-4">
            {restantes.map((item) => {
              // Pelo mesmo motivo dos alvos da barra: Métricas é tela de conta,
              // e ficaria desabilitada em Contas ou Perfil sem o destino.
              const href = hrefFor(item, destino);
              const indisponivel = item.comingIn !== undefined || href === null;
              const Icone = item.icon;
              const linha = "flex min-h-12 items-center gap-3 rounded-[10px] px-2.5 text-sm";

              return (
                <li key={item.key}>
                  {indisponivel ? (
                    <span className={cn(linha, "font-medium text-muted-foreground/60")}>
                      <Icone className="size-5.5" strokeWidth={2} aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      <span className="text-[11px]">{item.comingIn ?? "—"}</span>
                    </span>
                  ) : (
                    <Link href={href} onClick={() => setAberto(false)} className={cn(linha, "font-medium hover:bg-muted")}>
                      <Icone className="size-5.5" strokeWidth={2} aria-hidden />
                      <span className="flex-1">{item.label}</span>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>

          {/*
           * O cartão de quem está usando fecha a folha, como fecha a barra
           * lateral no computador. No celular é o único lugar onde ele cabe sem
           * roubar um dos cinco alvos da barra.
           */}
          <UserCard user={user} className="mx-4 mb-6" />
        </SheetContent>
      </Sheet>
    </nav>
  );
}

function BottomLink({
  href,
  label,
  icon: Icone,
  pathname,
  disabled = false,
}: {
  readonly href: string;
  readonly label: string;
  readonly icon: typeof Bell;
  readonly pathname: string;
  readonly disabled?: boolean;
}): ReactNode {
  const ativo = pathname === href || pathname.startsWith(`${href}/`);
  const classe = "flex min-h-12 flex-col items-center justify-center gap-1 text-[11px]";

  if (disabled) {
    return (
      <span className={cn(classe, "font-semibold text-muted-foreground/50")} aria-disabled title="Chega na Fase 1">
        <Icone className="size-5.5" strokeWidth={2} aria-hidden />
        {label}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      className={cn(classe, ativo ? "font-bold text-primary" : "font-semibold text-muted-foreground")}
    >
      <Icone className="size-5.5" strokeWidth={2} aria-hidden />
      {label}
    </Link>
  );
}
