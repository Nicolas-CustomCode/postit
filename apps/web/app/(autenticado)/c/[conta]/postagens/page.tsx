import { SquarePen } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ComingSoon } from "@/components/nav/coming-soon";

export const metadata: Metadata = { title: "Postagens" };

export default async function PostagensPage({
  params,
}: {
  readonly params: Promise<{ conta: string }>;
}): Promise<ReactNode> {
  const { conta } = await params;

  return (
    <ComingSoon
      icon={SquarePen}
      title="Postagens"
      phase="Fase 1"
      account={decodeURIComponent(conta)}
      description="A lista do que está em rascunho, em revisão, agendado e publicado — e a tela de compor uma postagem nova."
    />
  );
}
