"use client";

import { CalendarClock, Check, ExternalLink, PencilLine, RotateCcw, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  POST_FORMAT_LABELS,
  PUBLISH_FAILURES,
  PUBLISH_MAX_ATTEMPTS,
  REJECTION_REASON_MAX_LENGTH,
  type AccountSummary,
  type PostDetail,
} from "@repo/shared";
import { AccountDateTime, accountZoneName, civilFieldsFor } from "@/components/account-time";
import { LocalDate } from "@/components/local-date";
import { PostStatusBadge } from "@/components/posts/post-status-badge";
import { ScheduleFields } from "@/components/posts/schedule-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  approvePostAction,
  cancelPostAction,
  rejectPostAction,
  reopenPostAction,
  revertPostToDraftAction,
  schedulePostAction,
  unschedulePostAction,
} from "@/lib/actions/posts";
import type { ActionResult } from "@/lib/actions/result";

/** O que a pessoa pode fazer — para esconder botão. **Quem decide é a API** (regra 17). */
export interface ReviewAbilities {
  /** `POSTAGEM_APROVAR`, e a autoaprovação resolvida (`canApprovePost`). */
  readonly approve: boolean;
  /** Tem `POSTAGEM_APROVAR`, mas a postagem é dela e falta `POSTAGEM_APROVAR_PROPRIA`. */
  readonly ownPostBlocked: boolean;
  readonly schedule: boolean;
  readonly edit: boolean;
  readonly reconnect: boolean;
}

type Opened = null | "reject" | "reopen" | "reschedule" | "unschedule" | "cancel";

/**
 * O cartão de estado e de decisão da Revisão (ADR 0026; protótipo aprovado em
 * 23/09/2026).
 *
 * Um cartão só, que muda com o estado: em revisão, **aprovar e agendar** ou
 * reprovar; aprovada, agendar; agendada, reagendar ou cancelar o agendamento;
 * falhou, a causa e as três saídas (ADR 0007). Publicando, publicada e descartada
 * só contam o que aconteceu.
 *
 * ⚠️ **Toda decisão que desfaz algo pede confirmação na própria tela** — o
 * navegador do artefato não mostra `confirm()`, e aqui ele não seria menos
 * esquecível. Voltar para a composição avisa que a aprovação morre (I-2).
 *
 * ⚠️ **No celular, as ações principais ficam fixas no rodapé**, como num checkout:
 * a barra de navegação some nesta página (ADR 0026, decisão 6), e o botão de
 * decidir não pode ficar escondido lá embaixo, depois dos comentários.
 */
