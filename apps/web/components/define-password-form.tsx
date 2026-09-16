"use client";

import { useActionState } from "react";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, type AccessLinkPurpose } from "@repo/shared";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { consumeLinkAction } from "@/lib/actions/auth";
import type { ActionResult } from "@/lib/actions/result";

/**
 * Definir a senha pelo link — serve ao primeiro cadastro e à redefinição.
 *
 * A confirmação da senha é lida de verdade pela ação (foi defeito real no
 * `nossobuncker`: o campo existia na tela e ninguém o comparava).
 */
export function DefinePasswordForm({
  purpose,
  token,
}: {
  readonly purpose: AccessLinkPurpose;
  readonly token: string;
}) {
  const enviarComLink = consumeLinkAction.bind(null, purpose, token);
  const [resultado, enviar, enviando] = useActionState<ActionResult<never> | null, FormData>(enviarComLink, null);

  return (
    <form action={enviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Nova senha</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          required
          className="h-11"
        />
        <p className="text-xs text-muted-foreground">
          De {PASSWORD_MIN_LENGTH} a {PASSWORD_MAX_LENGTH} caracteres. Não precisa de símbolo nem número — o que
          protege é o tamanho.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmation">Repita a senha</Label>
        <Input
          id="confirmation"
          name="confirmation"
          type="password"
          autoComplete="new-password"
          required
          className="h-11"
        />
      </div>

      <FormError result={resultado} />

      <Button type="submit" disabled={enviando} className="h-11">
        {enviando ? "Salvando…" : "Salvar senha"}
      </Button>
    </form>
  );
}
