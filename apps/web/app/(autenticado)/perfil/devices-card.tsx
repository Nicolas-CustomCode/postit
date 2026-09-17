"use client";

import { Monitor, Smartphone } from "lucide-react";
import { useActionState, type ReactNode } from "react";
import { describeDevice, isHandheld, type ActiveSession } from "@repo/shared";
import { FormError } from "@/components/form-error";
import { LocalDate } from "@/components/local-date";
import { Button } from "@/components/ui/button";
import { revokeOtherSessionsAction, revokeSessionAction } from "@/lib/actions/profile";
import type { ActionResult } from "@/lib/actions/result";
import { cn } from "@/lib/utils";

/**
 * Os aparelhos conectados (RF-H07, artboard `PerfilDesktop`).
 *
 * É componente de cliente porque as datas são formatadas no fuso de quem lê
 * (AGENTS.md, regra 7) — no servidor sairiam no fuso do servidor.
 *
 * A tradução do user-agent é cosmética e pode errar; ela existe para a pessoa
 * bater o olho e dizer "esse aí não sou eu". O IP e o horário continuam à vista
 * justamente porque o nome do aparelho não é prova de nada.
 */
export function DevicesCard({ sessions }: { readonly sessions: readonly ActiveSession[] }): ReactNode {
  const [resultado, sairDosOutros, saindo] = useActionState<ActionResult<{ revoked: number }> | null, FormData>(
    revokeOtherSessionsAction,
    null,
  );

  const outras = sessions.filter((sessao) => !sessao.current).length;

  return (
    <section className="flex flex-col rounded-2xl border bg-card p-4 md:p-5">
      <div className="flex flex-col gap-1 pb-2 md:flex-row md:items-baseline md:justify-between md:gap-4">
        <h2 className="font-heading text-[17px] font-bold md:text-lg">Aparelhos conectados</h2>
        <p className="text-[13px] text-muted-foreground">Não reconhece algum? Encerre e troque a senha.</p>
      </div>

      <ul className="flex flex-col">
        {sessions.map((sessao) => (
          <li key={sessao.id}>
            <DeviceRow session={sessao} />
          </li>
        ))}
      </ul>

      <div className="mt-2 border-t pt-3.5">
        <FormError result={resultado} />
        {outras === 0 ? (
          <p className="text-[13px] text-muted-foreground">Nenhum outro aparelho está conectado.</p>
        ) : (
          <form action={sairDosOutros}>
            <Button type="submit" variant="secondary" disabled={saindo} className="h-11 w-full md:h-10 md:w-auto">
              {saindo ? "Encerrando…" : outras === 1 ? "Sair do outro aparelho" : `Sair dos outros ${outras} aparelhos`}
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}

function DeviceRow({ session }: { readonly session: ActiveSession }): ReactNode {
  const [resultado, encerrar, encerrando] = useActionState<ActionResult<null> | null, FormData>(
    revokeSessionAction,
    null,
  );

  const aparelho = describeDevice(session.userAgent);
  const Icone = isHandheld(session.userAgent) ? Smartphone : Monitor;

  return (
    <div className="flex flex-col gap-2.5 border-t py-3 md:flex-row md:items-center md:gap-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-[10px]",
          session.current ? "bg-accent text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <Icone className="size-5" strokeWidth={2} aria-hidden />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold">{aparelho.label}</p>
          {session.current ? (
            <span className="flex h-5 items-center rounded-full bg-accent px-2 text-[11px] font-extrabold text-primary">
              ESTE APARELHO
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">
          {session.current ? "Agora mesmo" : <>Último uso <LocalDate iso={session.lastUsedAt} format="comHora" /></>}
          {session.ip === null ? null : <> · {session.ip}</>}
          {" · conectado desde "}
          <LocalDate iso={session.createdAt} format="curta" />
        </p>
        <FormError result={resultado} />
      </div>

      {/*
       * "Encerrar" só nos outros. A sessão atual não aparece aqui de propósito: a
       * rota da API também a recusa, e quem quer sair deste aparelho usa o "Sair",
       * que apaga o cookie junto.
       */}
      {session.current ? null : (
        <form action={encerrar}>
          <input type="hidden" name="sessionId" value={session.id} />
          <button
            type="submit"
            disabled={encerrando}
            className="flex h-11 w-full items-center justify-center rounded-[10px] border px-3.5 text-[13px] font-semibold hover:bg-muted disabled:opacity-60 md:h-9 md:w-auto"
          >
            {encerrando ? "Encerrando…" : "Encerrar"}
          </button>
        </form>
      )}
    </div>
  );
}
