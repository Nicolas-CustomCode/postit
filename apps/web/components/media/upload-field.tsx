"use client";

import { ImageUp, Loader2 } from "lucide-react";
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import {
  fitFrame,
  formatsFor,
  imageUploadPreProblem,
  targetRatioFor,
  IMAGE_SPECS,
  megabytes,
  type ImageFormat,
  type ImageKind,
  type ImageSpec,
  type MediaSummary,
  type MediaPreProblem,
  type NormalizeProblem,
} from "@repo/shared";
import { ImageAdjust, type AdjustChoice } from "@/components/media/image-adjust";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { blobToFile, cropToJpeg, fitToJpeg, type LoadedImage } from "@/lib/media/crop-image";
import { normalizeImage, NORMALIZE_ACCEPT, type NormalizeNotice } from "@/lib/media/normalize-image";
import { uploadImage } from "@/lib/media/upload";

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
 * ⚠️ **Na composição é diferente, e o `mode` é o que diz isso.** Ali o formato
 * de destino já existe, e "enviar como está" seria um beco: o arquivo entraria
 * no acervo e a API recusaria anexá-lo em seguida. Com formato, as saídas são
 * recortar ou escolher outra imagem.
 *
 * ⚠️ **`XMLHttpRequest`, e não `fetch`.** O `fetch` não relata progresso de
 * envio: ele só avisa quando termina, e a barra saltaria de 0 a 100. O RF-B01
 * pede progresso real, que só o `upload.onprogress` do XHR dá.
 *
 * ⚠️ **Não dá para usar um `<form action="…">` apontando para o armazenamento**:
 * a CSP tem `form-action 'self'` e o navegador bloquearia o envio (ADR 0014).
 */
/**
 * O arquivo já normalizado fica guardado: "enviar como está" manda ele, sem
 * recorte. É o original quando ele já era JPEG de até 8 MB; senão, a conversão,
 * e o `aviso` diz o que mudou (RF-B06).
 */
type Escolhida = { file: File; imagem: LoadedImage; aviso: NormalizeNotice | null };

type Estado =
  | { fase: "parado" }
  /** `ratioAlvo: null` significa "já cabe": a tela só pede confirmação. */
  | { fase: "decidindo"; escolhida: Escolhida; ratioAlvo: number | null }
  | { fase: "ajustando"; escolhida: Escolhida; ratio: number }
  | { fase: "enviando"; porcento: number }
  | { fase: "conferindo" }
  | { fase: "pronto"; midia: MediaSummary };

/**
 * `"library"` é o Acervo: qualquer proporção serve, porque o formato ainda não
 * foi escolhido. Com um formato, é a composição, e a imagem precisa servir a ele.
 */
export type UploadMode = "library" | { readonly format: ImageFormat };

/** O que a composição chama quando alguém escolhe "Enviar nova" no menu. */
export interface UploadHandle {
  /** Abre o seletor de arquivos do sistema. Não faz nada durante um envio. */
  abrir(): void;
}

