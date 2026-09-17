import type { ReactNode } from "react";
import { BrandSvg } from "@/components/brand";

/**
 * A casca das telas de entrada — login, código, cadastro, redefinição
 * (artboard `EntrarCelular` do artefato de identidade).
 *
 * É a página inteira, e não um cartão centrado: no celular, um cartão dentro de
 * um fundo desperdiça a largura e empurra o formulário para baixo do teclado.
 * No computador a coluna continua estreita, porque é um formulário só.
 *
 * `step` é o "ETAPA 2 DE 2": o login tem dois passos obrigatórios (ADR 0013), e
 * quem chega na segunda tela precisa saber que ainda não acabou — e que não deu
 * errado.
 */
export function AuthShell({
  step,
  title,
  description,
  footer,
  children,
}: {
  readonly step?: string;
  readonly title: string;
  readonly description?: string;
  /** O rodapé de ajuda, separado por um risco. */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-6 pt-14 pb-8">
      <div className="flex items-center gap-3">
        <BrandSvg className="size-11" />
        <span className="font-heading text-[28px] font-extrabold tracking-[-0.02em]">PostIt</span>
      </div>

      <div className="mt-14 flex flex-col gap-2.5">
        {step === undefined ? null : (
          <p className="text-[13px] font-bold tracking-[0.05em] text-muted-foreground uppercase">{step}</p>
        )}
        <h1 className="font-heading text-[30px] leading-tight font-extrabold tracking-[-0.02em]">{title}</h1>
        {description === undefined ? null : (
          <p className="text-[15px] leading-normal text-muted-foreground">{description}</p>
        )}
      </div>

      <div className="mt-8">{children}</div>

      {footer === undefined ? null : (
        <>
          <div className="flex-1" />
          <div className="mt-10 border-t pt-4 text-[13px] leading-normal text-muted-foreground">{footer}</div>
        </>
      )}
    </main>
  );
}
