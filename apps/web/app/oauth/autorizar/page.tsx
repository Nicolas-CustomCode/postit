import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Check, X } from "lucide-react";
import { oauthAuthorizeSchema } from "@repo/shared";
import { AuthShell } from "@/components/auth-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getSession } from "@/lib/auth/session";
import { describeOAuthRequest } from "@/lib/data/oauth";
import { ConsentForm } from "./consent-form";

export const metadata: Metadata = { title: "Autorizar assistente" };

const PODE = [
  "Ver as contas conectadas e o acervo de imagens",
  "Enviar imagens novas ao acervo",
  "Criar rascunhos em seu nome e editar os que ele mesmo criou",
];
const NAO_PODE = [
  "Enviar para revisão, aprovar, agendar ou publicar",
  "Descartar postagens ou mexer nas contas",
  "Ver ou alterar rascunhos que você compôs na tela",
];

/**
 * A tela de permissão do assistente (ADR 0029, decisão 4) — o `authorization_endpoint`
 * que os metadados anunciam. Fora da casca, como o login: quem chega aqui veio do
 * ChatGPT, e a pergunta é uma só.
 *
 * Sem sessão, vai ao login **com o pedido inteiro no `voltar`**: o `requireSession()`
 * mandaria para `/entrar` sem destino, e o pedido se perderia. As duas etapas valem
 * igual (regra 11) — não há atalho para o assistente.
 */
export default async function AutorizarPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<ReactNode> {
  const raw = await searchParams;
  const params = Object.fromEntries(
    Object.entries(raw).flatMap(([name, value]) => (typeof value === "string" ? [[name, value]] : [])),
  );

  const session = await getSession();
  if (session === null) {
    redirect(`/entrar?voltar=${encodeURIComponent(`/oauth/autorizar?${new URLSearchParams(params)}`)}`);
  }

  const parsed = oauthAuthorizeSchema.safeParse(params);
  const description = parsed.success
    ? await describeOAuthRequest(parsed.data)
    : ({ kind: "INVALID", reason: "O pedido de autorização está incompleto." } as const);

  // Erro que volta ao cliente pelo endereço registrado dele, montado pela API.
  if (description.kind === "REDIRECT") redirect(description.redirectTo);

  if (description.kind === "INVALID" || !parsed.success) {
    return (
      <AuthShell title="Não foi possível autorizar">
        <Alert variant="destructive">
          <AlertDescription>
            {description.kind === "INVALID" ? description.reason : "O pedido de autorização está incompleto."} Volte
            ao assistente e tente conectar de novo.
          </AlertDescription>
        </Alert>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      step="Assistente"
      title={`Permitir que o ${description.clientName} componha rascunhos em seu nome?`}
      description={`Você está conectado como ${session.user.name}. Depois, você volta para ${description.redirectHost}.`}
      footer="O acesso vale por até 30 dias e cai com 7 dias sem uso. Você pode revogá-lo a qualquer momento no Perfil."
    >
      <div className="flex flex-col gap-6">
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[13px] font-bold tracking-[0.05em] text-muted-foreground uppercase">Ele poderá</h2>
          <ul className="flex flex-col gap-2">
            {PODE.map((item) => (
              <li key={item} className="flex gap-2.5 text-[15px] leading-normal">
                <Check aria-hidden className="mt-0.5 size-5 shrink-0 text-primary" />
                {item}
              </li>
            ))}
          </ul>
        </section>
        <section className="flex flex-col gap-2.5">
          <h2 className="text-[13px] font-bold tracking-[0.05em] text-muted-foreground uppercase">Ele não poderá</h2>
          <ul className="flex flex-col gap-2">
            {NAO_PODE.map((item) => (
              <li key={item} className="flex gap-2.5 text-[15px] leading-normal">
                <X aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
                {item}
              </li>
            ))}
          </ul>
        </section>

        {description.canAuthorize ? null : (
          <Alert>
            <AlertDescription>
              Você não tem a permissão de editar postagens, então não pode autorizar o assistente. Peça a um super
              admin.
            </AlertDescription>
          </Alert>
        )}

        <ConsentForm request={parsed.data} canAuthorize={description.canAuthorize} />
      </div>
    </AuthShell>
  );
}
