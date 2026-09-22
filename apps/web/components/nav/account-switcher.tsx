"use client";

import { AtSign, Check, ChevronDown, ChevronsUpDown, Search, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import type { AccountSummary } from "@repo/shared";
import { AccountAvatar } from "@/components/nav/account-avatar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useActiveAccount } from "@/lib/nav/use-active-account";
import { cn } from "@/lib/utils";

/**
 * O seletor de conta (RF-A09), nas duas formas do artefato de identidade.
 *
 * Trocar de conta é **navegar**: a conta ativa mora no endereço, nunca em estado
 * no servidor (AGENTS.md, regra 24). É isso que permite duas abas em contas
 * diferentes e faz um link levar direto à conta certa.
 *
 * `variant` escolhe a forma, não o conteúdo:
 * - `sidebar` — rótulo "CONTA", botão de 52 px no topo da barra lateral e um
 *   cartão ancorado nele (artboard `SeletorConta`);
 * - `mobile` — a pílula do topo da tela do celular, que abre uma folha de baixo
 *   (artboard `CalendarioCelular`).
 *
 * A lista é a mesma nos dois: um lugar só para mudar quando a conta ganhar mais
 * informação.
 */
export function AccountSwitcher({
  accounts,
  variant,
  fallbackAccount = null,
}: {
  readonly accounts: readonly AccountSummary[];
  readonly variant: "sidebar" | "mobile";
  /**
   * Qual conta mostrar quando o endereço não tem nenhuma — as telas gerais.
   *
   * Ausente na pílula do celular, e de propósito: lá ela some nas telas gerais
   * (docs/13), porque o espaço do topo é escasso e a barra inferior já leva de
   * volta à conta.
   */
  readonly fallbackAccount?: string | null;
}): ReactNode {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Do endereço, não de prop: o layout do servidor não reage à navegação.
  const { username: activeUsername, section: currentSection } = useActiveAccount();

  const mostrada = activeUsername ?? fallbackAccount;
  const ativa = accounts.find((conta) => conta.username === mostrada) ?? null;
  const rotulo =
    ativa === null ? "Escolher conta do Instagram" : `Conta ativa: ${ativa.username}. Trocar de conta`;

  function trocar(username: string): void {
    setOpen(false);
    router.push(`/c/${username}/${currentSection}`);
  }

  if (variant === "mobile") {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          aria-label={rotulo}
          className="flex min-h-11 max-w-full items-center gap-2.5 rounded-full border bg-card py-1 pr-3 pl-1 text-left"
        >
          {ativa === null ? (
            <>
              <span className="flex size-8.5 items-center justify-center rounded-full bg-muted">
                <AtSign className="size-4.5" strokeWidth={2} aria-hidden />
              </span>
              <span className="truncate text-[15px] font-bold">Nenhuma conta</span>
            </>
          ) : (
            <>
              <AccountAvatar account={ativa} className="size-8.5" />
              <span className="truncate text-[15px] font-bold">{ativa.name ?? ativa.username}</span>
            </>
          )}
          <ChevronDown className="size-4.5 shrink-0" strokeWidth={2} aria-hidden />
        </SheetTrigger>

        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle className="font-heading">Contas do Instagram</SheetTitle>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col px-2 pb-6">
            <ListaDeContas
              accounts={accounts}
              activeUsername={mostrada}
              onPick={trocar}
              onNavigate={() => setOpen(false)}
            />
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="px-1.5 text-[11px] font-bold tracking-[0.06em] text-muted-foreground uppercase">Conta</p>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={rotulo}
          className={cn(
            // A borda é sempre de 2 px, e só muda de cor ao abrir: no desenho ela
            // passa de 1 para 2 px, e isso empurraria o conteúdo um pixel.
            "flex min-h-13 w-full items-center gap-2.5 rounded-xl border-2 bg-muted px-2.5 py-2 text-left",
            "focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
            open ? "border-primary ring-4 ring-accent" : "border-border",
          )}
        >
          {ativa === null ? (
            <>
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-background">
                <AtSign className="size-4.5" strokeWidth={2} aria-hidden />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-bold">Nenhuma conta</span>
            </>
          ) : (
            <>
              <AccountAvatar account={ativa} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-bold">{ativa.name ?? ativa.username}</span>
                <SegundaLinha account={ativa} />
              </span>
            </>
          )}
          <ChevronsUpDown className="size-4.5 shrink-0" strokeWidth={2} aria-hidden />
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={8}
          // Mesma largura do botão: o cartão continua a coluna, em vez de virar
          // um painel solto sobre o conteúdo.
          className="w-[var(--radix-popover-trigger-width)] rounded-[14px] p-2 shadow-[0_16px_40px_rgba(16,19,28,0.14)]"
        >
          <ListaDeContas
            accounts={accounts}
            activeUsername={mostrada}
            onPick={trocar}
            onNavigate={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * A lista em si: busca, contas e "Gerenciar contas".
 *
 * A busca só aparece com mais de cinco contas — abaixo disso ela ocupa a linha
 * que a conta ocuparia, e não poupa nenhum rolar de tela.
 */
function ListaDeContas({
  accounts,
  activeUsername,
  onPick,
  onNavigate,
}: {
  readonly accounts: readonly AccountSummary[];
  readonly activeUsername: string | null;
  readonly onPick: (username: string) => void;
  readonly onNavigate: () => void;
}): ReactNode {
  const [busca, setBusca] = useState("");

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (termo.length === 0) return accounts;
    return accounts.filter(
      (conta) => conta.username.toLowerCase().includes(termo) || (conta.name ?? "").toLowerCase().includes(termo),
    );
  }, [accounts, busca]);

  return (
    <div className="flex min-h-0 flex-col gap-1">
      {accounts.length > 5 ? (
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 opacity-60" aria-hidden />
          <Input
            value={busca}
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Buscar conta"
            aria-label="Buscar conta"
            className="h-11 rounded-[10px] pl-9 md:h-10"
          />
        </div>
      ) : null}

      {accounts.length === 0 ? (
        <p className="px-2.5 py-3 text-sm text-muted-foreground">
          Nenhuma conta conectada ainda. Conecte a primeira para começar a agendar.
        </p>
      ) : (
        <ul className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
          {filtradas.map((conta) => {
            const ativa = conta.username === activeUsername;

            return (
              <li key={conta.id}>
                <button
                  type="button"
                  onClick={() => onPick(conta.username)}
                  aria-current={ativa ? "true" : undefined}
                  className={cn(
                    "flex min-h-13 w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left",
                    "hover:bg-muted focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none",
                    ativa && "bg-accent hover:bg-accent",
                  )}
                >
                  <AccountAvatar account={conta} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn("truncate text-sm", ativa ? "font-bold text-primary" : "font-semibold")}>
                      {conta.name ?? conta.username}
                    </span>
                    <SegundaLinha account={conta} />
                  </span>
                  {ativa ? <Check className="size-4.5 shrink-0 text-primary" strokeWidth={2.5} aria-hidden /> : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mx-0.5 my-1 h-px bg-border" />

      <Link
        href="/contas"
        onClick={onNavigate}
        className="flex h-11 items-center gap-2.5 rounded-[10px] px-2.5 text-sm font-semibold hover:bg-muted"
      >
        <Settings className="size-4.5 shrink-0" strokeWidth={2} aria-hidden />
        Gerenciar contas
      </Link>
    </div>
  );
}

/**
 * A segunda linha da conta: o `@`, ou o aviso que toma o lugar dele.
 *
 * O aviso é texto colorido, e não um ícone ao lado: quem precisa reconectar
 * precisa saber **em quantos dias**, e um triângulo não diz isso. Cor sozinha
 * também não informa — a frase carrega o sentido inteiro.
 */
function SegundaLinha({ account }: { readonly account: AccountSummary }): ReactNode {
  if (account.warning === "TOKEN_EXPIRED") {
    return <span className="truncate text-xs font-medium text-destructive">Sem acesso · reconectar</span>;
  }

  if (account.warning === "TOKEN_EXPIRING") {
    const dias = Math.max(account.tokenExpiresInDays, 0);

    return (
      <span className="truncate text-xs font-medium text-warning">
        Reconectar em {dias} {dias === 1 ? "dia" : "dias"}
      </span>
    );
  }

  return <span className="truncate text-xs text-muted-foreground">@{account.username}</span>;
}
