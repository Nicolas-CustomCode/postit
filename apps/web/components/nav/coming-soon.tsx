import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/nav/page-header";

/**
 * As telas da conta que ainda não existem.
 *
 * Elas existem como rota porque o seletor de conta e o menu precisam de destino
 * real — e porque é assim que dá para provar, em teste, que trocar de conta
 * troca o endereço. O conteúdo diz em que fase a tela chega, em vez de fingir
 * ser uma tela pronta com dados inventados.
 */
export function ComingSoon({
  icon: Icone,
  title,
  phase,
  description,
  account,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly phase: string;
  readonly description: string;
  readonly account: string;
}): ReactNode {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pb-8 md:px-10 md:py-7">
      <PageHeader trail={[`@${account}`, title]} title={title} />

      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-10 text-center">
        <Icone className="size-8 text-muted-foreground" strokeWidth={2} aria-hidden />
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
        <p className="text-xs font-semibold tracking-wide text-primary uppercase">Chega na {phase}</p>
        <Link href="/contas" className="text-sm font-semibold underline-offset-4 hover:underline">
          Ver contas conectadas
        </Link>
      </div>
    </main>
  );
}
