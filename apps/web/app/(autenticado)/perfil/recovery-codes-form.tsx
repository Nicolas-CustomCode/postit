"use client";

import { useActionState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { regenerateRecoveryCodesAction } from "@/lib/actions/profile";
import type { ActionResult } from "@/lib/actions/result";

/** Gerar códigos novos invalida os anteriores, e eles aparecem uma vez só. */
export function RecoveryCodesForm() {
  const [resultado, enviar, enviando] = useActionState<ActionResult<{ codes: readonly string[] }> | null, FormData>(
    regenerateRecoveryCodesAction,
    null,
  );

  if (resultado?.ok === true) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Anote os novos códigos. Os anteriores deixaram de valer, e esta é a única vez que estes aparecem.
        </p>
        <ul className="grid grid-cols-2 gap-2 rounded-xl border p-3 font-mono text-sm tabular-nums">
          {resultado.data.codes.map((codigo) => (
            <li key={codigo}>{codigo}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <form action={enviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="recovery-code">Código do aplicativo</Label>
        <Input
          id="recovery-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          required
          className="h-11 tabular-nums"
        />
      </div>

      <FormError result={resultado} />

      <Button type="submit" variant="secondary" disabled={enviando} className="h-11">
        {enviando ? "Gerando…" : "Gerar 10 códigos novos"}
      </Button>
    </form>
  );
}
