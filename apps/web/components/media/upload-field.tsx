"use client";

import { ImageUp, Loader2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import {
  feedImagePreProblem,
  FEED_IMAGE_MIME,
  FEED_IMAGE_RATIO_LABEL,
  megabytes,
  type MediaSummary,
  type MediaPreProblem,
  type UploadPermission,
} from "@repo/shared";
import { confirmUploadAction, requestUploadPermissionAction } from "@/lib/actions/media";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/**
 * Escolher uma imagem e enviá-la (RF-B01, RF-B02).
 *
 * O arquivo vai **direto do navegador para o armazenamento**, sem passar pelo
 * Next nem pela API (ADR 0012). O que passa por aqui é só a autorização, que a
 * Server Action busca, e a confirmação depois.
 *
 * ⚠️ **`XMLHttpRequest`, e não `fetch`.** O `fetch` não relata progresso de
 * envio: ele só avisa quando termina, e a barra saltaria de 0 a 100. O RF-B01
 * pede progresso real, que só o `upload.onprogress` do XHR dá.
 *
 * ⚠️ **Não dá para usar um `<form action="…">` apontando para o armazenamento**:
 * a CSP tem `form-action 'self'` e o navegador bloquearia o envio (ADR 0014).
 */
type Estado =
  | { fase: "parado" }
  | { fase: "enviando"; porcento: number }
  | { fase: "conferindo" }
  | { fase: "pronto"; midia: MediaSummary };

export function UploadField({ onUploaded }: { readonly onUploaded?: (media: MediaSummary) => void }): ReactNode {
  const [estado, setEstado] = useState<Estado>({ fase: "parado" });
  const [erro, setErro] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const ocupado = estado.fase === "enviando" || estado.fase === "conferindo";

  async function escolher(file: File): Promise<void> {
    setErro(null);

    // O que dá para saber sem abrir o arquivo, a tela confere antes de gastar o
    // envio (docs/02, RF-B02). A API confere tudo de novo — aqui é conveniência,
    // não proteção.
    const problema = feedImagePreProblem(file);
    if (problema !== null) {
      setErro(mensagemLocal(problema, file.size));
      setEstado({ fase: "parado" });
      return;
    }

    const permissao = await requestUploadPermissionAction();
    if (!permissao.ok) {
      setErro(permissao.message);
      setEstado({ fase: "parado" });
      return;
    }

    setEstado({ fase: "enviando", porcento: 0 });
    try {
      await enviarAoArmazenamento(permissao.data, file, (porcento) => setEstado({ fase: "enviando", porcento }));
    } catch {
      // O armazenamento recusa aqui o que passa do limite ou do tipo assinado —
      // e é ele que precisa recusar, antes de o arquivo ocupar espaço.
      setErro("Não consegui enviar o arquivo. Tente de novo.");
      setEstado({ fase: "parado" });
      return;
    }

    setEstado({ fase: "conferindo" });
    const confirmado = await confirmUploadAction(permissao.data.ticket);
    if (!confirmado.ok) {
      setErro(completarMensagem(confirmado.code, confirmado.message, file.size));
      setEstado({ fase: "parado" });
      return;
    }

    setEstado({ fase: "pronto", midia: confirmado.data });
    onUploaded?.(confirmado.data);
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={input}
        type="file"
        accept={FEED_IMAGE_MIME}
        className="sr-only"
        disabled={ocupado}
        onChange={(evento) => {
          const file = evento.target.files?.[0];
          // Limpa o valor para escolher o mesmo arquivo duas vezes disparar de novo.
          evento.target.value = "";
          if (file !== undefined) void escolher(file);
        }}
      />

      <Button
        type="button"
        variant="outline"
        className="h-11 justify-start gap-2 md:h-10"
        disabled={ocupado}
        onClick={() => input.current?.click()}
      >
        {ocupado ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImageUp className="size-4" aria-hidden />}
        {rotulo(estado)}
      </Button>

      {estado.fase === "enviando" && (
        <Progress value={estado.porcento} aria-label="Progresso do envio" />
      )}

      {estado.fase === "pronto" && (
        <p className="text-sm text-muted-foreground">
          Imagem pronta: {estado.midia.width} × {estado.midia.height} pixels.
        </p>
      )}

      {erro !== null && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function rotulo(estado: Estado): string {
  switch (estado.fase) {
    case "enviando":
      return `Enviando… ${estado.porcento}%`;
    case "conferindo":
      // O nome do estado importa: a pessoa precisa saber que ainda há trabalho
      // acontecendo depois de a barra encher (docs/04, "Estados de interface").
      return "Conferindo o arquivo…";
    case "pronto":
      return "Escolher outra imagem";
    default:
      return "Escolher imagem";
  }
}

/**
 * Envia o arquivo ao armazenamento com os campos assinados.
 *
 * ⚠️ **O arquivo é o último campo do formulário.** É exigência do protocolo: o
 * armazenamento lê os campos na ordem, e o que vier depois do arquivo é
 * ignorado — inclusive a assinatura.
 */
function enviarAoArmazenamento(
  permissao: UploadPermission,
  file: File,
  aoProgredir: (porcento: number) => void,
): Promise<void> {
  const form = new FormData();
  for (const [nome, valor] of Object.entries(permissao.fields)) form.append(nome, valor);
  form.append("file", file);

  return new Promise((resolver, rejeitar) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", permissao.url);

    xhr.upload.onprogress = (evento) => {
      if (evento.lengthComputable) aoProgredir(Math.round((evento.loaded / evento.total) * 100));
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolver() : rejeitar(new Error(String(xhr.status))));
    xhr.onerror = () => rejeitar(new Error("rede"));
    xhr.send(form);
  });
}

/** O que a tela mesma detectou, antes de enviar. */
function mensagemLocal(problema: MediaPreProblem, bytes: number): string {
  switch (problema) {
    case "WRONG_TYPE":
      return "O Instagram só aceita JPEG em publicações de feed. Converta a imagem e tente de novo.";
    case "EMPTY":
      return "Este arquivo está vazio.";
    case "TOO_LARGE":
      return `JPEG de até 8 MB. Este arquivo tem ${megabytes(bytes)} MB.`;
  }
}

/**
 * Completa a mensagem da API com o que só a tela sabe.
 *
 * A API manda o limite; o tamanho real do arquivo ela não tem por que devolver —
 * quem o mediu foi o navegador. Juntando os dois sai a frase que o docs/04 pede:
 * "JPEG de até 8 MB. Este arquivo tem 12,3 MB".
 */
function completarMensagem(code: string, message: string, bytes: number): string {
  if (code === "MEDIA_TOO_LARGE") return `${message}. Este arquivo tem ${megabytes(bytes)} MB.`;
  if (code === "MEDIA_RATIO_UNSUPPORTED") return `${message}. A faixa aceita é de ${FEED_IMAGE_RATIO_LABEL}.`;
  return message;
}
