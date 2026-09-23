"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  fitFrame,
  letterboxedInCarousel,
  targetRatioFor,
  IMAGE_SPECS,
  type ImageFormat,
  type ImageSpec,
  type MediaSummary,
} from "@repo/shared";
import { ImageAdjust, type AdjustChoice } from "@/components/media/image-adjust";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { blobToFile, cropToJpeg, fitToJpeg, loadImageFromUrl, type LoadedImage } from "@/lib/media/crop-image";
import { uploadImage, type UploadStep } from "@/lib/media/upload";
import { cn } from "@/lib/utils";

/**
 * Ajustar uma imagem **que já está no acervo** ao formato da postagem
 * (RF-B03; ADR 0025).
 *
 * **Por que existe.** Até 22/09/2026 a imagem que não servia ao formato ficava
 * apagada no seletor, e a única saída era enviar outra — mesmo que a certa já
 * estivesse ali, só que em 3:4. O caminho do **envio** já oferecia recortar
 * desde o dia anterior; este é o mesmo ajuste, partindo de uma imagem que já
 * subiu.
 *
 * **O que sai daqui é um arquivo novo**, e tem de ser: a Meta publica baixando
 * de uma URL, então o recorte precisa existir como objeto. Ele nasce marcado
 * como derivado da original (`derivedFrom`), e é o que o mantém fora do acervo —
 * sem isso, a mesma foto viraria três entradas depois de ajustada para dois
 * formatos. A original continua intacta: quem usa a mesma foto no feed e no
 * Stories precisa das duas versões.
 *
 * **Com `target`, o ajuste é outro**: recortar a foto na proporção da primeira do
 * carrossel, para ela não sair com faixas pretas (docs/08, observado em 23/09/2026).
 *
 * ⚠️ **Irmã do seletor, nunca filha.** Duas folhas do Radix aninhadas brigam
 * pelo foco: fechar a de fora arranca o foco da de dentro, e o `Escape` não
 * chega em nenhuma. O mesmo defeito que o menu do quadrado de adicionar já
 * custou (`postagens.spec.ts`).
 */
