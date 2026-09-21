"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { UploadField } from "@/components/media/upload-field";

/**
 * O envio na tela do Acervo.
 *
 * Existe só para **atualizar a grade** depois que o envio termina: o
 * `UploadField` é componente de cliente e a lista é servida pelo servidor, então
 * alguém precisa pedir o refresh. Sem isso, a imagem recém-enviada só apareceria
 * ao recarregar a página — e a pessoa concluiria que o envio falhou.
 */
export function AcervoUpload(): ReactNode {
  const router = useRouter();

  return <UploadField onUploaded={() => router.refresh()} />;
}
