import { AtSign, Plus, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { can, type AccountSummary } from "@repo/shared";
import { AccountAvatar } from "@/components/nav/account-avatar";
import { PageHeader } from "@/components/nav/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { listAccounts } from "@/lib/data/accounts";
import { requireSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Contas" };

/**
 * As contas do Instagram conectadas (RF-A01, RF-A04).
 *
 * É uma tela geral: não fica sob `/c/<conta>/` e funciona sem nenhuma conta —
 * é justamente a porta de entrada de quem ainda não conectou a primeira.
 */
export default async function ContasPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ desconhecida?: string }>;
}): Promise<ReactNode> {
  const [{ user }, contas, { desconhecida }] = await Promise.all([requireSession(), listAccounts(), searchParams]);
  const podeGerenciar = can(user, "ACCOUNT_MANAGE");

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pb-8 md:px-10 md:py-7">
      <PageHeader
        trail={["Geral", "Contas"]}
        title="Contas"
        description="As contas do Instagram em que o PostIt publica."
        actions={
          podeGerenciar ? (
            <Button asChild className="h-11 md:h-10">
              <Link href="/contas/conectar">
                <Plus className="size-5" strokeWidth={2} aria-hidden />
                Conectar conta
              </Link>
            </Button>
          ) : null
        }
      />

      {desconhecida === "1" ? (
        <Alert role="alert">
          <AlertDescription>
            Aquela conta não está mais conectada, ou o @ dela mudou no Instagram. Escolha uma conta abaixo.
          </AlertDescription>
        </Alert>
      ) : null}

      {contas.length === 0 ? (
        <EstadoVazio podeGerenciar={podeGerenciar} />
      ) : (
        <ul className="flex flex-col gap-3">
          {contas.map((conta) => (
            <li key={conta.id}>
              <LinhaDaConta conta={conta} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function EstadoVazio({ podeGerenciar }: { readonly podeGerenciar: boolean }): ReactNode {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
      <AtSign className="size-8 text-muted-foreground" strokeWidth={2} aria-hidden />
      <h2 className="font-heading text-xl font-bold">Nenhuma conta conectada</h2>
      <p className="max-w-md text-sm text-muted-foreground">
        Conecte a primeira conta profissional do Instagram para começar a agendar. Calendário, postagens e métricas
        passam a existir depois disso.
      </p>
      {podeGerenciar ? (
        <Button asChild className="h-11 md:h-10">
          <Link href="/contas/conectar">Conectar a primeira conta</Link>
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">Peça a quem administra o PostIt para conectar uma conta.</p>
      )}
    </div>
  );
}

function LinhaDaConta({ conta }: { readonly conta: AccountSummary }): ReactNode {
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3">
        <AccountAvatar account={conta} className="size-10" />

        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{conta.name ?? conta.username}</p>
          <p className="truncate text-sm text-muted-foreground">
            @{conta.username} · {conta.timezone}
          </p>
        </div>

        {conta.warning === null ? (
          <Badge variant="secondary" className="tabular-nums">
            Acesso válido por {conta.tokenExpiresInDays} dias
          </Badge>
        ) : (
          <Badge variant="destructive">
            <TriangleAlert className="size-3.5" aria-hidden />
            {conta.warning === "ACCESS_LOST"
              ? "Sem acesso · reconecte"
              : conta.warning === "TOKEN_EXPIRED"
                ? "Acesso expirado"
                : "Acesso vence em breve"}
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}