export function ReviewStateCard({
  username,
  post,
  account,
  can,
  suggestion,
}: {
  readonly username: string;
  readonly post: PostDetail;
  readonly account: Pick<AccountSummary, "username" | "timezone">;
  readonly can: ReviewAbilities;
  /** A próxima hora cheia no fuso da conta: o reagendamento de uma que falhou já vem sugerido. */
  readonly suggestion: { readonly day: string; readonly time: string };
}): ReactNode {
  const router = useRouter();
  const timeZone = account.timezone;
  const inicial = post.status === "FAILED" ? suggestion : civilFieldsFor(post.scheduledAt, timeZone);

  const [aberto, setAberto] = useState<Opened>(null);
  const [day, setDay] = useState(inicial.day);
  const [time, setTime] = useState(inicial.time);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<{ message: string; stale: boolean } | null>(null);

  const horarioOk = day !== "" && time !== "";
  const versao = { version: post.version };

  /** Uma decisão por vez; depois dela a página recarrega no estado novo. */
  async function decidir(acao: () => Promise<ActionResult<unknown>>, depois?: () => void): Promise<void> {
    setOcupado(true);
    setErro(null);
    try {
      const resultado = await acao();
      if (resultado.ok) {
        setAberto(null);
        if (depois) depois();
        else router.refresh();
        return;
      }
      // Mudou por baixo — outra pessoa decidiu, ou o worker já pegou para publicar.
      // O que foi digitado continua nos campos; recarregar mostra o estado novo.
      const stale = ["POST_VERSION_CONFLICT", "POST_NOT_EDITABLE", "POST_TRANSITION_INVALID"].includes(
        resultado.code,
      );
      setErro({ message: stale ? "Esta postagem mudou enquanto você olhava." : resultado.message, stale });
    } finally {
      setOcupado(false);
    }
  }

  const campos = (prefixo: string) => (
    <ScheduleFields
      idPrefix={prefixo}
      day={day}
      time={time}
      timeZone={timeZone}
      disabled={ocupado}
      onDayChange={setDay}
      onTimeChange={setTime}
    />
  );

  /** A confirmação na própria tela: o aviso, o botão que faz e o que desiste. */
  const confirmar = (texto: string, botao: ReactNode) => (
    <div className="flex flex-col gap-2.5 rounded-xl border bg-muted p-3">
      <p className="text-[13px]">{texto}</p>
      <div className="flex flex-wrap gap-2">
        {botao}
        <Button type="button" variant="ghost" className="h-11 md:h-10" disabled={ocupado} onClick={() => setAberto(null)}>
          Manter como está
        </Button>
      </div>
    </div>
  );

  const reabrir = (texto: string) =>
    confirmar(
      texto,
      <Button
        type="button"
        className="h-11 md:h-10"
        disabled={ocupado}
        onClick={() => void decidir(() => reopenPostAction(username, post.id, versao))}
      >
        <RotateCcw className="size-4" aria-hidden />
        Voltar para a composição
      </Button>,
    );

  let topo: ReactNode = null;
  let corpo: ReactNode = null;
  /** As ações principais: no celular, fixas no rodapé. */
  let barra: ReactNode[] = [];
  /** As de menor peso — voltar, cancelar —, dentro do cartão. */
  let rodape: ReactNode[] = [];

  const decisao = post.lastDecision;
  const quem = (verbo: string) =>
    decisao === null ? null : (
      <p className="text-[13px] text-muted-foreground">
        {verbo} por {decisao.byName} em <LocalDate iso={decisao.at} format="comHora" />
      </p>
    );

  switch (post.status) {
    case "DRAFT": {
      topo = (
        <>
          <Titulo>Em composição</Titulo>
          <p className="text-[13px] text-muted-foreground">
            {post.createdByName} está montando esta postagem. Quando ela for enviada para revisão, a decisão aparece
            aqui.
          </p>
        </>
      );
      break;
    }

    case "IN_REVIEW": {
      topo = (
        <>
          <Titulo>Aguardando aprovação</Titulo>
          {decisao?.action === "SUBMITTED_FOR_REVIEW" && quem("Enviada para revisão")}
        </>
      );

      if (aberto === "reopen") {
        corpo = reabrir("Editar tira a postagem da revisão: ela volta para rascunho e precisa ser enviada de novo.");
      } else if (can.approve && aberto === "reject") {
        corpo = (
          <div className="flex flex-col gap-1.5 border-t pt-3.5">
            <label htmlFor="motivo-reprovacao" className="text-[13px] font-semibold">
              Motivo da reprovação
            </label>
            <textarea
              id="motivo-reprovacao"
              value={motivo}
              rows={3}
              maxLength={REJECTION_REASON_MAX_LENGTH}
              disabled={ocupado}
              placeholder="O que precisa mudar antes de aprovar"
              onChange={(evento) => setMotivo(evento.target.value)}
              className="w-full resize-y rounded-[10px] border bg-card px-3 py-2.5 text-sm leading-relaxed focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50"
            />
            <p className="text-xs text-muted-foreground">Quem enviou vê o motivo na composição e no histórico.</p>
          </div>
        );
        barra = [
          <Button
            key="reprovar"
            type="button"
            variant="destructive"
            className="h-11 flex-1 md:h-10 md:flex-none"
            disabled={ocupado || motivo.trim() === ""}
            onClick={() => void decidir(() => rejectPostAction(username, post.id, { ...versao, reason: motivo }))}
          >
            <X className="size-4" aria-hidden />
            Reprovar
          </Button>,
          <Button
            key="desistir"
            type="button"
            variant="ghost"
            className="h-11 md:h-10"
            disabled={ocupado}
            onClick={() => setAberto(null)}
          >
            Cancelar
          </Button>,
        ];
      } else if (can.approve) {
        corpo = can.schedule ? (
          <div className="flex flex-col gap-2.5 border-t pt-3.5">
            <p className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">Aprovar e agendar</p>
            {campos("aprovar")}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Aprovada, ela espera alguém com permissão de agendar escolher o horário.
          </p>
        );
        barra = [
          <Button
            key="aprovar"
            type="button"
            className="h-11 flex-1 md:h-10 md:flex-none"
            disabled={ocupado || (can.schedule && !horarioOk)}
            onClick={() =>
              void decidir(() =>
                approvePostAction(username, post.id, can.schedule ? { ...versao, schedule: { day, time } } : versao),
              )
            }
          >
            <Check className="size-4" aria-hidden />
            {can.schedule ? "Aprovar e agendar" : "Aprovar"}
          </Button>,
          <Button
            key="reprovar"
            type="button"
            variant="outline"
            className="h-11 flex-1 border-destructive text-destructive md:h-10 md:flex-none"
            disabled={ocupado}
            onClick={() => setAberto("reject")}
          >
            Reprovar com motivo
          </Button>,
        ];
      } else {
        corpo = (
          <p className="text-[13px] text-muted-foreground">
            {can.ownPostBlocked
              ? "Esta postagem é sua: outra pessoa precisa aprová-la."
              : "Quem aprova escolhe o dia e a hora. Enquanto isso, dá para conversar nos comentários."}
          </p>
        );
      }

      if (can.edit && aberto === null) {
        rodape = [
          <Button
            key="reabrir"
            type="button"
            variant="ghost"
            className="h-11 md:h-10"
            disabled={ocupado}
            onClick={() => setAberto("reopen")}
          >
            <RotateCcw className="size-4" aria-hidden />
            Voltar para a composição
          </Button>,
        ];
      }
      break;
    }

    case "APPROVED": {
      topo = (
        <>
          <Titulo>Aprovada — falta agendar</Titulo>
          {decisao?.action === "APPROVED" && quem("Aprovada")}
          {decisao?.action === "UNSCHEDULED" && quem("Agendamento cancelado")}
        </>
      );

      if (aberto === "reopen") {
        corpo = reabrir("Editar uma postagem aprovada tira a aprovação: ela volta para rascunho.");
      } else if (can.schedule) {
        corpo = (
          <div className="flex flex-col gap-2.5 border-t pt-3.5">
            <p className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">Quando publicar</p>
            {campos("agendar")}
          </div>
        );
        barra = [
          <Button
            key="agendar"
            type="button"
            className="h-11 flex-1 md:h-10 md:flex-none"
            disabled={ocupado || !horarioOk}
            onClick={() => void decidir(() => schedulePostAction(username, post.id, { ...versao, day, time }))}
          >
            <CalendarClock className="size-4" aria-hidden />
            Agendar
          </Button>,
        ];
      } else {
        corpo = <p className="text-[13px] text-muted-foreground">Quem agenda escolhe o horário.</p>;
      }

      if (can.edit && aberto === null) rodape = [editar(() => setAberto("reopen"), ocupado)];
      break;
    }

    case "SCHEDULED": {
      topo = (
        <>
          <p className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">Sai em</p>
          <p className="font-heading text-2xl leading-tight font-bold">
            <AccountDateTime iso={post.scheduledAt} timeZone={timeZone} />
          </p>
          <p className="text-[13px] text-muted-foreground">{accountZoneName(timeZone)}</p>
        </>
      );

      if (aberto === "reschedule") {
        corpo = (
          <div className="flex flex-col gap-2.5 border-t pt-3.5">
            <p className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">Novo horário</p>
            {campos("reagendar")}
          </div>
        );
        barra = [
          <Button
            key="salvar"
            type="button"
            className="h-11 flex-1 md:h-10 md:flex-none"
            disabled={ocupado || !horarioOk}
            onClick={() => void decidir(() => schedulePostAction(username, post.id, { ...versao, day, time }))}
          >
            Salvar novo horário
          </Button>,
          <Button key="desistir" type="button" variant="ghost" className="h-11 md:h-10" onClick={() => setAberto(null)}>
            Cancelar
          </Button>,
        ];
      } else if (aberto === "unschedule") {
        corpo = confirmar(
          "Cancelar o agendamento tira o horário. A postagem continua aprovada, esperando um novo.",
          <Button
            type="button"
            variant="destructive"
            className="h-11 md:h-10"
            disabled={ocupado}
            onClick={() => void decidir(() => unschedulePostAction(username, post.id, versao))}
          >
            Cancelar agendamento
          </Button>,
        );
      } else if (aberto === "reopen") {
        corpo = reabrir(
          "Editar tira do agendamento e da aprovação: a postagem volta para rascunho e passa pela revisão de novo.",
        );
      } else {
        if (can.schedule) {
          barra = [
            <Button
              key="reagendar"
              type="button"
              variant="outline"
              className="h-11 flex-1 md:h-10 md:flex-none"
              disabled={ocupado}
              onClick={() => setAberto("reschedule")}
            >
              <CalendarClock className="size-4" aria-hidden />
              Reagendar
            </Button>,
          ];
        }
        if (can.edit) {
          corpo = <p className="text-[13px] text-warning">Editar faz a postagem voltar para rascunho.</p>;
          rodape.push(editar(() => setAberto("reopen"), ocupado));
        }
        if (can.schedule) {
          rodape.push(
            <Button
              key="desagendar"
              type="button"
              variant="ghost"
              className="h-11 md:h-10"
              disabled={ocupado}
              onClick={() => setAberto("unschedule")}
            >
              Cancelar agendamento
            </Button>,
          );
        }
      }
      break;
    }

    case "PROCESSING": {
      const tentando = post.attempts >= 1 && post.failureCause !== null;
      topo = (
        <>
          <Titulo>Publicando</Titulo>
          <p className="text-[13px] text-muted-foreground">Saindo em instantes. Não dá para editar enquanto isso.</p>
        </>
      );
      // docs/04, jornada 7: em retentativa, a pessoa vê em que ponto está e por quê.
      if (tentando && post.failureCause !== null) {
        corpo = (
          <p className="rounded-[10px] bg-[var(--status-processando-bg)] p-3 text-[13px]">
            <strong className="text-[var(--status-processando)]">
              Tentativa {post.attempts} de {PUBLISH_MAX_ATTEMPTS}
            </strong>{" "}
            — {PUBLISH_FAILURES[post.failureCause].message} O sistema tenta de novo sozinho.
          </p>
        );
      }
      break;
    }

    case "PUBLISHED": {
      topo = (
        <>
          <p className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">Publicada em</p>
          <p className="font-heading text-2xl leading-tight font-bold">
            {post.publication === null ? "—" : <AccountDateTime iso={post.publication.publishedAt} timeZone={timeZone} />}
          </p>
        </>
      );
      corpo = post.publication?.permalink ? (
        <a
          href={post.publication.permalink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 items-center gap-2 self-start rounded-[10px] border px-4 text-sm font-semibold transition-colors hover:bg-muted md:h-10"
        >
          <ExternalLink className="size-4" aria-hidden />
          Ver no Instagram
        </a>
      ) : (
        // V-28: confirmada pelo estado do container, sem o id da mídia.
        <p className="text-[13px] text-muted-foreground">
          Link indisponível: o Instagram confirmou a publicação, mas não devolveu o endereço do post.
        </p>
      );
      break;
    }

    case "FAILED": {
      const causa = post.failureCause === null ? null : PUBLISH_FAILURES[post.failureCause];
      topo = (
        <>
          <Titulo>A publicação não saiu</Titulo>
          <p className="text-[13px] text-muted-foreground">
            {POST_FORMAT_LABELS[post.format]}
            {post.scheduledAt !== null && (
              <>
                {" "}
                · prevista para <AccountDateTime iso={post.scheduledAt} timeZone={timeZone} />
              </>
            )}
          </p>
        </>
      );

      corpo = (
        <>
          <p className="rounded-[10px] bg-[var(--status-falhou-bg)] p-3 text-sm">
            {causa?.message ?? "O Instagram recusou a publicação. Veja o histórico e decida o que fazer."}
          </p>
          {/* A ação da causa vem antes das saídas: sem reconectar, reagendar falharia de novo. */}
          {(causa?.action === "RECONNECT" || post.accountAccessLost) && can.reconnect && (
            <Link
              href="/contas/conectar"
              className="inline-flex h-11 items-center justify-center self-start rounded-[10px] bg-primary px-4 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 md:h-10"
            >
              Reconectar @{account.username}
            </Link>
          )}
          {can.schedule && aberto === "cancel"
            ? confirmar(
                "Cancelar descarta a postagem: ela sai do calendário e não pode ser publicada. Não tem volta.",
                <Button
                  type="button"
                  variant="destructive"
                  className="h-11 md:h-10"
                  disabled={ocupado}
                  onClick={() =>
                    void decidir(
                      () => cancelPostAction(username, post.id, versao),
                      () => router.push(`/c/${username}/postagens`),
                    )
                  }
                >
                  <Trash2 className="size-4" aria-hidden />
                  Confirmar cancelamento
                </Button>,
              )
            : can.schedule && (
                <div className="flex flex-col gap-2.5 border-t pt-3.5">
                  <p className="text-xs font-bold tracking-[0.08em] text-muted-foreground uppercase">Reagendar</p>
                  {campos("falha")}
                </div>
              )}
          {!can.schedule && (
            <p className="text-[13px] text-muted-foreground">
              Quem agenda decide: reconectar e reagendar, voltar para rascunho ou cancelar.
            </p>
          )}
        </>
      );

      if (can.schedule && aberto === null) {
        barra = [
          <Button
            key="reagendar"
            type="button"
            className="h-11 flex-1 md:h-10 md:flex-none"
            disabled={ocupado || !horarioOk}
            onClick={() => void decidir(() => schedulePostAction(username, post.id, { ...versao, day, time }))}
          >
            <CalendarClock className="size-4" aria-hidden />
            Reagendar
          </Button>,
        ];
        rodape = [
          <Button
            key="rascunho"
            type="button"
            variant="ghost"
            className="h-11 md:h-10"
            disabled={ocupado}
            onClick={() => void decidir(() => revertPostToDraftAction(username, post.id, versao))}
          >
            <RotateCcw className="size-4" aria-hidden />
            Voltar para rascunho
          </Button>,
          <Button
            key="cancelar"
            type="button"
            variant="ghost"
            className="h-11 md:h-10"
            disabled={ocupado}
            onClick={() => setAberto("cancel")}
          >
            <Trash2 className="size-4" aria-hidden />
            Cancelar postagem
          </Button>,
        ];
      }
      break;
    }

    case "CANCELED": {
      topo = (
        <>
          <Titulo>Descartada</Titulo>
          {decisao?.action === "CANCELED" ? quem("Descartada") : null}
          <p className="text-[13px] text-muted-foreground">Esta postagem não vai ao ar.</p>
        </>
      );
      break;
    }
  }

  const soVe = !can.edit && !can.approve && !can.schedule && post.status !== "PUBLISHED";

  return (
    <section
      aria-label="Situação da postagem"
      className={
        post.status === "FAILED"
          ? "flex flex-col gap-3.5 rounded-2xl border border-destructive/40 bg-card p-5"
          : "flex flex-col gap-3.5 rounded-2xl border bg-card p-5"
      }
    >
      <div className="flex flex-col items-start gap-1">
        <PostStatusBadge status={post.status} />
        {topo}
      </div>

      {corpo}

      {erro !== null && (
        <Alert variant="destructive" role="alert">
          <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {erro.message}
            {erro.stale && (
              <button type="button" className="font-semibold underline" onClick={() => router.refresh()}>
                Recarregar
              </button>
            )}
          </AlertDescription>
        </Alert>
      )}

      {rodape.length > 0 && <div className="flex flex-wrap gap-1">{rodape}</div>}

      {soVe && <p className="text-[13px] text-muted-foreground">Você pode ver e comentar, mas não editar nem decidir.</p>}

      {barra.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t bg-card px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:static md:z-auto md:flex-wrap md:border-0 md:bg-transparent md:p-0">
          {barra}
        </div>
      )}
    </section>
  );
}

function Titulo({ children }: { readonly children: ReactNode }): ReactNode {
  return <h2 className="font-heading text-[22px] leading-tight font-bold">{children}</h2>;
}

function editar(abrir: () => void, ocupado: boolean): ReactNode {
  return (
    <Button key="editar" type="button" variant="ghost" className="h-11 md:h-10" disabled={ocupado} onClick={abrir}>
      <PencilLine className="size-4" aria-hidden />
      Editar
    </Button>
  );
}
