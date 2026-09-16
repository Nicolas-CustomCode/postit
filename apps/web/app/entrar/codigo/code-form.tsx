"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { verifyCodeAction } from "@/lib/actions/auth";
import type { ActionResult } from "@/lib/actions/result";

type Resultado = ActionResult<{ recoveryCodes?: readonly string[]; voltar: string }> | null;

/**
 * O segundo passo do login: o código de 6 dígitos do aplicativo, ou um código de
 * recuperação de quem perdeu o celular.
 */
export function CodeForm({ voltar }: { readonly voltar: string }) {
  const router = useRouter();
  const [resultado, enviar, enviando] = useActionState<Resultado, FormData>(verifyCodeAction, null);
  const [recuperacao, setRecuperacao] = useState(false);

  useEffect(() => {
    // A navegação acontece aqui, e não na ação: a ação precisa devolver o
    // resultado para a tela poder mostrar erro sem perder o que foi digitado.
    if (resultado?.ok === true) router.replace(resultado.data.voltar);
  }, [resultado, router]);

  return (
    <form action={enviar} className="flex flex-col gap-4">
      <input type="hidden" name="voltar" value={voltar} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="code">{recuperacao ? "Código de recuperação" : "Código do aplicativo"}</Label>
        <Input
          id="code"
          name="code"
          // Teclado numérico no celular e autopreenchimento do código pelo SO.
          inputMode={recuperacao ? "text" : "numeric"}
          autoComplete={recuperacao ? "off" : "one-time-code"}
          maxLength={recuperacao ? 11 : 6}
          placeholder={recuperacao ? "XXXXX-XXXXX" : "000000"}
          required
          autoFocus
          className="h-11 text-center text-lg tracking-widest tabular-nums"
        />
      </div>

      <FormError result={resultado} />

      <Button type="submit" disabled={enviando} className="h-11">
        {enviando ? "Conferindo…" : "Confirmar"}
      </Button>

      <button
        type="button"
        onClick={() => setRecuperacao(!recuperacao)}
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        {recuperacao ? "Usar o código do aplicativo" : "Perdi o celular: usar um código de recuperação"}
      </button>
    </form>
  );
}
