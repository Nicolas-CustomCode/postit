"use client";

import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CalendarX,
  Check,
  CheckCircle2,
  MessageSquare,
  PencilLine,
  RefreshCw,
  RotateCcw,
  Send,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { COMMENT_MAX_LENGTH, PUBLISH_FAILURES, type PostTimelineEntry, type PostTrailAction } from "@repo/shared";
import { AccountDateTime } from "@/components/account-time";
import { LocalDate } from "@/components/local-date";
import { ComposeSection } from "@/components/posts/compose-section";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { addCommentAction } from "@/lib/actions/posts";
import { accountInitials, avatarColor } from "@/lib/nav/avatar-colors";
import { cn } from "@/lib/utils";

/**
 * Comentários internos com o histórico da postagem intercalado (RF-E04; ADR 0026,
 * decisão 5): "a foto 2 está escura" aparece logo antes de "Postagem reprovada",
 * e cada comentário ganha o seu contexto no tempo.
 *
 * **Qualquer logado comenta**, inclusive quem só vê. Comentar não mexe na
 * postagem — nem versão, nem status.
 *
 * ⚠️ **O texto do comentário é texto**, nunca HTML (AGENTS.md, regra 16): vai como
 * filho do React, com `whitespace-pre-wrap` para as quebras de linha que a pessoa
 * digitou.
 */
export function PostTimeline({
  username,
  postId,
  entries,
  timeZone,
}: {
  readonly username: string;
  readonly postId: string;
  readonly entries: readonly PostTimelineEntry[];
  /** O horário que a decisão marcou é da conta; o momento de cada evento, de quem lê. */
  readonly timeZone: string;
}): ReactNode {
  return (
    <ComposeSection
      title="Comentários internos"
      aside={<span className="text-[13px] text-muted-foreground">Só a equipe vê · com o histórico</span>}
    >
      <ol className="flex flex-col">
        {entries.map((entry, indice) => (
          <li
            key={entry.id}
            className={cn(
              "relative grid grid-cols-[30px_minmax(0,1fr)] gap-2.5 py-2",
              // A linha que costura o tempo, de um ícone ao próximo.
              "before:absolute before:top-0 before:bottom-0 before:left-[14.5px] before:w-px before:bg-border",
              indice === 0 && "before:top-5",
              indice === entries.length - 1 && "before:bottom-[calc(100%-20px)]",
            )}
          >
            {entry.kind === "COMMENT" ? <Comment entry={entry} /> : <Event entry={entry} timeZone={timeZone} />}
          </li>
        ))}
      </ol>

      <CommentForm username={username} postId={postId} />
    </ComposeSection>
  );
}

function Comment({ entry }: { readonly entry: Extract<PostTimelineEntry, { kind: "COMMENT" }> }): ReactNode {
  // As cores fechadas dos avatares (docs/13), escolhidas pelo nome: a mesma pessoa, a mesma cor.
  const cor = avatarColor(entry.byName);

  return (
    <>
      <span
        aria-hidden
        className="relative z-10 flex size-7.5 items-center justify-center rounded-full text-[10.5px] font-extrabold"
        style={{ background: cor.background, color: cor.foreground }}
      >
        {accountInitials({ name: entry.byName, username: entry.byName })}
      </span>
      <div className="rounded-[4px_12px_12px_12px] bg-muted px-3 py-2">
        <div className="mb-0.5 flex flex-wrap items-baseline justify-between gap-x-2">
          <span className="text-[13px] font-semibold">{entry.byName}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            <LocalDate iso={entry.at} format="comHora" />
          </span>
        </div>
        <p className="text-sm break-words whitespace-pre-wrap">{entry.text}</p>
      </div>
    </>
  );
}

type Tone = "neutral" | "ok" | "danger" | "working";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  ok: "bg-[var(--status-publicado-bg)] text-[var(--status-publicado)]",
  danger: "bg-[var(--status-falhou-bg)] text-[var(--status-falhou)]",
  working: "bg-[var(--status-processando-bg)] text-[var(--status-processando)]",
};

function Event({
  entry,
  timeZone,
}: {
  readonly entry: Exclude<PostTimelineEntry, { kind: "COMMENT" }>;
  readonly timeZone: string;
}): ReactNode {
  const { icon: Icon, tone, text, quote } = describe(entry, timeZone);

  return (
    <>
      <span
        aria-hidden
        className={cn("relative z-10 flex size-7.5 items-center justify-center rounded-full", TONE_CLASS[tone])}
      >
        <Icon className="size-3.5" strokeWidth={2.25} />
      </span>
      <div className="pt-1.5 text-[13px] text-muted-foreground">
        {text} ·{" "}
        <span className="whitespace-nowrap tabular-nums">
          <LocalDate iso={entry.at} format="comHora" />
        </span>
        {quote !== null && (
          <p className="mt-1.5 border-l-2 border-[var(--status-falhou)] py-0.5 pl-2.5 text-sm break-words whitespace-pre-wrap text-foreground">
            “{quote}”
          </p>
        )}
      </div>
    </>
  );
}