export function UploadField({
  mode = "library",
  label,
  icon: Icone = ImageUp,
  onUploaded,
  withTrigger = true,
  ref,
}: {
  readonly mode?: UploadMode;
  /** O rótulo do botão parado. Na composição vira "Trocar imagem". */
  readonly label?: string;
  readonly icon?: typeof ImageUp;
  readonly onUploaded?: (media: MediaSummary) => void;
  /**
   * `false` na composição: quem abre o seletor é o menu do quadrado de
   * adicionar, e um segundo botão ali seria o que esta mudança veio tirar.
   */
  readonly withTrigger?: boolean;
  readonly ref?: Ref<UploadHandle>;
}): ReactNode {
  const [estado, setEstado] = useState<Estado>({ fase: "parado" });
  const [erro, setErro] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const ocupado = estado.fase === "enviando" || estado.fase === "conferindo";

  /*
   * O React 19 entrega `ref` como prop comum; não há `forwardRef`. A guarda do
   * `ocupado` mora aqui e não no chamador porque só este componente sabe que há
   * um envio em voo — sem ela, dois cliques no menu começariam dois envios e o
   * segundo acrescentaria uma imagem que ninguém escolheu.
   */
  useImperativeHandle(
    ref,
    () => ({
      abrir: () => {
        if (!ocupado) input.current?.click();
      },
    }),
    [ocupado],
  );
  // No acervo, o feed é o formato exigente e serve de referência para a oferta
  // de recorte. Na composição, quem manda é o formato de destino.
  const alvo = mode === "library" ? IMAGE_SPECS.FEED : IMAGE_SPECS[mode.format];

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
     *
     * E é aqui que PNG, WebP e JPEG pesado viram o JPEG que a Meta aceita
     * (RF-B06): daqui em diante, prévia, proporção e ajuste usam o convertido.
     */
    /*
     * ⚠️ **Uma cópia em memória, antes de tudo.** No Android, o arquivo escolhido
     * da galeria é uma referência que o sistema pode revogar a qualquer momento —
     * foto que só existe na nuvem, ou permissão que expira —, e qualquer leitura
     * depois disso dá `NotReadableError`. Foi o que aconteceu em 24/09/2026, e o
     * erro escapava sem mensagem. Copiado aqui, logo depois da escolha, nem a
     * conversão nem o envio dependem mais da referência.
     */
    let copia: File;
    try {
      copia = new File([await file.arrayBuffer()], file.name, { type: file.type, lastModified: file.lastModified });
    } catch {
      setErro(
        "Não consegui abrir este arquivo. Se a foto estiver só na nuvem, baixe-a para o aparelho e tente de novo.",
      );
      setEstado({ fase: "parado" });
      return;
    }

    const normalizada = await normalizeImage(copia);
    if (!normalizada.ok) {
      setErro(mensagemDaConversao(normalizada.problem));
      setEstado({ fase: "parado" });
      return;
    }
    const imagem = normalizada.image;

    /*
     * **Nada sobe sem a pessoa ver.** Até 21/09/2026, a imagem que já cabia ia
     * direto para o armazenamento: clicava-se e 8 MB partiam sem nenhuma tela.
     * Agora a confirmação é sempre a mesma, e o que muda é a oferta — `ratioAlvo`
     * diz se vale falar de recorte ou se basta confirmar.
     */
    const ratioAlvo = targetRatioFor(imagem.width, imagem.height, alvo);
    setEstado({
      fase: "decidindo",
      escolhida: { file: normalizada.file, imagem, aviso: normalizada.notice },
      ratioAlvo,
    });
  }

  /** Aplica o ajuste escolhido e envia o resultado, nunca o original. */
  async function enviarAjuste(escolha: AdjustChoice): Promise<void> {
    if (estado.fase !== "ajustando") return;
    setErro(null);

    try {
      const { imagem, file } = estado.escolhida;
      const moldura = escolha.mode === "fit" ? fitFrame(imagem.width, imagem.height, alvo) : null;

      const blob =
        moldura === null
          ? await cropToJpeg(imagem, estado.ratio, escolha.mode === "crop" ? escolha.position : 0.5)
          : await fitToJpeg(imagem, moldura);

      await enviar(blobToFile(blob, file.name));
    } catch {
      setErro("Não consegui ajustar a imagem. Tente outra.");
      setEstado({ fase: "parado" });
    }
  }

  async function enviar(file: File): Promise<void> {
    // Os três passos moram em `lib/media/upload.ts` desde que ganharam um
    // segundo chamador: o ajuste de imagem que já está no acervo.
    const resultado = await uploadImage(file, (passo) => setEstado(passo));

    if (!resultado.ok) {
      setErro(resultado.message);
      setEstado({ fase: "parado" });
      return;
    }

    setEstado({ fase: "pronto", midia: resultado.media });
    onUploaded?.(resultado.media);
  }

  /*
   * ⚠️ **Um fragmento, e não um `<div>`.** Na composição este componente fica
   * montado o tempo todo, e parado ele não desenha nada: um embrulho seria uma
   * caixa de altura zero numa coluna com `gap`, e o `gap` conta caixas, não
   * pixels — 12 px de vazio no rodapé da seção. Os dois chamadores já o põem
   * numa coluna flex, que é de onde vem o espaçamento entre estas partes.
   */
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={NORMALIZE_ACCEPT}
        className="sr-only"
        disabled={ocupado}
        onChange={(evento) => {
          const campo = evento.target;
          const file = campo.files?.[0];
          // Limpa o valor para escolher o mesmo arquivo duas vezes disparar de novo —
          // só **depois** de ler: em alguns Android, limpar antes invalida o arquivo.
          if (file === undefined) campo.value = "";
          else
            void escolher(file).finally(() => {
              campo.value = "";
            });
        }}
      />

      {estado.fase === "decidindo" && (
        <ImageConfirm
          image={estado.escolhida.imagem}
          file={estado.escolhida.file}
          notice={estado.escolhida.aviso}
          spec={alvo}
          ratioAlvo={estado.ratioAlvo}
          /*
           * Mandar o arquivo como ele é. É a mesma ação nos dois ramos — só o
           * rótulo muda, porque "usar" e "enviar como está" respondem a
           * perguntas diferentes.
           *
           * Ausente num caso só: não cabe **e** há formato de destino. Ali
           * enviar seria um beco — o arquivo entraria no acervo e a API
           * recusaria anexá-lo em seguida.
           */
          onSend={
            estado.ratioAlvo === null || mode === "library"
              ? () => void enviar(estado.escolhida.file)
              : undefined
          }
          onCrop={(ratio) => setEstado({ fase: "ajustando", escolhida: estado.escolhida, ratio })}
          onChooseAnother={() => {
            setEstado({ fase: "parado" });
            input.current?.click();
          }}
        />
      )}

      {estado.fase === "ajustando" && (
        <ImageAdjust
          image={estado.escolhida.imagem}
          ratio={estado.ratio}
          spec={alvo}
          busy={false}
          onConfirm={(escolha) => void enviarAjuste(escolha)}
          onCancel={() =>
            setEstado({
              fase: "decidindo",
              escolhida: estado.escolhida,
              ratioAlvo: estado.ratio,
            })
          }
        />
      )}

      {/* Enquanto se decide ou se ajusta, os botões que valem são os de lá. */}
      {withTrigger && estado.fase !== "decidindo" && estado.fase !== "ajustando" && (
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
            <Icone className="size-4" aria-hidden />
          )}
          {rotulo(estado, label)}
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
    </>
  );
}

