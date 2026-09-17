"use client";

import { KeyRound, List, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { SecurityOverview } from "@repo/shared";
import { LocalDate } from "@/components/local-date";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChangePasswordForm } from "./change-password-form";
import { RecoveryCodesForm } from "./recovery-codes-form";

/**
 * Segurança num bloco só (artboard `PerfilDesktop`).
 *
 * Três linhas que **dizem o estado** — quando a senha foi definida, desde quando
 * as duas etapas estão ativas, quantos códigos ainda valem — e abrem o
 * formulário no lugar. Antes eram três cartões com os três formulários sempre
 * abertos, o que fazia a tela parecer um formulário de cadastro em vez de um
 * painel.
 *
 * Uma linha aberta por vez: as duas ações pedem o código do aplicativo, e cada
 * código vale uma vez só. Dois formulários abertos convidariam a digitar o mesmo
 * código nos dois e receber "código incorreto" no segundo, sem explicação.
 */
type Linha = "senha" | "codigos";

export function SecurityCard({ security }: { readonly security: SecurityOverview }): ReactNode {
  const [aberta, setAberta] = useState<Linha | null>(null);

  const alternar = (linha: Linha) => setAberta((atual) => (atual === linha ? null : linha));

  return (
    <section className="flex flex-col rounded-2xl border bg-card p-4 md:p-5">
      <h2 className="pb-2.5 font-heading text-[17px] font-bold md:pb-3.5 md:text-lg">Segurança</h2>

      <Row
        icon={KeyRound}
        title="Senha"
        state={
          security.passwordSetAt === null ? (
            "Data não registrada"
          ) : (
            <>
              Definida em <LocalDate iso={security.passwordSetAt} format="longa" />
            </>
          )
        }
        action={
          <Button variant="secondary" onClick={() => alternar("senha")} className="h-11 w-full md:h-10 md:w-auto">
            {aberta === "senha" ? "Cancelar" : "Trocar senha"}
          </Button>
        }
      >
        {aberta === "senha" ? <ChangePasswordForm /> : null}
      </Row>

      <Divider />

      <Row
        icon={ShieldCheck}
        title="Verificação em duas etapas"
        state={
          <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-[#d9f7e3] px-2.5 text-xs font-bold text-[#13733a] dark:bg-[#0f3a23] dark:text-[#5ee08e]">
            <span className="size-1.5 rounded-full bg-current" aria-hidden />
            {security.twoFactorEnabledAt === null ? (
              "Ativa"
            ) : (
              <>
                Ativa desde <LocalDate iso={security.twoFactorEnabledAt} format="curta" />
              </>
            )}
          </span>
        }
        /* Sem ação de propósito: é obrigatória para todos e não se desliga
           (AGENTS.md, regra 11). A linha existe para dizer que está no lugar. */
        action={
          <p className="max-w-[190px] text-[13px] leading-snug text-muted-foreground md:text-right">
            Obrigatória para todos. Não é possível desligar.
          </p>
        }
      />

      <Divider />

      <Row
        icon={List}
        title="Códigos de recuperação"
        state={
          <>
            <strong className="font-bold text-foreground tabular-nums">
              {security.recoveryCodesRemaining} de {security.recoveryCodesTotal}
            </strong>{" "}
            ainda valem. Servem para entrar se você perder o celular.
          </>
        }
        action={
          <Button variant="secondary" onClick={() => alternar("codigos")} className="h-11 w-full md:h-10 md:w-auto">
            {aberta === "codigos" ? "Cancelar" : "Gerar novos"}
          </Button>
        }
      >
        {aberta === "codigos" ? <RecoveryCodesForm /> : null}
      </Row>
    </section>
  );
}

function Row({
  icon: Icone,
  title,
  state,
  action,
  children,
}: {
  readonly icon: typeof KeyRound;
  readonly title: string;
  readonly state: ReactNode;
  readonly action: ReactNode;
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2.5 py-3 md:flex-row md:items-center md:gap-3">
        <Icone className="size-5 shrink-0 md:mt-0" strokeWidth={2} aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm font-bold">{title}</p>
          <p className="text-[13px] leading-normal text-muted-foreground">{state}</p>
        </div>
        {action}
      </div>

      {/* O formulário abre alinhado ao texto, não ao ícone: fica claro que ele
          pertence àquela linha e não ao cartão inteiro. */}
      {children === null || children === undefined ? null : (
        <div className={cn("pb-4 md:pl-8")}>{children}</div>
      )}
    </div>
  );
}

function Divider(): ReactNode {
  return <div className="h-px bg-border" />;
}
