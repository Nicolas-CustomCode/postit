import type { ReactNode } from "react";
import { BrandSvg } from "@/components/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * A casca das telas de entrada — login, código, cadastro, redefinição.
 *
 * Centralizada e estreita: são telas de um formulário só, e no celular elas
 * precisam caber acima do teclado.
 */
export function AuthShell({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div className="flex items-center gap-3">
        <BrandSvg className="size-8" />
        <span className="font-heading text-xl font-extrabold tracking-tight">PostIt</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-xl">{title}</CardTitle>
          {description === undefined ? null : <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  );
}