/**
 * A imagem escolhida, antes de qualquer byte subir (RF-B01, RF-B03).
 *
 * ⚠️ **Uma tela só, para as duas perguntas.** "É esta a imagem?" e "o que faço
 * com uma imagem que não cabe?" são a mesma pergunta feita na mesma hora, e
 * separá-las daria dois passos seguidos a quem já está no caminho mais chato.
 * O que muda entre os casos são os botões, não a tela.
 *
 * ⚠️ **A imagem aparece, e é o ponto.** Antes daqui, o ramo "não cabe" dizia
 * "esta imagem é 1512 × 2016 pixels" sem mostrar nada — obrigava a confiar na
 * memória justamente quando o assunto é a aparência.
 *
 * ⚠️ **Recortar continua sendo oferta, nunca imposição** (AGENTS.md, regra 10).
 * Uma arte 9:16 está certa como está; recortá-la destruiria o formato
 * pretendido. Ver a imagem antes de decidir é o oposto de impor.
 */
function ImageConfirm({
  image,
  file,
  notice,
  spec,
  ratioAlvo,
  onSend,
  onCrop,
  onChooseAnother,
}: {
  readonly image: LoadedImage;
  /** A prévia sai do arquivo que vai subir, não do bitmap já decodificado. */
  readonly file: File;
  /** O que a conversão mudou no arquivo escolhido, ou `null` quando nada. */
  readonly notice: NormalizeNotice | null;
  readonly spec: ImageSpec;
  /** `null` quando a imagem já cabe: aí não há recorte a oferecer. */
  readonly ratioAlvo: number | null;
  /** Ausente só quando não cabe e há formato de destino — ali seria um beco. */
  readonly onSend?: (() => void) | undefined;
  readonly onCrop: (ratio: number) => void;
  /** Sem esta saída, quem escolheu o arquivo errado ficaria preso aqui. */
  readonly onChooseAnother: () => void;
}): ReactNode {
  const cabe = ratioAlvo === null;
  const servePara = formatsFor(image.width, image.height);

  /*
   * ⚠️ O endereço precisa ser devolvido. Sem o `revoke`, o arquivo fica preso à
   * vida da página inteira: quem experimenta cinco fotos segura cinco arquivos
   * de 8 MB na memória.
   *
   * ⚠️ **Criar e devolver no mesmo efeito, e entregar pelo `ref`.** Até
   * 23/09/2026 o endereço vinha de um `useMemo` e só a devolução ficava no
   * efeito. O `StrictMode` do desenvolvimento monta, desmonta e remonta os
   * efeitos: a desmontagem devolvia o endereço, e a remontagem reaproveitava o
   * mesmo `useMemo` — a prévia apontava para um endereço morto e aparecia vazia,
   * às vezes, conforme o navegador lia antes ou depois. Aqui cada montagem cria o
   * seu. O `ref`, e não estado, porque `setState` no corpo do efeito é o que o lint
   * do projeto recusa.
   */
  const preview = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const src = URL.createObjectURL(file);
    if (preview.current !== null) preview.current.src = src;
    return () => URL.revokeObjectURL(src);
  }, [file]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      {/*
        `object-contain`, nunca `object-cover`: no ramo "não serve" o assunto
        **é** a proporção, e recortar a prévia esconderia o que a tela explica.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={preview}
        alt="Prévia da imagem escolhida"
        width={image.width}
        height={image.height}
        className="max-h-64 w-full rounded-lg bg-muted object-contain md:max-h-80"
      />

      <div>
        <p className="text-sm font-medium">
          Esta imagem é {image.width} × {image.height} pixels
        </p>
        {/* Nada muda sem a pessoa saber: o arquivo que sobe não é o escolhido. */}
        {notice !== null && <p className="text-sm text-muted-foreground">{textoDoAviso(notice)}</p>}
        {/*
          A frase evita preposição antes do nome do formato: "não cabe em Feed"
          sai torto, e "no Feed" quebraria em "no Stories".
        */}
        <p className="text-sm text-muted-foreground">
          {cabe ? (
            <>Serve para {spec.label}</>
          ) : (
            <>
              Não serve para {spec.label}, que aceita de {spec.ratioLabel}
              {/* O que ela serve só interessa onde dá para usá-la assim: na
                  composição o formato já está escolhido. */}
              {onSend === undefined ? "" : sufixoDeFormatos(servePara)}
            </>
          )}
          .
        </p>
      </div>

      <div className="flex flex-col gap-2 md:flex-row">
        {onSend !== undefined && (
          <Button type="button" className="h-11 md:h-10" onClick={onSend}>
            {cabe ? "Usar esta imagem" : "Enviar como está"}
          </Button>
        )}
        {ratioAlvo !== null && (
          <Button
            type="button"
            variant={onSend === undefined ? "default" : "outline"}
            className="h-11 md:h-10"
            onClick={() => onCrop(ratioAlvo)}
          >
            Ajustar para {spec.label}
          </Button>
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        className="h-11 self-start px-0 text-muted-foreground md:h-10"
        onClick={onChooseAnother}
      >
        Escolher outra
      </Button>
    </div>
  );
}

