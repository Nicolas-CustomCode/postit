"use client";

import { useActionState } from "react";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { loginAction } from "@/lib/actions/auth";
import type { ActionResult } from "@/lib/actions/result";

/**
 * E-mail e senha. O segundo passo — o código de 6 dígitos — é outra tela: senha
 * certa sozinha não entra (ADR 0013).
 */
export function LoginForm({ voltar }: { readonly voltar: string }) {
  const [resultado, enviar, enviando] = useActionState<ActionResult<never> | null, FormData>(loginAction, null);

  return (
    <form action={enviar} className="flex flex-col gap-4">
      {/* Para onde voltar depois de entrar. Passa por safeRedirect() na ação. */}
      <input type="hidden" name="voltar" value={voltar} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          required
          className="h-11"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Senha</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="h-11"
        />
      </div>

      <FormError result={resultado} />

      <Button type="submit" disabled={enviando} className="h-11">
        {enviando ? "Entrando…" : "Entrar"}
      </Button>
    </form>
  );
}
