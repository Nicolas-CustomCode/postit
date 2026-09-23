"use client";

import { ArrowRight, Info, Loader2, Send, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import {
  ALT_TEXT_MAX_LENGTH,
  captionCounts,
  CAPTION_MAX_HASHTAGS,
  CAPTION_MAX_LENGTH,
  CAPTION_MAX_MENTIONS,
  COMPOSABLE_FORMATS,
  formatsFor,
  IMAGE_SPECS,
  letterboxedInCarousel,
  POST_FORMAT_LABELS,
  POST_FORMATS,
  POST_MEDIA_COUNT,
  type AccountSummary,
  type ActionConflict,
  type ComposableFormat,
  type MediaSummary,
  type PostDetail,
} from "@repo/shared";
import { MediaAdjustSheet } from "@/components/media/media-adjust-sheet";
import { MediaPicker } from "@/components/media/media-picker";
import { UploadField, type UploadHandle } from "@/components/media/upload-field";
import { LocalDate } from "@/components/local-date";
import { ComposeSection } from "@/components/posts/compose-section";
import { AddMediaTile } from "@/components/posts/add-media-tile";
import { CaptionField } from "@/components/posts/caption-field";
import { FeedPreview } from "@/components/posts/feed-preview";
import { MediaStrip } from "@/components/posts/media-strip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  createPostAction,
  discardPostAction,
  setCaptionAction,
  setPostFormatAction,
  setPostMediaAction,
  submitPostAction,
} from "@/lib/actions/posts";
import { cn } from "@/lib/utils";

/**
 * Compor uma postagem (RF-C01 a RF-C03, RF-C10 a RF-C12; artboard
 * `ComposicaoDesktop`).
 *
 * **A mesma tela serve para criar e para editar.** Com `post` em branco é a
 * "Nova postagem" do artefato — e ela **continua sendo** Nova postagem até
 * alguém salvar. Escolher uma imagem não cria nada: a `Midia` já existe no
 * acervo, e a `Postagem` só nasce no salvamento.
 *
 * **É a etapa 1 · Composição** (ADR 0026): só monta a postagem. O horário não
 * mora aqui — é decisão de quem revisa, na etapa 2. O rodapé leva adiante:
 * "Continuar para revisão" para quem pode aprovar, "Enviar para revisão" para
 * quem só edita; os dois salvam antes e mandam para a revisão.
 *
 * ⚠️ **O conflito de edição não pode custar o texto de ninguém.** Quando a API
 * recusa com `POST_VERSION_CONFLICT`, o que está no campo **continua lá** — a
 * tela mostra quem salvou antes e oferece as duas saídas do RF-C12.
 */