/** " — serve para Stories", ou nada quando não há formato a citar. */
function sufixoDeFormatos(formatos: readonly ImageFormat[]): string {
  if (formatos.length === 0) return "";
  return ` — serve para ${formatos.map((formato) => IMAGE_SPECS[formato].label).join(", ")}`;
}

function rotulo(estado: Estado, label?: string): string {
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
      return label ?? "Escolher imagem";
  }
}

/** O que a tela mesma detectou, antes de abrir o arquivo. */
function mensagemLocal(problema: MediaPreProblem, bytes: number): string {
  switch (problema) {
    case "EMPTY":
      return "Este arquivo está vazio.";
    case "TOO_LARGE":
      return `Este arquivo tem ${megabytes(bytes)} MB — grande demais para abrir aqui. O limite é 50 MB.`;
  }
}

/** O que não deu para converter em JPEG (RF-B06). */
function mensagemDaConversao(problema: NormalizeProblem): string {
  switch (problema) {
    case "UNREADABLE":
      return "Não consegui ler esta imagem. O arquivo pode estar corrompido.";
    case "HEIC":
      return "O navegador não lê HEIC. No iPhone, escolha a foto pela galeria — ela já chega em JPEG; no computador, exporte como JPEG.";
    case "GIF":
      return "GIF não serve: o Instagram publicaria só o primeiro quadro, sem a animação. Envie JPEG, PNG ou WebP.";
    case "TOO_BIG_TO_CONVERT":
      return "Esta imagem passa de 50 megapixels — grande demais para converter aqui. Reduza e tente de novo.";
  }
}

const NOME_DO_TIPO: Record<ImageKind, string> = {
  jpeg: "JPEG",
  png: "PNG",
  webp: "WebP",
  avif: "AVIF",
  heic: "HEIC",
  gif: "GIF",
};

/**
 * "Convertida de PNG para JPEG e reduzida de 5000 × 400 para 2160 × 173 — …".
 * Uma frase só, porque as duas mudanças respondem à mesma pergunta: por que o
 * arquivo que sobe não é o que escolhi?
 */
function textoDoAviso(aviso: NormalizeNotice): string {
  const { original, final } = aviso;
  const mudouDeTamanho = original.width !== final.width || original.height !== final.height;
  const partes: string[] = [];

  if (aviso.reasons.includes("CONVERTED")) partes.push(`convertida de ${NOME_DO_TIPO[aviso.from]} para JPEG`);
  if (aviso.reasons.includes("REDUCED")) {
    partes.push(
      mudouDeTamanho
        ? `reduzida de ${original.width} × ${original.height} para ${final.width} × ${final.height}`
        : "recomprimida",
    );
  }

  const frase = partes.join(" e ");
  return `${frase.charAt(0).toUpperCase()}${frase.slice(1)} — o Instagram só aceita JPEG de até 8 MB.`;
}

