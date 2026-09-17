"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { verifyCodeAction } from "@/lib/actions/auth";
import type { ActionResult } from "@/lib/actions/result";
import { cn } from "@/lib/utils";

type Resultado = ActionResult<{ recoveryCodes?: readonly string[]; voltar: string }> | null;

const DIGITOS = 6;

/**
 * O segundo passo do login: o código de 6 dígitos do aplicativo, ou um código de
 * recuperação de quem perdeu o celular.
 */
export function CodeForm({ voltar }: { readonly voltar: string }): ReactNode {
  const router = useRouter();
  const [resultado, enviar, enviando] = useActionState<Resultado, FormData>(verifyCodeAction, null);
  const [recuperacao, setRecuperacao] = useState(false);
  const [codigo, setCodigo] = useState("");

  useEffect(() => {
    // A navegação acontece aqui, e não na ação: a ação precisa devolver o
    // resultado para a tela poder mostrar erro sem perder o que foi digitado.
    if (resultado?.ok === true) router.replace(resultado.data.voltar);
  }, [resultado, router]);

  const completo = recuperacao ? codigo.trim().length > 0 : codigo.length === DIGITOS;

  return (
    <form action={enviar} className="flex flex-col gap-4">
      <input type="hidden" name="voltar" value={voltar} />

      {recuperacao ? (
        <Input
          name="code"
          value={codigo}
          onChange={(evento) => setCodigo(evento.target.value)}
          aria-label="Código de recuperação"
          autoComplete="off"
          maxLength={11}
          placeholder="XXXXX-XXXXX"
          required
          autoFocus
          className="h-13 rounded-xl text-center text-lg tracking-widest tabular-nums"
        />
      ) : (
        <>
          <CaixasDeCodigo valor={codigo} aoMudar={setCodigo} />
          <p className="text-[13px] text-muted-foreground">O código muda a cada 30 segundos.</p>
        </>
      )}

      <FormError result={resultado} />

      <Button type="submit" disabled={enviando || !completo} className="mt-3 h-13 rounded-xl text-base font-bold">
        {enviando ? "Conferindo…" : "Entrar"}
      </Button>

      <button
        type="button"
        onClick={() => {
          setRecuperacao(!recuperacao);
          setCodigo("");
        }}
        className="mx-auto flex min-h-11 items-center text-[15px] font-semibold text-primary"
      >
        {recuperacao ? "Usar o código do aplicativo" : "Usar um código de recuperação"}
      </button>
    </form>
  );
}

/**
 * As seis caixas do artefato (artboard `EntrarCelular`).
 *
 * Por baixo há **um campo de texto só**, transparente e esticado por cima das
 * caixas; elas são desenho (`aria-hidden`). É o que mantém de graça o colar, o
 * apagar, as setas, o autopreenchimento do sistema e o leitor de tela — seis
 * campos de verdade quebrariam todos esses comportamentos, um a um.
 */
function CaixasDeCodigo({
  valor,
  aoMudar,
}: {
  readonly valor: string;
  readonly aoMudar: (novo: string) => void;
}): ReactNode {
  const campo = useRef<HTMLInputElement>(null);
  const ativa = Math.min(valor.length, DIGITOS - 1);

  // O cursor volta sempre ao fim: sem isso, clicar no meio do campo escreveria
  // no meio do código enquanto o destaque continuaria na última caixa.
  function aoFim(): void {
    campo.current?.setSelectionRange(valor.length, valor.length);
  }

  return (
    <div className="relative">
      <input
        ref={campo}
        name="code"
        value={valor}
        onChange={(evento) => aoMudar(evento.target.value.replace(/\D/g, "").slice(0, DIGITOS))}
        onFocus={aoFim}
        onClick={aoFim}
        aria-label="Código do aplicativo"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={DIGITOS}
        required
        autoFocus
        // Invisível, mas de verdade: é ele que recebe o foco e o teclado.
        className="absolute inset-0 z-10 w-full opacity-0"
      />

      <div className="grid grid-cols-6 gap-2" aria-hidden>
        {Array.from({ length: DIGITOS }, (_, indice) => (
          <div
            key={indice}
            className={cn(
              "flex h-15 items-center justify-center rounded-xl border-2 bg-card font-heading text-[26px] font-bold tabular-nums",
              indice === ativa ? "border-primary ring-4 ring-accent" : "border-border",
            )}
          >
            {valor[indice] ?? ""}
          </div>
        ))}
      </div>
    </div>
  );
}
