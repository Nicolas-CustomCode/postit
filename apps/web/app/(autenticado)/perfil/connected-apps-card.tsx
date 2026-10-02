"use client";

import { Bot } from "lucide-react";
import { useActionState, type ReactNode } from "react";
import type { ConnectedApp } from "@repo/shared";
import { FormError } from "@/components/form-error";
import { LocalDate } from "@/components/local-date";
import { revokeConnectedAppAction } from "@/lib/actions/profile";
import type { ActionResult } from "@/lib/actions/result";

/**
 * Os assistentes que a pessoa autorizou a compor em nome dela (ADR 0029, RF-K05) — o
 * ChatGPT conectado por MCP.
 *
 * Mesmo desenho dos "Aparelhos conectados", ao lado: o que está conectado, desde
 * quando, o último uso, e revogar. Componente de cliente pelas datas, no fuso de quem
 * lê (regra 7). Revogar derruba o acesso e a renovação na hora; para voltar, a pessoa
 * conecta de novo pelo ChatGPT.
 */
export function ConnectedAppsCard({
  apps,
  connectorUrl,
}: {
  readonly apps: readonly ConnectedApp[];
  /** O endereço que se cola no ChatGPT para conectar: `APP_URL/mcp`. */
  readonly connectorUrl: string;
}): ReactNode {
  return (
    <section aria-labelledby="aplicativos-conectados" className="flex flex-col rounded-2xl border bg-card p-4 md:p-5">
      <div className="flex flex-col gap-1 pb-2 md:flex-row md:items-baseline md:justify-between md:gap-4">
        <h2 id="aplicativos-conectados" className="font-heading text-[17px] font-bold md:text-lg">
          Aplicativos conectados
        </h2>
        <p className="text-[13px] text-muted-foreground">Assistentes que compõem rascunhos em seu nome.</p>
      </div>

      {apps.length === 0 ? (
        <div className="flex flex-col gap-1 border-t pt-3">
          <p className="text-sm">Nenhum assistente conectado.</p>
          <p className="text-[13px] break-all text-muted-foreground">
            Para conectar o ChatGPT, adicione o PostIt como conector com o endereço {connectorUrl}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col">
          {apps.map((app) => (
            <li key={app.id}>
              <AppRow app={app} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AppRow({ app }: { readonly app: ConnectedApp }): ReactNode {
  const [resultado, revogar, revogando] = useActionState<ActionResult<null> | null, FormData>(
    revokeConnectedAppAction,
    null,
  );

  return (
    <div className="flex flex-col gap-2.5 border-t py-3 md:flex-row md:items-center md:gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground">
        <Bot className="size-5" strokeWidth={2} aria-hidden />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-semibold">{app.clientName}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          Conectado desde <LocalDate iso={app.createdAt} format="curta" />
          {" · último uso "}
          <LocalDate iso={app.lastUsedAt} format="comHora" />
        </p>
        <FormError result={resultado} />
      </div>

      <form action={revogar}>
        <input type="hidden" name="grantId" value={app.id} />
        <button
          type="submit"
          disabled={revogando}
          className="flex h-11 w-full items-center justify-center rounded-[10px] border px-3.5 text-[13px] font-semibold hover:bg-muted disabled:opacity-60 md:h-9 md:w-auto"
        >
          {revogando ? "Revogando…" : "Revogar"}
        </button>
      </form>
    </div>
  );
}
