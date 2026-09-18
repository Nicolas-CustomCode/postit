import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { can } from "@repo/shared";
import { UploadField } from "@/components/media/upload-field";
import { PageHeader } from "@/components/nav/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Acervo" };

/**
 * O acervo de mídias (RF-B01).
 *
 * **Compartilhado entre contas de propósito** (docs/13): uma imagem enviada
 * serve a qualquer conta, e por isso esta é uma tela geral — não fica sob
 * `/c/<conta>/`.
 *
 * Por ora só envia. Listar e reaproveitar o que já foi enviado (RF-B04) vem
 * junto com a tela de composição, quando houver postagem para usar a mídia.
 */
export default async function AcervoPage(): Promise<ReactNode> {
  const { user } = await requireSession();
  // Esconder não é proteger: a API recusa de novo (regra 17). Aqui é para não
  // mostrar um caminho que terminaria em 403.
  if (!can(user, "POST_EDIT")) notFound();

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 pb-8 md:px-10 md:py-7">
      <PageHeader
        trail={["Geral", "Acervo"]}
        title="Acervo"
        description="As imagens que você já enviou, prontas para virar postagem."
      />

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-lg">Enviar imagem</CardTitle>
          <CardDescription>
            JPEG de até 8 MB, com proporção entre 4:5 e 1.91:1 — os limites do próprio Instagram.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <UploadField />
          <p className="text-sm text-muted-foreground">
            O arquivo vai direto para o nosso armazenamento e só fica disponível depois de conferido. O que
            não passa nas regras é recusado na hora, com o motivo.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
