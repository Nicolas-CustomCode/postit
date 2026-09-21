"use client";

import { ImageUp, Loader2 } from "lucide-react";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import {
  formatsFor,
  imageUploadPreProblem,
  targetRatioFor,
  IMAGE_SPECS,
  IMAGE_UPLOAD_SPEC,
  megabytes,
  type ImageFormat,
  type ImageSpec,
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
/** O arquivo original fica guardado: "enviar como está" manda ele, sem recorte. */
type Escolhida = { file: File; imagem: LoadedImage };

type Estado =
  | { fase: "parado" }
  /** `ratioAlvo: null` significa "já cabe": a tela só pede confirmação. */
  | { fase: "decidindo"; escolhida: Escolhida; ratioAlvo: number | null }
  | { fase: "recortando"; escolhida: Escolhida; ratio: number }
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
     * **Nada sobe sem a pessoa ver.** Até 21/09/2026, a imagem que já cabia ia
     * direto para o armazenamento: clicava-se e 8 MB partiam sem nenhuma tela.
     * Agora a confirmação é sempre a mesma, e o que muda é a oferta — `ratioAlvo`
     * diz se vale falar de recorte ou se basta confirmar.
     */
    const ratioAlvo = targetRatioFor(imagem.width, imagem.height, alvo);
    setEstado({ fase: "decidindo", escolhida: { file, imagem }, ratioAlvo });
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
        <ImageConfirm
          image={estado.escolhida.imagem}
          file={estado.escolhida.file}
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
          onCrop={(ratio) => setEstado({ fase: "recortando", escolhida: estado.escolhida, ratio })}
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
          spec={alvo}
          busy={false}
          onConfirm={(posicao) => void enviarRecorte(posicao)}
          onCancel={() =>
            setEstado({
              fase: "decidindo",
              escolhida: estado.escolhida,
              ratioAlvo: estado.ratio,
            })
          }
        />
      )}

      {/* Enquanto se decide ou se recorta, os botões que valem são os de lá. */}
      {withTrigger && estado.fase !== "decidindo" && estado.fase !== "recortando" && (
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
  spec,
  ratioAlvo,
  onSend,
  onCrop,
  onChooseAnother,
}: {
  readonly image: LoadedImage;
  /** A prévia sai do arquivo original, não do bitmap já decodificado. */
  readonly file: File;
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
   * de 8 MB na memória. A ida e volta para o recorte desmonta este componente e
   * cria um endereço novo, o que está certo — o anterior já foi devolvido.
   */
  const src = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(src), [src]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      {/*
        `object-contain`, nunca `object-cover`: no ramo "não serve" o assunto
        **é** a proporção, e recortar a prévia esconderia o que a tela explica.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Prévia da imagem escolhida"
        width={image.width}
        height={image.height}
        className="max-h-64 w-full rounded-lg bg-muted object-contain md:max-h-80"
      />

      <div>
        <p className="text-sm font-medium">
          Esta imagem é {image.width} × {image.height} pixels
        </p>
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
            Recortar para {spec.label}
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