export function MediaAdjustSheet({
  media,
  format,
  target,
  onOpenChange,
  onDone,
}: {
  /** `null` fecha. Quem abre é o seletor, ao clicar numa incompatível. */
  readonly media: MediaSummary | null;
  readonly format: ImageFormat;
  /** A primeira foto do carrossel: recortar na proporção dela, e não ajustar ao formato. */
  readonly target?: { readonly width: number; readonly height: number } | undefined;
  readonly onOpenChange: (open: boolean) => void;
  /** A imagem ajustada, pronta para entrar na postagem. */
  readonly onDone: (media: MediaSummary) => void;
}): ReactNode {
  /*
   * O envio mora aqui, e não no conteúdo, porque é ele que tranca o fechamento:
   * a folha precisa saber que há bytes subindo mesmo enquanto decide se fecha.
   */
  const [envio, setEnvio] = useState<UploadStep | null>(null);
  const ocupado = envio !== null;

  return (
    <Sheet
      open={media !== null}
      // Fechar no meio do envio deixaria no acervo uma imagem que ninguém pediu
      // e ninguém vê.
      onOpenChange={(proximo) => {
        if (!proximo && ocupado) return;
        onOpenChange(proximo);
      }}
    >
      {/* As mesmas classes do seletor: folha embaixo no celular, caixa centrada
          no computador. Ver `media-picker.tsx` para o porquê de cada uma. */}
      <SheetContent
        side="bottom"
        className={cn(
          "max-h-[85dvh] overflow-y-auto rounded-t-2xl",
          "md:top-1/2 md:right-auto md:bottom-auto md:left-1/2 md:w-full md:max-w-lg",
          "md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border",
        )}
      >
        <SheetHeader>
          <SheetTitle className="font-heading">Ajustar imagem</SheetTitle>
        </SheetHeader>

        {/*
          ⚠️ **O conteúdo nasce e morre com a imagem**, e é o que dispensa zerar
          estado a cada abertura: a imagem carregada e o erro da anterior somem
          com o desmonte. O `key` é a rede de segurança para o dia em que uma
          segunda imagem chegar sem a folha ter fechado.
        */}
        {media !== null && (
          <Ajuste
            key={media.id}
            media={media}
            spec={IMAGE_SPECS[format]}
            target={target}
            envio={envio}
            onEnvio={setEnvio}
            onClose={() => onOpenChange(false)}
            onDone={onDone}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function Ajuste({
  media,
  spec,
  target,
  envio,
  onEnvio,
  onClose,
  onDone,
}: {
  readonly media: MediaSummary;
  readonly spec: ImageSpec;
  readonly target: { readonly width: number; readonly height: number } | undefined;
  readonly envio: UploadStep | null;
  readonly onEnvio: (passo: UploadStep | null) => void;
  readonly onClose: () => void;
  readonly onDone: (media: MediaSummary) => void;
}): ReactNode {
  const [imagem, setImagem] = useState<LoadedImage | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const ocupado = envio !== null;

  /*
   * Os pixels vêm do armazenamento, não do `<img>` da grade: aquele está
   * recortado em quadrado por CSS, e o canvas precisa da imagem inteira.
   *
   * ⚠️ **A guarda `vivo` não é zelo vazio.** Fechar a folha no meio do download
   * de 8 MB desmonta este componente, e gravar o resultado depois disso é o
   * aviso do React que ninguém lê até virar defeito.
   */
  useEffect(() => {
    let vivo = true;

    loadImageFromUrl(media.url).then(
      (carregada) => {
        if (vivo) setImagem(carregada);
      },
      () => {
        if (vivo) setErro("Não consegui abrir esta imagem para ajustar. Tente de novo.");
      },
    );

    return () => {
      vivo = false;
    };
  }, [media.url]);

  const ratio =
    imagem === null
      ? null
      : target !== undefined
        ? // Já na proporção da primeira, não há o que recortar — a mesma saída de "já serve".
          letterboxedInCarousel(target, imagem)
          ? target.width / target.height
          : null
        : targetRatioFor(imagem.width, imagem.height, spec);

  async function ajustarEEnviar(escolha: AdjustChoice): Promise<void> {
    if (imagem === null || ratio === null) return;
    setErro(null);

    let arquivo: File;
    try {
      const moldura = escolha.mode === "fit" ? fitFrame(imagem.width, imagem.height, spec) : null;
      const blob =
        moldura === null
          ? await cropToJpeg(imagem, ratio, escolha.mode === "crop" ? escolha.position : 0.5)
          : await fitToJpeg(imagem, moldura);
      arquivo = blobToFile(blob, "ajuste.jpg");
    } catch {
      setErro("Não consegui ajustar a imagem. Tente outra.");
      return;
    }

    onEnvio({ fase: "enviando", porcento: 0 });
    // `media.id` é a origem: é o que faz a ajustada nascer marcada como
    // derivada, na mesma gravação, e por isso não aparecer no acervo.
    const resultado = await uploadImage(arquivo, onEnvio, media.id);
    onEnvio(null);

    if (!resultado.ok) {
      setErro(resultado.message);
      return;
    }

    onDone(resultado.media);
    onClose();
  }

  return (
    <div className="flex flex-col gap-4 px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] md:pb-6">
      {imagem !== null && ratio !== null && (
        <ImageAdjust
          image={imagem}
          ratio={ratio}
          spec={spec}
          toFirstPhoto={target !== undefined}
          busy={ocupado}
          onConfirm={(escolha) => void ajustarEEnviar(escolha)}
          onCancel={onClose}
        />
      )}

      {imagem === null && erro === null && (
        <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden />
          Abrindo a imagem…
        </p>
      )}

      {/*
        Chegar aqui com uma imagem que já cabe é caminho fechado — o seletor só
        oferece o ajuste às que não servem. Mas a tela precisa dizer alguma coisa
        se acontecer, em vez de ficar em branco.
      */}
      {imagem !== null && ratio === null && (
        <p className="text-sm text-muted-foreground">
          {target !== undefined
            ? "Esta imagem já tem o formato da foto 1. Feche e siga."
            : `Esta imagem já serve para ${spec.label}. Feche e escolha-a direto.`}
        </p>
      )}

      {envio !== null && (
        <Progress
          value={envio.fase === "enviando" ? envio.porcento : 100}
          aria-label={envio.fase === "enviando" ? "Progresso do envio" : "Conferindo o arquivo"}
        />
      )}

      {erro !== null && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      {/* Sem imagem não há os botões do ajuste, e sem esta saída a folha fica
          sem nada além do X do canto. */}
      {(erro !== null || imagem === null) && !ocupado && (
        <Button type="button" variant="outline" className="h-11 md:h-10" onClick={onClose}>
          Fechar
        </Button>
      )}
    </div>
  );
}
