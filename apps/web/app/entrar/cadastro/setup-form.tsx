"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import type { TwoFactorSetup } from "@repo/shared";
import { FormError } from "@/components/form-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { startTotpSetupAction, verifyCodeAction } from "@/lib/actions/auth";
import type { ActionResult } from "@/lib/actions/result";

type Resultado = ActionResult<{ recoveryCodes?: readonly string[]; voltar: string }> | null;

/**
 * Primeiro acesso: cadastrar o aplicativo autenticador.
 *
 * O QR é pedido por ação assim que a tela abre — o token do desafio fica no
 * cookie e nunca passa pelo navegador. No celular, ler o QR da própria tela é
 * impossível, por isso o link `otpauth://` (docs/13).
 */
export function SetupForm({ voltar }: { readonly voltar: string }) {
  const router = useRouter();
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [erroDeSetup, setErroDeSetup] = useState<string | null>(null);
  const [resultado, enviar, enviando] = useActionState<Resultado, FormData>(verifyCodeAction, null);
  const [copiados, setCopiados] = useState(false);

  useEffect(() => {
    // Uma vez por abertura da tela. Pedir de novo devolveria o mesmo segredo: a
    // API reaproveita o que está pendente, justamente para o QR lido continuar
    // valendo.
    void startTotpSetupAction().then((resposta) => {
      if (resposta.ok) setSetup(resposta.data);
      else setErroDeSetup(resposta.message);
    });
  }, []);

  const codigos = resultado?.ok === true ? resultado.data.recoveryCodes : undefined;

  // Deu certo: a sessão já existe. Antes de seguir, os códigos de recuperação
  // aparecem — é a única vez na vida que eles existem legíveis.
  if (codigos !== undefined) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Guarde estes <strong>10 códigos</strong> num lugar seguro. Cada um serve uma vez, e eles são a única forma de
          entrar se você perder o celular. Eles não serão mostrados de novo.
        </p>

        <ul className="grid grid-cols-2 gap-2 rounded-xl border p-3 font-mono text-sm tabular-nums">
          {codigos.map((codigo) => (
            <li key={codigo}>{codigo}</li>
          ))}
        </ul>

        <Button
          type="button"
          variant="secondary"
          className="h-11"
          onClick={() => {
            void navigator.clipboard.writeText(codigos.join("\n")).then(() => setCopiados(true));
          }}
        >
          {copiados ? "Copiados" : "Copiar códigos"}
        </Button>

        <Button type="button" className="h-11" onClick={() => router.replace(voltar)}>
          Já anotei, continuar
        </Button>
      </div>
    );
  }

  if (erroDeSetup !== null) {
    return (
      <div className="flex flex-col gap-4">
        <Alert variant="destructive" role="alert">
          <AlertDescription>{erroDeSetup}</AlertDescription>
        </Alert>
        <Link href="/entrar" className="text-sm font-semibold text-primary underline-offset-4 hover:underline">
          Voltar para o login
        </Link>
      </div>
    );
  }

  return (
    <form action={enviar} className="flex flex-col gap-4">
      <input type="hidden" name="voltar" value={voltar} />

      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Abra um aplicativo autenticador (Google Authenticator, 1Password e similares).</li>
        <li>Leia o código abaixo ou toque em &ldquo;abrir no aplicativo&rdquo;.</li>
        <li>Digite o código de 6 dígitos que aparecer.</li>
      </ol>

      {setup === null ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Preparando o código…</p>
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- imagem gerada pela API, em data: */}
          <img
            src={setup.qrDataUrl}
            alt="Código QR para cadastrar o aplicativo autenticador"
            className="mx-auto size-48"
          />
          <a
            href={setup.otpauthUrl}
            className="text-center text-sm font-semibold text-primary underline-offset-4 hover:underline"
          >
            Abrir no aplicativo autenticador
          </a>
        </>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="code">Código de 6 dígitos</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          required
          className="h-11 text-center text-lg tracking-widest tabular-nums"
        />
      </div>

      <FormError result={resultado} />

      <Button type="submit" disabled={enviando || setup === null} className="h-11">
        {enviando ? "Conferindo…" : "Confirmar e entrar"}
      </Button>
    </form>
  );
}
