"use client";

import { useActionState } from "react";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@repo/shared";
import { FormError } from "@/components/form-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "@/lib/actions/profile";
import type { ActionResult } from "@/lib/actions/result";

/**
 * Trocar a senha exige a senha atual **e** um código do aplicativo, e derruba as
 * outras sessões (ADR 0013, seção 7).
 */
export function ChangePasswordForm() {
  const [resultado, enviar, enviando] = useActionState<ActionResult<{ revoked: number }> | null, FormData>(
    changePasswordAction,
    null,
  );

  if (resultado?.ok === true) {
    return (
      <Alert>
        <AlertDescription>
          Senha trocada. {resultado.data.revoked === 0 ? "Nenhuma outra sessão estava aberta." : null}
          {resultado.data.revoked === 1 ? "Outro aparelho foi desconectado." : null}
          {resultado.data.revoked > 1 ? `${resultado.data.revoked} outros aparelhos foram desconectados.` : null}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <form action={enviar} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="currentPassword">Senha atual</Label>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required className="h-11" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="newPassword">Nova senha</Label>
        <Input
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          maxLength={PASSWORD_MAX_LENGTH}
          required
          className="h-11"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirmation">Repita a nova senha</Label>
        <Input id="confirmation" name="confirmation" type="password" autoComplete="new-password" required className="h-11" />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Código do aplicativo</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          required
          className="h-11 tabular-nums"
        />
        {/* O código do login já foi gasto: cada código vale uma vez só. */}
        <p className="text-xs text-muted-foreground">Use o código que está aparecendo agora no aplicativo.</p>
      </div>

      <FormError result={resultado} />

      <Button type="submit" disabled={enviando} className="h-11">
        {enviando ? "Trocando…" : "Trocar senha"}
      </Button>
    </form>
  );
}
