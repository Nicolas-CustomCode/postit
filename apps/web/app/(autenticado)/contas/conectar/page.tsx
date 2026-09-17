import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AUTH_ERROR_CODES, AUTH_ERROR_MESSAGES, can, type AuthErrorCode } from "@repo/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { startAccountConnectionAction } from "@/lib/actions/accounts";
import { requireSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Conectar conta" };

/**
 * Antes do OAuth, os dois passos que a Meta exige (RF-A08).
 *
 * Eles existem porque o aplicativo fica em modo de desenvolvimento: só contas
 * cadastradas como testadoras conseguem autorizar. Quem pula esses passos recebe
 * um erro cru da Meta, e a mensagem não explica o que fazer — por isso a tela
 * explica antes.
 */
export default async function ConectarContaPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ erro?: string }>;
}): Promise<ReactNode> {
  const [{ user }, { erro }] = await Promise.all([requireSession(), searchParams]);
  // Esconder não é proteger: a API recusa de novo (ADR 0015). Aqui é para não
  // mostrar um caminho que terminaria em 403.
  if (!can(user, "ACCOUNT_MANAGE")) notFound();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
      <div>
        <Link href="/contas" className="flex items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeft className="size-4" aria-hidden />
          Contas
        </Link>
        <h1 className="font-heading text-[28px] font-extrabold tracking-tight">Conectar conta</h1>
        <p className="text-muted-foreground">Dois passos no Instagram antes de autorizar aqui.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">1. A conta precisa ser profissional</CardTitle>
          <CardDescription>Só contas Business ou Creator podem publicar por aplicativo.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No aplicativo do Instagram: Configurações → Tipo de conta e ferramentas → Mudar para conta profissional.
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">2. A conta precisa aceitar o convite de testadora</CardTitle>
          <CardDescription>Enquanto o PostIt estiver em desenvolvimento, só contas convidadas entram.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            Quem administra o aplicativo na Meta adiciona a conta como <strong>Instagram Tester</strong>. Depois, a
            própria conta aceita o convite em instagram.com → Configurações → Aplicativos e sites → Convites de
            testador.
          </p>
          <p>Sem esse aceite, a autorização falha com um erro que não explica o motivo.</p>
        </CardContent>
      </Card>

      {erro === undefined ? null : (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{mensagemDoRetorno(erro)}</AlertDescription>
        </Alert>
      )}

      <form action={startAccountConnectionAction}>
        <Button type="submit" className="h-11 w-full md:h-10 md:w-auto">
          Autorizar no Instagram
        </Button>
      </form>
    </main>
  );
}

/**
 * O que deu errado na volta da Meta, em português e sem repassar a mensagem dela.
 *
 * O código vem do vocabulário fechado de `@repo/shared`, e a tela decide por ele
 * — nunca pelo texto. Código desconhecido cai na mensagem genérica em vez de
 * aparecer cru para a pessoa.
 */
function mensagemDoRetorno(code: string): string {
  const conhecido = (AUTH_ERROR_CODES as readonly string[]).includes(code);
  return conhecido ? AUTH_ERROR_MESSAGES[code as AuthErrorCode] : AUTH_ERROR_MESSAGES.INTERNAL_ERROR;
}
