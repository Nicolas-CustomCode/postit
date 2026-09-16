"use client";

import { useActionState } from "react";
import type { ActiveSession } from "@repo/shared";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { revokeOtherSessionsAction } from "@/lib/actions/profile";
import type { ActionResult } from "@/lib/actions/result";

/** As sessões abertas, com a deste aparelho marcada. */
export function SessionsList({ sessions }: { readonly sessions: readonly ActiveSession[] }) {
  const [resultado, encerrar, encerrando] = useActionState<ActionResult<{ revoked: number }> | null, FormData>(
    revokeOtherSessionsAction,
    null,
  );

  const outras = sessions.filter((sessao) => !sessao.current).length;

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {sessions.map((sessao) => (
          <li key={sessao.id} className="flex flex-col gap-0.5 rounded-xl border p-3 text-sm">
            <span className="font-semibold">
              {sessao.current ? "Este aparelho" : "Outro aparelho"}
              {sessao.ip === null ? null : <span className="font-normal text-muted-foreground"> · {sessao.ip}</span>}
            </span>
            <span className="text-muted-foreground">
              Último uso: {new Date(sessao.lastUsedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
            </span>
            {sessao.userAgent === null ? null : (
              <span className="truncate text-xs text-muted-foreground">{sessao.userAgent}</span>
            )}
          </li>
        ))}
      </ul>

      <FormError result={resultado} />

      {outras === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum outro aparelho está conectado.</p>
      ) : (
        <form action={encerrar}>
          <Button type="submit" variant="secondary" disabled={encerrando} className="h-11 w-full">
            {encerrando ? "Encerrando…" : `Sair dos outros ${outras === 1 ? "aparelhos" : `${outras} aparelhos`}`}
          </Button>
        </form>
      )}
    </div>
  );
}