export function ComposeForm({
  username,
  account,
  timeZone,
  media,
  post,
  canApprove,
}: {
  readonly username: string;
  /** A conta, para a prévia mostrar a foto real dela. */
  readonly account: Pick<AccountSummary, "name" | "username" | "photoUrl">;
  /** O fuso da conta: a prévia mostra os horários nele (ADR 0006). */
  readonly timeZone: string;
  /** O acervo, para escolher sem sair da tela (RF-B04). */
  readonly media: readonly MediaSummary[];
  /** Em branco na tela de nova postagem: ela ainda não existe no banco. */
  readonly post: PostDetail | null;
  /**
   * Quem pode aprovar esta postagem "continua" para a revisão, onde vai decidir;
   * quem não pode "envia" para outra pessoa. Só muda o rótulo — a API decide.
   */
  readonly canApprove: boolean;
}): ReactNode {
  const router = useRouter();
  const [caption, setCaption] = useState(post?.caption ?? "");
  const [format, setFormat] = useState<ComposableFormat>(formatoInicial(post));
  const [version, setVersion] = useState(post?.version ?? 0);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [conflito, setConflito] = useState<ActionConflict | null>(null);

  /**
   * As imagens escolhidas — do acervo ou recém-enviadas —, **na ordem**.
   *
   * Ficam em estado local até o salvamento: escolher não cria postagem. Era o
   * defeito que fazia a tela virar "Compor" só por anexar uma foto.
   *
   * ⚠️ **Uma lista, e não uma imagem.** Carrossel não é formato, é quantidade
   * (ADR 0024): duas ou mais no Feed e a Meta monta o carrossel sozinha. A ordem
   * é conteúdo de verdade — a primeira define o quadro de todas.
   */
  const [midias, setMidias] = useState<readonly MediaSummary[]>(midiasIniciais(post, media));
  /**
   * O texto alternativo de cada foto, **na mesma ordem** de `midias` (RF-B05).
   *
   * Paralelo, e não dentro de `MediaSummary`: aquele tipo é o do acervo, e a mesma
   * imagem pode ter um texto em cada postagem. Imagem acrescentada não precisa de
   * entrada aqui — posição sem texto é texto vazio. Só mover e remover mexem nos
   * dois juntos.
   */
  const [alts, setAlts] = useState<readonly string[]>((post?.media ?? []).map((item) => item.altText ?? ""));
  /** O que a última reordenação fez, para quem navega por leitor de tela. */
  const [anuncio, setAnuncio] = useState("");
  const [acervoAberto, setAcervoAberto] = useState(false);
  /**
   * A imagem que não serve ao formato e está sendo ajustada.
   *
   * O `indice` diz de onde ela veio, e é o que decide o destino da ajustada:
   * `null` é do acervo e **acrescenta**; um número é da faixa e **substitui**
   * naquele lugar — quem trocou de formato quer a mesma imagem consertada, na
   * mesma posição, não uma segunda cópia no fim.
   */
  const [ajustando, setAjustando] = useState<{
    media: MediaSummary;
    indice: number | null;
    /** A primeira foto do carrossel, quando o ajuste é tirar as faixas pretas. */
    quadro?: { width: number; height: number };
  } | null>(null);
  /** O seletor de arquivos, aberto pelo item "Enviar nova" do menu. */
  const envio = useRef<UploadHandle>(null);

  const contagem = captionCounts(caption);
  const legendaMudou = caption !== (post?.caption ?? "");
  const formatoMudou = post !== null && format !== post.format;
  /*
   * Posicional, e não por conjunto: a mesma imagem pode aparecer duas vezes de
   * propósito, e trocar a ordem é mudança de conteúdo como qualquer outra.
   */
  const midiaMudou =
    midias.length !== (post?.media.length ?? 0) ||
    midias.some((item, i) => item.id !== post?.media[i]?.mediaId) ||
    // Mudar só o texto de uma foto também é mudança de conteúdo (RF-E05).
    midias.some((_, i) => (alts[i] ?? "") !== (post?.media[i]?.altText ?? ""));
  const temMudanca = post === null || legendaMudou || formatoMudou || midiaMudou;

  const maximo = POST_MEDIA_COUNT[format].max;
  const cheia = midias.length >= maximo;
  /*
   * A metade "a tela avisa" da regra 6: `formatsFor` roda aqui, então dá para
   * apontar **qual** imagem não serve — coisa que o erro da API não carrega.
   */
  const incompativeis = midias.filter((item) => !formatsFor(item.width, item.height).includes(format));
  /*
   * As que vão sair com faixas pretas: no carrossel, o quadro é o da primeira foto e as
   * outras entram inteiras (docs/08, observado em 23/09/2026). Carrossel é Feed com duas
   * ou mais. Não bloqueia nada — é aviso, com o recorte oferecido.
   */
  const quadro = format === "FEED" && midias.length > 1 ? midias[0] : undefined;
  const comFaixas =
    quadro === undefined
      ? []
      : midias.flatMap((item, indice) =>
          indice > 0 && formatsFor(item.width, item.height).includes(format) && letterboxedInCarousel(quadro, item)
            ? [indice + 1]
            : [],
        );

  function moverMidia(de: number, para: number): void {
    setMidias((atual) => mover(atual, de, para));
    // O texto acompanha a foto: ele descreve aquela imagem, não aquela posição.
    setAlts((atual) => mover(completar(atual, midias.length), de, para));
    setAnuncio(`Imagem ${de + 1} movida para a posição ${para + 1}.`);
  }

  function removerMidia(indice: number): void {
    setMidias((atual) => atual.filter((_, i) => i !== indice));
    setAlts((atual) => atual.filter((_, i) => i !== indice));
    setAnuncio(`Imagem ${indice + 1} removida.`);
  }

  /** Executa uma escrita e devolve a versão nova, ou `null` se falhou. */
  async function escrever(
    acao: (versaoAtual: number) => Promise<Awaited<ReturnType<typeof setCaptionAction>>>,
    versaoAtual: number,
  ): Promise<number | null> {
    setErro(null);
    setConflito(null);

    const resultado = await acao(versaoAtual);

    if (resultado.ok) {
      setVersion(resultado.data.version);
      return resultado.data.version;
    }

    if (resultado.code === "POST_VERSION_CONFLICT" && resultado.conflict !== undefined) {
      setConflito(resultado.conflict);
    } else {
      setErro(resultado.message);
    }
    return null;
  }

  async function comBloqueio(trabalho: () => Promise<void>): Promise<void> {
    setOcupado(true);
    try {
      await trabalho();
    } finally {
      setOcupado(false);
    }
  }

  /**
   * Salva tudo que mudou, em ordem, e só então a postagem existe.
   *
   * Na tela nova, o `create` já leva formato e legenda — uma escrita, não três.
   * A imagem vem depois, porque a rota de mídia valida contra o formato que
   * acabou de ser gravado.
   *
   * Devolve a postagem e a versão em que ficou: enviar para revisão logo depois
   * precisa da versão **nova**, e o estado do React só a teria no próximo render.
   */
  async function salvar(): Promise<{ id: string; version: number } | null> {
    if (post === null) {
      const criada = await createPostAction(username, {
        format,
        caption: caption === "" ? null : caption,
      });
      if (!criada.ok) {
        setErro(criada.message);
        return null;
      }

      let v = 1;
      setVersion(v);

      if (midias.length > 0) {
        const comMidia = await escrever(
          (atual) => setPostMediaAction(username, criada.data.id, { version: atual, media: paraEnvio(midias, alts) }),
          v,
        );
        if (comMidia === null) return null;
        v = comMidia;
      }

      return { id: criada.data.id, version: v };
    }

    let v = version;

    if (formatoMudou) {
      const depois = await escrever((atual) => setPostFormatAction(username, post.id, { version: atual, format }), v);
      if (depois === null) return null;
      v = depois;
    }

    if (legendaMudou) {
      const depois = await escrever(
        (atual) => setCaptionAction(username, post.id, { version: atual, caption: caption === "" ? null : caption }),
        v,
      );
      if (depois === null) return null;
      v = depois;
    }

    /*
     * Sem `&& midias.length > 0`: tirar todas as imagens é uma mudança como
     * outra qualquer, e a lista vazia é o que a comunica. Com a guarda, quem
     * removesse tudo veria "salvo" sem nada ter sido salvo.
     */
    if (midiaMudou) {
      const depois = await escrever(
        (atual) => setPostMediaAction(username, post.id, { version: atual, media: paraEnvio(midias, alts) }),
        v,
      );
      if (depois === null) return null;
      v = depois;
    }

    return { id: post.id, version: v };
  }

  /**
   * Salva e manda para a revisão (RF-E01). Na tela nova a postagem nasce aqui e já
   * sai em revisão; o endereço passa a ser o dela, que abre na etapa 2.
   */
  async function enviarParaRevisao(): Promise<void> {
    const salvo = await salvar();
    if (salvo === null) return;

    const enviada = await escrever((v) => submitPostAction(username, salvo.id, { version: v }), salvo.version);
    if (post === null) router.replace(`/c/${username}/postagens/${salvo.id}`);
    else if (enviada !== null) router.refresh();
  }

  const reprovacao = post?.lastDecision?.action === "REJECTED" ? post.lastDecision : null;

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-7">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        {/* Voltou da revisão: o motivo no topo, que é o que a pessoa veio corrigir (RF-E03). */}
        {reprovacao !== null && (
          <div
            role="status"
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-2xl bg-[var(--status-falhou-bg)] px-4 py-3.5 text-[var(--status-falhou)]"
          >
            <X className="mt-0.5 size-4.5" aria-hidden />
            <p className="text-sm font-bold">
              Reprovada por {reprovacao.byName} · <LocalDate iso={reprovacao.at} format="comHora" />
            </p>
            <p className="col-start-2 text-sm break-words whitespace-pre-wrap text-foreground">
              “{reprovacao.reason}” Ajuste e envie de novo — a conversa da revisão continua lá.
            </p>
          </div>
        )}

        {conflito !== null && (
          <Alert role="alert">
            <AlertDescription className="flex flex-col gap-3">
              <span>
                Esta postagem foi alterada por {conflito.updatedByName ?? "outra pessoa"}. O que você
                escreveu continua aqui.
              </span>
              <span className="flex flex-col gap-2 md:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 md:h-10"
                  onClick={() => {
                    setVersion(conflito.version);
                    setConflito(null);
                    router.refresh();
                  }}
                >
                  Manter meu texto e tentar de novo
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 md:h-10"
                  /*
                   * Recarga de verdade: o texto certo é o que está no servidor
                   * agora, e o campo já está em estado local — não voltaria
                   * sozinho com um `router.refresh()`.
                   */
                  onClick={() => window.location.reload()}
                >
                  Descartar minhas alterações
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        )}

        <ComposeSection title="Formato">
          <div className="flex flex-wrap gap-2">
            {POST_FORMATS.map((opcao) => {
              const componivel = (COMPOSABLE_FORMATS as readonly string[]).includes(opcao);
              const ativo = componivel && opcao === format;

              return (
                <button
                  key={opcao}
                  type="button"
                  disabled={!componivel || ocupado}
                  onClick={() => {
                    // A API recusa de qualquer jeito (regra 17): isto evita a
                    // ida e volta, e diz quantas imagens sobram.
                    const cabe = POST_MEDIA_COUNT[opcao].max;
                    if (midias.length > cabe) {
                      setErro(
                        `${POST_FORMAT_LABELS[opcao]} aceita ${cabe === 1 ? "uma mídia só" : `até ${cabe} mídias`}. ` +
                          `Remova ${midias.length - cabe} antes de mudar o formato.`,
                      );
                      return;
                    }
                    setErro(null);
                    setFormat(opcao as ComposableFormat);
                  }}
                  className={cn(
                    "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
                    ativo ? "border-primary bg-accent text-accent-foreground" : "bg-muted",
                    !componivel && "cursor-not-allowed opacity-50",
                  )}
                >
                  {POST_FORMAT_LABELS[opcao]}
                  {/* Os que ainda não dá para compor dizem quando chegam, em vez
                      de sumirem: saber que existem é informação útil. */}
                  {!componivel && <span className="text-[11px] font-medium">Fase 2</span>}
                </button>
              );
            })}
          </div>

          {/* RF-C11: o aviso precisa estar na composição, não escondido na ajuda. */}
          {format === "STORIES" && (
            <p className="flex items-start gap-2 rounded-[10px] bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
              Figurinhas, enquetes, links e música não são publicáveis pela API oficial do Instagram — só a
              imagem e a menção sem figurinha.
            </p>
          )}
        </ComposeSection>

        <ComposeSection
          title="Mídia"
          aside={
            <span className="text-[13px] text-muted-foreground">
              {midias.length} de {maximo} ·{" "}
              {IMAGE_SPECS[format].ratioLabel === null
                ? "JPEG até 8 MB, qualquer proporção"
                : `JPEG até 8 MB, proporção de ${IMAGE_SPECS[format].ratioLabel}`}
            </span>
          }
        >
          <div className="flex flex-col gap-3">
            {/* A faixa é também onde se acrescenta: o quadrado a fecha, no lugar
                que a próxima imagem vai ocupar. */}
            <MediaStrip
              midias={midias}
              format={format}
              disabled={ocupado}
              onMover={moverMidia}
              onRemover={removerMidia}
              onAjustar={(indice) => {
                const alvo = midias[indice];
                if (alvo !== undefined) setAjustando({ media: alvo, indice });
              }}
              {...(quadro === undefined
                ? {}
                : {
                    onAjustarAoQuadro: (indice: number) => {
                      const alvo = midias[indice];
                      if (alvo !== undefined) {
                        setAjustando({ media: alvo, indice, quadro: { width: quadro.width, height: quadro.height } });
                      }
                    },
                  })}
              acrescentar={
                cheia ? undefined : (
                  <AddMediaTile
                    disabled={ocupado}
                    onPickLibrary={() => setAcervoAberto(true)}
                    onPickNew={() => envio.current?.abrir()}
                  />
                )
              }
            />

            {/* O aviso da reordenação, só para quem usa leitor de tela: a faixa
                já mostra a ordem nova para quem enxerga. */}
            <p aria-live="polite" className="sr-only">
              {anuncio}
            </p>

            {cheia && (
              <p className="text-[13px] text-muted-foreground">
                {maximo === 1
                  ? `${POST_FORMAT_LABELS[format]} aceita uma mídia só.`
                  : "Você já tem 10 — o máximo que o Instagram aceita numa postagem."}
              </p>
            )}

            {/* As duas portas, abertas pelo menu do quadrado. */}
            <MediaPicker
              media={media}
              format={format}
              remaining={maximo - midias.length}
              open={acervoAberto}
              onOpenChange={setAcervoAberto}
              onConfirm={(escolhidas) => setMidias((atual) => [...atual, ...escolhidas])}
              onAdjust={(incompativel) => setAjustando({ media: incompativel, indice: null })}
            />

            {/*
              ⚠️ **Irmã do seletor, nunca filha** — duas folhas aninhadas do
              Radix brigam pelo foco. Fora do ramo do `cheia` pela mesma razão do
              `UploadField`: em Stories o sucesso tornaria `cheia` verdadeiro e
              arrancaria a folha no meio do próprio desmonte.
            */}
            <MediaAdjustSheet
              media={ajustando?.media ?? null}
              format={format}
              target={ajustando?.quadro}
              onOpenChange={(aberta) => {
                if (!aberta) setAjustando(null);
              }}
              /*
               * Sem `router.refresh()`, ao contrário do envio: a ajustada nasce
               * derivada e **não entra na lista do acervo**, então não há nada
               * novo para o servidor mandar.
               */
              onDone={(ajustada) => {
                const alvo = ajustando?.indice ?? null;
                setMidias((atual) =>
                  alvo === null
                    ? [...atual, ajustada]
                    : atual.map((item, indice) => (indice === alvo ? ajustada : item)),
                );
              }}
            />

            {/*
              ⚠️ **Fora do ramo do `cheia`, de propósito.** Em Stories o máximo é
              uma: o sucesso do envio tornaria `cheia` verdadeiro no mesmo passo
              e arrancaria este componente — junto com a confirmação, a barra de
              progresso e qualquer alerta pendente.
            */}
            <UploadField
              mode={{ format }}
              withTrigger={false}
              ref={envio}
              onUploaded={(enviada) => {
                // Acrescenta: a postagem nasce no salvamento, e a imagem já
                // está no acervo de qualquer forma.
                setMidias((atual) => [...atual, enviada]);
                router.refresh();
              }}
            />

            {incompativeis.length > 0 && (
              <p className="text-[13px] text-destructive">
                {incompativeis.length === 1
                  ? "Uma das imagens não serve para "
                  : `${incompativeis.length} imagens não servem para `}
                {/* A tarja vermelha de cada uma é o botão que resolve: a frase
                    manda para lá em vez de oferecer só as saídas antigas. */}
                {POST_FORMAT_LABELS[format]}. Toque na tarja para ajustar, ou remova.
              </p>
            )}

            {comFaixas.length > 0 && (
              <p className="text-[13px] text-warning">
                {comFaixas.length === 1
                  ? `A foto ${comFaixas[0]} vai sair com faixas pretas nas bordas`
                  : `As fotos ${comFaixas.slice(0, -1).join(", ")} e ${comFaixas.at(-1)} vão sair com faixas pretas nas bordas`}
                : o carrossel usa o formato da primeira. Toque na tarja para recortar, ou mude a ordem.
              </p>
            )}
          </div>
        </ComposeSection>

        <ComposeSection title="Legenda">
          <label htmlFor="legenda" className="sr-only">
            Legenda
          </label>
          <CaptionField id="legenda" value={caption} disabled={ocupado} onChange={setCaption} />

          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground tabular-nums">
            <Contador atual={contagem.length} limite={CAPTION_MAX_LENGTH} nome="caracteres" />
            <Contador atual={contagem.hashtags} limite={CAPTION_MAX_HASHTAGS} nome="hashtags" />
            <Contador atual={contagem.mentions} limite={CAPTION_MAX_MENTIONS} nome="menções" />
          </p>
        </ComposeSection>

        {/*
          RF-B05: um texto por foto — num carrossel, cada imagem tem o seu (docs/07).
          Some em Stories, que a Meta não aceita com texto alternativo (docs/08); o
          que foi digitado continua guardado se o formato voltar.
        */}
        {format !== "STORIES" && midias.length > 0 && (
          <ComposeSection
            title="Texto alternativo"
            aside={<span className="text-[13px] text-muted-foreground">Descreve a foto para quem usa leitor de tela</span>}
          >
            <ol className="flex flex-col gap-4">
              {midias.map((item, indice) => (
                <li key={indice} className="flex items-start gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.url}
                    alt=""
                    width={item.width}
                    height={item.height}
                    className="size-16 shrink-0 rounded-xl object-cover"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <label htmlFor={`alt-${indice}`} className="text-sm font-semibold">
                      Foto {indice + 1}
                    </label>
                    <textarea
                      id={`alt-${indice}`}
                      value={alts[indice] ?? ""}
                      maxLength={ALT_TEXT_MAX_LENGTH}
                      disabled={ocupado}
                      rows={2}
                      onChange={(evento) => {
                        const texto = evento.target.value;
                        setAlts((atual) => completar(atual, midias.length).map((v, i) => (i === indice ? texto : v)));
                      }}
                      className="w-full rounded-[10px] border bg-transparent px-3 py-2 text-sm focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50"
                      placeholder="Ex.: três copos de café gelado sobre uma mesa de madeira"
                    />
                    <span className="text-[13px] text-muted-foreground tabular-nums">
                      <Contador atual={(alts[indice] ?? "").length} limite={ALT_TEXT_MAX_LENGTH} nome="caracteres" />
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          </ComposeSection>
        )}

        {/* Marcações e colaboradores chegam na Fase 2: aparecem apagados, dizendo quando,
            em vez de sumirem (docs/12). */}
        <ComposeSection title="Marcar pessoas" aside={<FaseDois />}>
          <p className="text-[13px] text-muted-foreground">Marcação por foto chega com os vídeos e o Reels.</p>
        </ComposeSection>
        <ComposeSection title="Colaboradores" aside={<FaseDois />}>
          <p className="text-[13px] text-muted-foreground">Contas convidadas para dividir a postagem.</p>
        </ComposeSection>

        {erro !== null && (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        )}

        {/*
         * No celular as ações ficam **fixas no rodapé** (docs/13, "Compor"): com
         * o formulário mais alto que a tela, um botão no fim do documento some
         * de vista justo quando se precisa dele.
         */}
        <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:static md:mx-0 md:flex-row md:border-0 md:bg-transparent md:p-0">
          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-10"
            disabled={ocupado || !temMudanca}
            onClick={() =>
              void comBloqueio(async () => {
                const salvo = await salvar();
                if (salvo === null) return;
                // Só agora a tela deixa de ser "Nova postagem".
                if (post === null) router.replace(`/c/${username}/postagens/${salvo.id}`);
                else router.refresh();
              })
            }
          >
            {ocupado ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Salvar rascunho
          </Button>

          {/*
            Salvar antes de enviar: mandar para a revisão algo que só existe na tela
            aprovaria uma coisa e publicaria outra.
          */}
          <Button
            type="button"
            className="h-11 md:h-10"
            disabled={ocupado || midias.length === 0 || midias.length > maximo || incompativeis.length > 0}
            onClick={() => void comBloqueio(enviarParaRevisao)}
          >
            {canApprove ? "Continuar para revisão" : "Enviar para revisão"}
            {canApprove ? <ArrowRight className="size-4" aria-hidden /> : <Send className="size-4" aria-hidden />}
          </Button>

          {post !== null && (
            <Button
              type="button"
              variant="ghost"
              className="h-11 text-muted-foreground md:ml-auto md:h-10"
              disabled={ocupado}
              onClick={() =>
                void comBloqueio(async () => {
                  const descartou = await escrever(
                    (v) => discardPostAction(username, post.id, { version: v }),
                    version,
                  );
                  if (descartou !== null) router.push(`/c/${username}/postagens`);
                })
              }
            >
              <Trash2 className="size-4" aria-hidden />
              Descartar
            </Button>
          )}
        </div>
      </div>

      <div className="w-full shrink-0 lg:sticky lg:top-7 lg:w-90">
        <FeedPreview
          account={account}
          format={format}
          media={midias}
          caption={caption}
          scheduledAt={post?.scheduledAt ?? null}
          timeZone={timeZone}
        />
      </div>
    </div>
  );
}

/** O formato da postagem, ou o padrão da tela nova. */
function formatoInicial(post: PostDetail | null): ComposableFormat {
  if (post === null) return "FEED";
  return (COMPOSABLE_FORMATS as readonly string[]).includes(post.format)
    ? (post.format as ComposableFormat)
    : "FEED";
}

/**
 * As imagens já anexadas, buscadas no acervo para ter as medidas e o endereço.
 *
 * A API entrega ordenado por `ordem`, e a ordem é preservada aqui: ela é o que
 * decide qual imagem define o quadro do carrossel.
 */
function midiasIniciais(post: PostDetail | null, acervo: readonly MediaSummary[]): readonly MediaSummary[] {
  return (post?.media ?? []).map(
    (anexada) =>
      acervo.find((item) => item.id === anexada.mediaId) ?? {
        id: anexada.mediaId,
        url: anexada.url,
        width: anexada.width,
        height: anexada.height,
        bytes: 0,
        createdAt: "",
        // Está anexada **a esta** postagem, por definição.
        inUse: true,
      },
  );
}

/**
 * A lista como a rota de mídia a espera, com o texto de cada foto (RF-B05).
 *
 * Vai também em Stories, onde a seção some: trocar de formato não apaga o que foi
 * digitado, e o publicador simplesmente não o manda à Meta, que não aceita
 * `alt_text` ali (docs/08, matriz).
 */
function paraEnvio(
  midias: readonly MediaSummary[],
  alts: readonly string[],
): { mediaId: string; altText: string | null }[] {
  return midias.map((item, i) => ({ mediaId: item.id, altText: (alts[i] ?? "").trim() || null }));
}

/** A lista com uma entrada por posição, para mover sem perder o alinhamento. */
function completar(alts: readonly string[], tamanho: number): readonly string[] {
  return Array.from({ length: tamanho }, (_, i) => alts[i] ?? "");
}

function mover<T>(lista: readonly T[], de: number, para: number): T[] {
  const copia = [...lista];
  const [item] = copia.splice(de, 1);
  if (item !== undefined) copia.splice(para, 0, item);
  return copia;
}

/**
 * Um contador da legenda, no formato do artboard: o número em destaque, o limite
 * com separador de milhar, e o nome por extenso.
 */
function Contador({ atual, limite, nome }: { readonly atual: number; readonly limite: number; readonly nome: string }) {
  const excedeu = atual > limite;

  return (
    <span className={cn(excedeu && "text-destructive")}>
      <strong className={cn("font-semibold", excedeu ? "text-destructive" : "text-foreground")}>
        {atual.toLocaleString("pt-BR")}
      </strong>{" "}
      / {limite.toLocaleString("pt-BR")} {nome}
    </span>
  );
}

/** O rótulo das seções que ainda não existem: dizem quando chegam. */
function FaseDois(): ReactNode {
  return <span className="text-[11px] font-semibold text-muted-foreground">Fase 2</span>;
}
