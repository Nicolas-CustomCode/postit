"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { openNotificationAction } from "@/lib/actions/notifications";

/**
 * Abre o aviso ao montar: marca como lido e redireciona, pela mesma ação do sino.
 *
 * ⚠️ **Um `ref` segura a chamada.** O StrictMode do desenvolvimento monta o efeito
 * duas vezes; sem a trava, seriam duas ações — inofensivas, porque marcar é
 * idempotente, mas dois redirecionamentos disputando a navegação.
 */
export function OpenNotification({ id }: { readonly id: string }): ReactNode {
  const iniciado = useRef(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (iniciado.current) return;
    iniciado.current = true;

    void openNotificationAction(id).then((resultado) => {
      // Deu certo, a ação redireciona e nada volta; só o erro chega aqui.
      if (!resultado.ok) setErro(resultado.message);
    });
  }, [id]);

  if (erro === null) {
    return (
      <p className="text-sm text-muted-foreground" role="status">
        Abrindo o aviso…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Alert variant="destructive" role="alert">
        <AlertDescription>{erro}</AlertDescription>
      </Alert>
      <Link href="/notificacoes" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
        Ver todos os avisos
      </Link>
    </div>
  );
}
