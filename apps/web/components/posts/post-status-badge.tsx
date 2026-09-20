import type { ReactNode } from "react";
import { POST_STATUS_LABELS, type PostStatus } from "@repo/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * O estado da postagem, com cor (docs/13, "cor por status").
 *
 * **Cor nunca é o único sinal**: o rótulo em português vem junto, sempre. Quem
 * não distingue as cores precisa da mesma informação, e é a razão de o
 * calendário da Fase 3 herdar esta peça em vez de pintar quadradinhos.
 */
const TONE: Record<PostStatus, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  IN_REVIEW: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  APPROVED: "bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200",
  SCHEDULED: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200",
  PROCESSING: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200",
  PUBLISHED: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  FAILED: "bg-destructive/15 text-destructive",
  CANCELED: "bg-muted text-muted-foreground line-through",
};

export function PostStatusBadge({ status }: { readonly status: PostStatus }): ReactNode {
  return (
    <Badge variant="secondary" className={cn("font-semibold", TONE[status])}>
      {POST_STATUS_LABELS[status]}
    </Badge>
  );
}
