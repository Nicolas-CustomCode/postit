import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { ActionResult } from "@/lib/actions/result";

/**
 * O aviso de erro dos formulários.
 *
 * `role="alert"` para o leitor de tela anunciar sem a pessoa precisar procurar —
 * quem entra por teclado ou com leitor de tela não vê a cor vermelha aparecer.
 */
export function FormError({ result }: { readonly result: ActionResult<unknown> | null }): ReactNode {
  if (result === null || result.ok) return null;

  return (
    <Alert variant="destructive" role="alert">
      <AlertCircle />
      <AlertDescription>{result.message}</AlertDescription>
    </Alert>
  );
}
