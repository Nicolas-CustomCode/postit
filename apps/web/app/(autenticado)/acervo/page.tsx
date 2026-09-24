import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { can } from "@repo/shared";
import { AcervoUpload } from "@/components/media/acervo-upload";
import { AcervoGrid } from "@/components/media/acervo-grid";
import { PageHeader } from "@/components/nav/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";
import { listMedia } from "@/lib/data/media";

export const metadata: Metadata = { title: "Acervo" };

/**
 * O acervo de mídias (RF-B01, RF-B04).
 *
 * **Compartilhado entre contas de propósito** (docs/13): uma imagem enviada
 * serve a qualquer conta e a qualquer formato, e por isso esta é uma tela
 * geral — não fica sob `/c/<conta>/`.
 *
 * O que entra aqui é escolhido na composição, pelo mesmo `MediaGrid`. Antes de
 * 21/09/2026 não era: a tela recebia imagens que nunca saíam, porque a
 * composição mandava uma nova a cada postagem.
 */
export default async function AcervoPage(): Promise<ReactNode> {
  const { user } = await requireSession();
  // Esconder não é proteger: a API recusa de novo (regra 17). Aqui é para não
  // mostrar um caminho que terminaria em 403.
  if (!can(user, "POST_EDIT")) notFound();

  const media = await listMedia();

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 pb-8 md:px-10 md:py-7">
      <PageHeader
        trail={["Geral", "Acervo"]}
        title="Acervo"
        description="As imagens que você já enviou, prontas para virar postagem em qualquer conta."
      />

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="font-heading text-lg">Enviar imagem</CardTitle>
          <CardDescription>
            JPEG de até 8 MB, com pelo menos 320 pixels de largura — os limites do próprio Instagram. PNG,
            WebP e fotos maiores são convertidos antes do envio.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <AcervoUpload />
          <p className="text-sm text-muted-foreground">
            O arquivo vai direto para o nosso armazenamento e só fica disponível depois de conferido. A
            proporção não impede o envio: cada formato de postagem aceita a sua, e a conferência acontece na
            hora de compor.
          </p>
        </CardContent>
      </Card>

      {/* O título vem com a grade: o botão de selecionar mora ao lado dele, e
          quem sabe se há seleção em curso é o componente de cliente. */}
      <section>
        <AcervoGrid media={media} />
      </section>
    </main>
  );
}
