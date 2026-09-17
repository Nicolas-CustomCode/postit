import { BarChart3 } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ComingSoon } from "@/components/nav/coming-soon";

export const metadata: Metadata = { title: "Métricas" };

export default async function MetricasPage({
  params,
}: {
  readonly params: Promise<{ conta: string }>;
}): Promise<ReactNode> {
  const { conta } = await params;

  return (
    <ComingSoon
      icon={BarChart3}
      title="Métricas"
      phase="Fase 5"
      account={decodeURIComponent(conta)}
      description="Alcance, interações e seguidores da conta, dia a dia. A coleta diária começa agora, mesmo sem tela: a Meta só guarda 90 dias."
    />
  );
}
