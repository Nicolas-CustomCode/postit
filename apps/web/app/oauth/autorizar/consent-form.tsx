"use client";

import { useActionState, type ReactNode } from "react";
import type { OAuthAuthorizeInput } from "@repo/shared";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/ui/button";
import { approveAssistantAction, denyAssistantAction } from "@/lib/actions/oauth";
import type { ActionResult } from "@/lib/actions/result";

/** Os parâmetros do pedido, de volta à ação — a API confere tudo de novo. */
function RequestFields({ request }: { readonly request: OAuthAuthorizeInput }): ReactNode {
  return Object.entries(request).map(([name, value]) =>
    value === undefined ? null : <input key={name} type="hidden" name={name} value={value} />,
  );
}

/** "Permitir" e "Recusar". Sem `POSTAGEM_EDITAR`, só recusar. */
export function ConsentForm({
  request,
  canAuthorize,
}: {
  readonly request: OAuthAuthorizeInput;
  readonly canAuthorize: boolean;
}): ReactNode {
  const [aprovacao, aprovar, aprovando] = useActionState<ActionResult<never> | null, FormData>(
    approveAssistantAction,
    null,
  );
  const [recusa, recusar, recusando] = useActionState<ActionResult<never> | null, FormData>(denyAssistantAction, null);
  const ocupado = aprovando || recusando;

  return (
    <div className="flex flex-col gap-3">
      <FormError result={aprovacao ?? recusa} />
      {canAuthorize ? (
        <form action={aprovar}>
          <RequestFields request={request} />
          <Button type="submit" disabled={ocupado} className="h-13 w-full rounded-xl text-base font-bold">
            {aprovando ? "Permitindo…" : "Permitir"}
          </Button>
        </form>
      ) : null}
      <form action={recusar}>
        <RequestFields request={request} />
        <Button
          type="submit"
          variant="outline"
          disabled={ocupado}
          className="h-13 w-full rounded-xl text-base font-bold"
        >
          {recusando ? "Recusando…" : "Recusar"}
        </Button>
      </form>
    </div>
  );
}