const DECISIONS: Record<PostTrailAction, { icon: LucideIcon; tone: Tone; verb: string }> = {
  SUBMITTED_FOR_REVIEW: { icon: Send, tone: "neutral", verb: "Enviada para revisão" },
  APPROVED: { icon: Check, tone: "ok", verb: "Postagem aprovada" },
  REJECTED: { icon: X, tone: "danger", verb: "Postagem reprovada" },
  INVALIDATED_BY_EDIT: { icon: PencilLine, tone: "neutral", verb: "Editada e devolvida para rascunho" },
  RETURNED_TO_DRAFT: { icon: RotateCcw, tone: "neutral", verb: "Voltou para a composição" },
  SCHEDULED: { icon: CalendarClock, tone: "ok", verb: "Agendada" },
  UNSCHEDULED: { icon: CalendarX, tone: "neutral", verb: "Agendamento cancelado" },
  CANCELED: { icon: Ban, tone: "neutral", verb: "Descartada" },
};

function describe(
  entry: Exclude<PostTimelineEntry, { kind: "COMMENT" }>,
  timeZone: string,
): { icon: LucideIcon; tone: Tone; text: ReactNode; quote: string | null } {
  if (entry.kind === "CREATED") {
    return {
      icon: PencilLine,
      tone: "neutral",
      text: (
        <>
          <strong className="font-semibold text-foreground">Rascunho criado</strong> por {entry.byName}
        </>
      ),
      quote: null,
    };
  }

  if (entry.kind === "PUBLISHING") {
    if (entry.outcome === "PUBLISHED") {
      return {
        icon: CheckCircle2,
        tone: "ok",
        text: <strong className="font-semibold text-foreground">Publicada no Instagram</strong>,
        quote: null,
      };
    }
    if (entry.outcome === "RETRYING") {
      return {
        icon: RefreshCw,
        tone: "working",
        text: (
          <>
            <strong className="font-semibold text-foreground">Tentando de novo</strong> — o sistema tenta sozinho
          </>
        ),
        quote: null,
      };
    }
    return {
      icon: AlertTriangle,
      tone: "danger",
      text: (
        <>
          <strong className="font-semibold text-foreground">A publicação não saiu</strong>
          {entry.cause !== null && <> — {PUBLISH_FAILURES[entry.cause].message}</>}
        </>
      ),
      quote: null,
    };
  }

  const decisao = DECISIONS[entry.action];
  // Aprovar e agendar é uma decisão só, e a linha diz as duas coisas.
  const verbo = entry.action === "APPROVED" && entry.scheduledFor !== null ? "Aprovada e agendada" : decisao.verb;

  return {
    icon: entry.scheduledFor !== null ? CalendarClock : decisao.icon,
    tone: decisao.tone,
    text: (
      <>
        <strong className="font-semibold text-foreground">{verbo}</strong> por {entry.byName}
        {entry.scheduledFor !== null && (
          <>
            {" "}
            para <AccountDateTime iso={entry.scheduledFor} timeZone={timeZone} />
          </>
        )}
      </>
    ),
    quote: entry.action === "REJECTED" ? entry.reason : null,
  };
}

function CommentForm({ username, postId }: { readonly username: string; readonly postId: string }): ReactNode {
  const router = useRouter();
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const vazio = texto.trim().length === 0;

  async function comentar(): Promise<void> {
    setEnviando(true);
    setErro(null);
    try {
      const resultado = await addCommentAction(username, postId, { text: texto });
      if (resultado.ok) {
        setTexto("");
        router.refresh();
      } else {
        setErro(resultado.message);
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-2 border-t pt-3"
      onSubmit={(evento) => {
        evento.preventDefault();
        if (!vazio) void comentar();
      }}
    >
      <textarea
        aria-label="Comentário"
        value={texto}
        maxLength={COMMENT_MAX_LENGTH}
        rows={2}
        disabled={enviando}
        placeholder="Escreva um comentário para a equipe"
        onChange={(evento) => setTexto(evento.target.value)}
        className="w-full resize-y rounded-[10px] border bg-card px-3 py-2.5 text-sm leading-relaxed focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50"
      />
      {erro !== null && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end">
        <Button type="submit" variant="outline" className="h-11 md:h-10" disabled={enviando || vazio}>
          <MessageSquare className="size-4" aria-hidden />
          Comentar
        </Button>
      </div>
    </form>
  );
}
