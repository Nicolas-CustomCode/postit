"use client";

import { CalendarClock, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  POST_FORMAT_LABELS,
  PUBLISH_FAILURES,
  type AccountSummary,
  type PostDetail,
  type PostHistoryEntry,
} from "@repo/shared";
import { AccountDateTime, accountZoneName, todayIn } from "@/components/account-time";
import { ComposeSection } from "@/components/posts/compose-section";
import { FeedPreview } from "@/components/posts/feed-preview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cancelPostAction, revertPostToDraftAction, schedulePostAction } from "@/lib/actions/posts";
import { previewFormat, previewMedia } from "@/lib/posts/preview";

/**
 * A postagem que falhou (RF-F07; ADR 0007; artboard `FalhaCelular`).
 *
 * O sistema não publica atrasado sozinho, e em troca é obrigado a ser excelente
 * em avisar: a causa em português, o que fazer, e as três saídas a um clique —
 * reagendar, voltar para rascunho, cancelar.
 *
 * ⚠️ **Decidir é de quem agenda** (ADR 0015). Sem `POSTAGEM_AGENDAR`, a tela
 * mostra a causa e o histórico e não oferece as ações — a API recusaria de
 * qualquer jeito (regra 17).
 */
export function PostFailure({
  username,
  post,
  account,
  history,
  suggestion,
  canDecide,
  canReconnect,
}: {
  readonly username: string;
  readonly post: PostDetail;
  readonly account: Pick<AccountSummary, "name" | "username" | "photoUrl" | "timezone">;
  readonly history: readonly PostHistoryEntry[];
  /** A próxima hora cheia no fuso da conta, calculada no servidor. */
  readonly suggestion: { readonly day: string; readonly time: string };
  /** `POSTAGEM_AGENDAR`: reagendar, voltar para rascunho, cancelar. */
  readonly canDecide: boolean;
  /** `CONTA_GERENCIAR`: o botão de reconectar leva a um lugar que ela pode usar. */
  readonly canReconnect: boolean;
}): ReactNode {
  const router = useRouter();
  const [day, setDay] = useState(suggestion.day);
  const [time, setTime] = useState(suggestion.time);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmandoCancelamento, setConfirmandoCancelamento] = useState(false);

  const timeZone = account.timezone;
  const causa = post.failureCause === null ? null : PUBLISH_FAILURES[post.failureCause];
  const formato = POST_FORMAT_LABELS[post.format];

  /** Uma decisão por vez; depois dela a página recarrega no estado novo. */
  async function decidir(
    acao: () => Promise<{ ok: true } | { ok: false; message: string }>,
    depois: () => void,
  ): Promise<void> {
    setOcupado(true);
    setErro(null);
    try {
      const resultado = await acao();
      if (resultado.ok) depois();
      else setErro(resultado.message);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-7">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <section className="flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-card p-5">
          <div>
            <h2 className="font-heading text-lg font-bold">A publicação não saiu</h2>
            <p className="text-[13px] text-muted-foreground">
              {formato}
              {post.scheduledAt !== null && (
                <>
                  {" "}
                  · prevista para <AccountDateTime iso={post.scheduledAt} timeZone={timeZone} />
                </>
              )}
            </p>
          </div>

          <p className="text-sm">
            {causa?.message ?? "O Instagram recusou a publicação. Veja o histórico abaixo e decida o que fazer."}
          </p>

          {/* A ação da causa vem antes das três saídas: sem reconectar, reagendar falharia de novo. */}
          {(causa?.action === "RECONNECT" || post.accountAccessLost) && canReconnect && (
            <Link
              href="/contas/conectar"
              className="inline-flex h-11 items-center justify-center self-start rounded-[10px] bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 md:h-10"
            >
              Reconectar @{account.username}
            </Link>
          )}
        </section>

        {canDecide && (
          <ComposeSection title="O que fazer agora">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold">Reagendar</p>
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="dia-falha" className="text-[13px] text-muted-foreground">
                    Data
                  </label>
                  <input
                    id="dia-falha"
                    type="date"
                    value={day}
                    min={todayIn(timeZone)}
                    disabled={ocupado}
                    onChange={(evento) => setDay(evento.target.value)}
                    className="h-11 w-45 rounded-[10px] border bg-transparent px-3 text-sm tabular-nums focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="hora-falha" className="text-[13px] text-muted-foreground">
                    Hora
                  </label>
                  <input
                    id="hora-falha"
                    type="time"
                    value={time}
                    disabled={ocupado}
                    onChange={(evento) => setTime(evento.target.value)}
                    className="h-11 w-28 rounded-[10px] border bg-transparent px-3 text-sm tabular-nums focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50"
                  />
                </div>
                <Button
                  type="button"
                  className="h-11 md:h-10"
                  disabled={ocupado || day === "" || time === ""}
                  onClick={() =>
                    void decidir(
                      () => schedulePostAction(username, post.id, { version: post.version, day, time }),
                      () => router.refresh(),
                    )
                  }
                >
                  <CalendarClock className="size-4" aria-hidden />
                  Reagendar
                </Button>
              </div>
              <p className="text-[13px] text-muted-foreground">{accountZoneName(timeZone)}, o fuso da conta.</p>
            </div>

            <div className="flex flex-col gap-2 border-t pt-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold">Voltar para rascunho</p>
                <p className="text-[13px] text-muted-foreground">
                  Para corrigir antes de agendar de novo. Ela precisa ser marcada como pronta outra vez.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-10"
                disabled={ocupado}
                onClick={() =>
                  void decidir(
                    () => revertPostToDraftAction(username, post.id, { version: post.version }),
                    () => router.refresh(),
                  )
                }
              >
                <RotateCcw className="size-4" aria-hidden />
                Voltar para rascunho
              </Button>
            </div>

            <div className="flex flex-col gap-2 border-t pt-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold">Cancelar postagem</p>
                <p className="text-[13px] text-muted-foreground">Não pode ser desfeito.</p>
              </div>
              {/* Duas etapas: é a única das três que não tem volta. */}
              <Button
                type="button"
                variant={confirmandoCancelamento ? "destructive" : "ghost"}
                className="h-11 md:h-10"
                disabled={ocupado}
                onClick={() => {
                  if (!confirmandoCancelamento) {
                    setConfirmandoCancelamento(true);
                    return;
                  }
                  void decidir(
                    () => cancelPostAction(username, post.id, { version: post.version }),
                    () => router.push(`/c/${username}/postagens`),
                  );
                }}
              >
                <Trash2 className="size-4" aria-hidden />
                {confirmandoCancelamento ? "Confirmar cancelamento" : "Cancelar postagem"}
              </Button>
            </div>
          </ComposeSection>
        )}

        {erro !== null && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        )}

        <Historico history={history} timeZone={timeZone} />
      </div>

      <div className="w-full shrink-0 lg:sticky lg:top-7 lg:w-90">
        <FeedPreview
          account={account}
          format={previewFormat(post)}
          media={previewMedia(post)}
          caption={post.caption ?? ""}
          scheduledAt={post.scheduledAt}
          timeZone={timeZone}
        />
      </div>
    </div>
  );
}

