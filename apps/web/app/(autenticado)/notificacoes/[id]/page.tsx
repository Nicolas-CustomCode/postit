import type { Metadata } from "next";
import type { ReactNode } from "react";
import { OpenNotification } from "@/components/notifications/open-notification";
import { requireSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Abrindo o aviso" };

/**
 * O destino do toque no push (RF-J02; ADR 0017): `/notificacoes/<id>`.
 *
 * O link não leva nome de conta nem de postagem (regra 22) — só o id do aviso. Esta
 * página descobre o destino **depois** de abrir, logado: marca como lido e leva à
 * postagem ou a Contas, pela mesma ação do sino.
 *
 * Marcar é escrita, então acontece numa Server Action chamada pelo componente de
 * cliente ao montar — nunca na renderização da página, que o prefetch do Next
 * faria sozinho (regra 13).
 */
export default async function AbrirNotificacaoPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}): Promise<ReactNode> {
  await requireSession();
  const { id } = await params;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 pb-8 md:px-10 md:py-7">
      <OpenNotification id={id} />
    </main>
  );
}
