import { CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ComingSoon } from "@/components/nav/coming-soon";

export const metadata: Metadata = { title: "Calendário" };

export default async function CalendarioPage({
  params,
}: {
  readonly params: Promise<{ conta: string }>;
}): Promise<ReactNode> {
  const { conta } = await params;

  return (
    <ComingSoon
      icon={CalendarDays}
      title="Calendário"
      phase="Fase 3"
      account={decodeURIComponent(conta)}
      description="O mês inteiro numa olhada, com as postagens no horário em que vão sair e o arrastar para reagendar."
    />
  );
}