const ETAPAS: Record<PostHistoryEntry["step"], string> = {
  DISPATCH: "Entregue para publicar",
  CREATE_CONTAINER: "Enviada ao Instagram",
  CHECK_STATUS: "Preparo conferido",
  PUBLISH: "Publicação pedida",
  RECONCILE: "Conferido se saiu",
  GIVE_UP: "Tentativas encerradas",
  COLLECT_METRICS: "Métricas coletadas",
};

const RESULTADOS: Record<PostHistoryEntry["result"], string> = {
  SUCCESS: "deu certo",
  RECOVERABLE_ERROR: "falhou — nova tentativa",
  FATAL_ERROR: "falhou",
};

/**
 * O que o motor fez, tentativa a tentativa (RF-F09). O detalhe técnico — a
 * resposta da Meta, já sem token — fica recolhido: é para quem investiga, e aberto
 * no meio da tela seria ruído para quem só precisa decidir.
 */
function Historico({
  history,
  timeZone,
}: {
  readonly history: readonly PostHistoryEntry[];
  readonly timeZone: string;
}): ReactNode {
  if (history.length === 0) return null;

  return (
    <ComposeSection title="Histórico">
      <ol className="flex flex-col gap-3">
        {history.map((entrada, indice) => (
          <li key={indice} className="flex flex-col gap-1">
            <p className="text-sm">
              <span className="text-muted-foreground">
                <AccountDateTime iso={entrada.at} timeZone={timeZone} />
              </span>{" "}
              {ETAPAS[entrada.step]}:{" "}
              <span className={entrada.result === "SUCCESS" ? "" : "text-destructive"}>
                {RESULTADOS[entrada.result]}
              </span>
            </p>
            {entrada.detail !== null && entrada.detail !== undefined && (
              <details className="text-[13px] text-muted-foreground">
                <summary className="cursor-pointer">detalhe técnico</summary>
                <pre className="mt-1 overflow-x-auto rounded-lg bg-muted p-2 text-xs">
                  {JSON.stringify(entrada.detail, null, 2)}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ol>
    </ComposeSection>
  );
}
