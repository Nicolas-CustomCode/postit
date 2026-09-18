"use client";

import { ImageUp, Loader2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import {
  formatsFor,
  imageUploadPreProblem,
  targetRatioFor,
  IMAGE_SPECS,
  IMAGE_UPLOAD_SPEC,
  megabytes,
  type ImageFormat,
  type MediaSummary,
  type MediaPreProblem,
  type UploadPermission,
} from "@repo/shared";
import { confirmUploadAction, requestUploadPermissionAction } from "@/lib/actions/media";
import { CropPreview } from "@/components/media/crop-preview";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { blobToFile, cropToJpeg, loadImage, type LoadedImage } from "@/lib/media/crop-image";

/**
 * Escolher uma imagem e enviá-la (RF-B01, RF-B02, RF-B03).
 *
 * O arquivo vai **direto do navegador para o armazenamento**, sem passar pelo
 * Next nem pela API (ADR 0012). O que passa por aqui é só a autorização, que a
 * Server Action busca, e a confirmação depois.
 *
 * ⚠️ **O acervo não escolhe formato, e por isso não recorta sozinho.** A faixa
 * de 4:5 a 1.91:1 vale só para o feed; Stories não tem faixa nenhuma. Quando a
 * imagem não cabe no feed, a tela **oferece** o recorte em vez de impô-lo — uma
 * arte 9:16 é perfeita como está, e recortá-la destruiria o formato pretendido.
 *
 * ⚠️ **`XMLHttpRequest`, e não `fetch`.** O `fetch` não relata progresso de
 * envio: ele só avisa quando termina, e a barra saltaria de 0 a 100. O RF-B01
 * pede progresso real, que só o `upload.onprogress` do XHR dá.
 *
 * ⚠️ **Não dá para usar um `<form action="…">` apontando para o armazenamento**:
 * a CSP tem `form-action 'self'` e o navegador bloquearia o envio (ADR 0014).
 */
/** O arquivo original fica guardado: "enviar como está" manda ele, sem recorte. */
type Escolhida = { file: File; imagem: LoadedImage };

type Estado =
  | { fase: "parado" }
  | { fase: "decidindo"; escolhida: Escolhida; ratioDoFeed: number }
  | { fase: "recortando"; escolhida: Escolhida; ratio: number }
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
    const problema = imageUploadPreProblem(file);
    if (problema !== null) {
      setErro(mensagemLocal(problema, file.size));
      setEstado({ fase: "parado" });
      return;
    }

    /*
     * Só aqui as dimensões aparecem: o navegador decodifica a imagem e **já
     * aplica a orientação da câmera**, então a foto tirada em pé chega em pé. É
     * o que permite dizer para que formatos ela serve antes de gastar 8 MB.
     */
    let imagem: LoadedImage;
    try {
      imagem = await loadImage(file);
    } catch {
      setErro("Não consegui ler esta imagem. O arquivo pode estar corrompido.");
      setEstado({ fase: "parado" });
      return;
    }

    /*
     * A imagem entra no acervo de qualquer jeito — o piso já foi conferido. O
     * que muda é se vale a pena oferecer o recorte: só quando ela não cabe no
     * feed, que é o formato exigente. Quem vai usá-la em Stories segue direto.
     */
    const ratioDoFeed = targetRatioFor(imagem.width, imagem.height, IMAGE_SPECS.FEED_IMAGE);
    if (ratioDoFeed !== null) {
      setEstado({ fase: "decidindo", escolhida: { file, imagem }, ratioDoFeed });
      return;
    }

    await enviar(file);
  }

  /** Recorta o que a pessoa escolheu e envia o resultado, não o original. */
  async function enviarRecorte(position: number): Promise<void> {
    if (estado.fase !== "recortando") return;
    setErro(null);

    try {
      const blob = await cropToJpeg(estado.escolhida.imagem, estado.ratio, position);
      await enviar(blobToFile(blob, estado.escolhida.file.name));
    } catch {
      setErro("Não consegui recortar a imagem. Tente outra.");
      setEstado({ fase: "parado" });
    }
  }

  async function enviar(file: File): Promise<void> {
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
        accept={IMAGE_UPLOAD_SPEC.mime}
        className="sr-only"
        disabled={ocupado}
        onChange={(evento) => {
          const file = evento.target.files?.[0];
          // Limpa o valor para escolher o mesmo arquivo duas vezes disparar de novo.
          evento.target.value = "";
          if (file !== undefined) void escolher(file);
        }}
      />

      {estado.fase === "decidindo" && (
        <FormatChoice
          image={estado.escolhida.imagem}
          onSendAsIs={() => void enviar(estado.escolhida.file)}
          onCrop={() =>
            setEstado({ fase: "recortando", escolhida: estado.escolhida, ratio: estado.ratioDoFeed })
          }
          onChooseAnother={() => {
            setEstado({ fase: "parado" });
            input.current?.click();
          }}
        />
      )}

      {estado.fase === "recortando" && (
        <CropPreview
          image={estado.escolhida.imagem}
          ratio={estado.ratio}
          spec={IMAGE_SPECS.FEED_IMAGE}
          busy={false}
          onConfirm={(posicao) => void enviarRecorte(posicao)}
          onCancel={() =>
            setEstado({
              fase: "decidindo",
              escolhida: estado.escolhida,
              ratioDoFeed: estado.ratio,
            })
          }
        />
      )}

      {/* Enquanto se decide ou se recorta, os botões que valem são os de lá. */}
      {estado.fase !== "decidindo" && estado.fase !== "recortando" && (
        <Button
          type="button"
          variant="outline"
          className="h-11 justify-start gap-2 md:h-10"
          disabled={ocupado}
          onClick={() => input.current?.click()}
        >
          {ocupado ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <ImageUp className="size-4" aria-hidden />
          )}
          {rotulo(estado)}
        </Button>
      )}

      {estado.fase === "enviando" && (
        <Progress value={estado.porcento} aria-label="Progresso do envio" />
      )}

      {estado.fase === "pronto" && (
        <p className="text-sm text-muted-foreground">
          Imagem pronta: {estado.midia.width} × {estado.midia.height} pixels
          {/* Dizer para que ela serve é o que dá sentido a um acervo que aceita
              proporções diferentes: a resposta de "onde posso usar isto?" vem
              agora, não na hora de compor. */}
          {sufixoDeFormatos(formatsFor(estado.midia.width, estado.midia.height))}.
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

/**
 * A oferta que substituiu a imposição de recortar (RF-B03).
 *
 * Aparece quando a imagem não cabe no feed. Ela **não está errada** — só não
 * serve a esse formato —, então as duas saídas são legítimas e nenhuma é
 * destaque sobre a outra.
 */
function FormatChoice({
  image,
  onSendAsIs,
  onCrop,
  onChooseAnother,
}: {
  readonly image: LoadedImage;
  readonly onSendAsIs: () => void;
  readonly onCrop: () => void;
  /** Sem esta saída, quem escolheu o arquivo errado ficaria preso aqui. */
  readonly onChooseAnother: () => void;
}): ReactNode {
  const servePara = formatsFor(image.width, image.height);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <p className="text-sm font-medium">
          Esta imagem é {image.width} × {image.height} pixels
        </p>
        <p className="text-sm text-muted-foreground">
          Ela não cabe no feed, que aceita de {IMAGE_SPECS.FEED_IMAGE.ratioLabel}
          {sufixoDeFormatos(servePara)}.
        </p>
      </div>

      <div className="flex flex-col gap-2 md:flex-row">
        <Button type="button" className="h-11 md:h-10" onClick={onSendAsIs}>
          Enviar como está
        </Button>
        <Button type="button" variant="outline" className="h-11 md:h-10" onClick={onCrop}>
          Recortar para o feed
        </Button>
      </div>

      <Button
        type="button"
        variant="ghost"
        className="h-11 self-start px-0 text-muted-foreground md:h-10"
        onClick={onChooseAnother}
      >
        Escolher outra imagem
      </Button>
    </div>
  );
}

/** " — serve para Stories", ou nada quando não há formato a citar. */
function sufixoDeFormatos(formatos: readonly ImageFormat[]): string {
  if (formatos.length === 0) return "";
  return ` — serve para ${formatos.map((formato) => IMAGE_SPECS[formato].label).join(", ")}`;
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
      return "O Instagram só aceita JPEG. Converta a imagem e tente de novo.";
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
  return message;
}
