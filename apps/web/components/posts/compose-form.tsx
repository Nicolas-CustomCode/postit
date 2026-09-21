"use client";

import { CalendarClock, Check, ImagePlus, Info, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  captionCounts,
  CAPTION_MAX_HASHTAGS,
  CAPTION_MAX_LENGTH,
  CAPTION_MAX_MENTIONS,
  COMPOSABLE_FORMATS,
  formatsFor,
  IMAGE_SPECS,
  POST_FORMAT_LABELS,
  POST_FORMATS,
  POST_MEDIA_COUNT,
  type AccountSummary,
  type ActionConflict,
  type ComposableFormat,
  type MediaSummary,
  type PostDetail,
} from "@repo/shared";
import { AccountDateTime, accountZoneName, civilFieldsFor, todayIn } from "@/components/account-time";
import { MediaPicker } from "@/components/media/media-picker";
import { UploadField } from "@/components/media/upload-field";
import { ComposeSection } from "@/components/posts/compose-section";
import { FeedPreview } from "@/components/posts/feed-preview";
import { MediaStrip } from "@/components/posts/media-strip";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  cancelPostAction,
  createPostAction,
  discardPostAction,
  markPostReadyAction,
  schedulePostAction,
  setCaptionAction,
  setPostFormatAction,
  setPostMediaAction,
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
}: {
  readonly username: string;
  /** A conta, para a prévia mostrar a foto real dela. */
  readonly account: Pick<AccountSummary, "name" | "username" | "photoUrl">;
  /** O fuso da conta: é nele que o horário escolhido é interpretado (ADR 0006). */
  readonly timeZone: string;
  /** O acervo, para escolher sem sair da tela (RF-B04). */
  readonly media: readonly MediaSummary[];
  /** Em branco na tela de nova postagem: ela ainda não existe no banco. */
  readonly post: PostDetail | null;
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
   * é conteúdo de verdade — a primeira define o recorte de todas.
   */
  const [midias, setMidias] = useState<readonly MediaSummary[]>(midiasIniciais(post, media));
  /** O que a última reordenação fez, para quem navega por leitor de tela. */
  const [anuncio, setAnuncio] = useState("");

  /*
   * O horário também vive aqui: quando a edição derruba a postagem para
   * rascunho, a API apaga o `publicarEm`, mas o que a pessoa escolheu continua
   * na tela para reagendar num clique.
   */
  const gravado = civilFieldsFor(post?.scheduledAt ?? null, timeZone);
  const [day, setDay] = useState(gravado.day);
  const [time, setTime] = useState(gravado.time);

  /**
   * ⚠️ **Fato observado, não deduzido do banco.** A versão anterior mostrava o
   * aviso sempre que havia data digitada e nada agendado — o que acontece
   * também numa postagem que nunca foi agendada. Agora só é verdade depois de
   * uma escrita ter mesmo derrubado uma postagem que estava agendada.
   */
  const [horarioCaiu, setHorarioCaiu] = useState(false);

  const contagem = captionCounts(caption);
  const legendaMudou = caption !== (post?.caption ?? "");
  const formatoMudou = post !== null && format !== post.format;
  /*
   * Posicional, e não por conjunto: a mesma imagem pode aparecer duas vezes de
   * propósito, e trocar a ordem é mudança de conteúdo como qualquer outra.
   */
  const midiaMudou =
    midias.length !== (post?.media.length ?? 0) || midias.some((item, i) => item.id !== post?.media[i]?.mediaId);
  const temMudanca = post === null || legendaMudou || formatoMudou || midiaMudou;

  const maximo = POST_MEDIA_COUNT[format].max;
  const cheia = midias.length >= maximo;
  /*
   * A metade "a tela avisa" da regra 6: `formatsFor` roda aqui, então dá para
   * apontar **qual** imagem não serve — coisa que o erro da API não carrega.
   */
  const incompativeis = midias.filter((item) => !formatsFor(item.width, item.height).includes(format));

  function moverMidia(de: number, para: number): void {
    setMidias((atual) => {
      const copia = [...atual];
      const [item] = copia.splice(de, 1);
      if (item !== undefined) copia.splice(para, 0, item);
      return copia;
    });
    setAnuncio(`Imagem ${de + 1} movida para a posição ${para + 1}.`);
  }

  function removerMidia(indice: number): void {
    setMidias((atual) => atual.filter((_, i) => i !== indice));
    setAnuncio(`Imagem ${indice + 1} removida.`);
  }

  const status = post?.status ?? "DRAFT";
  // Só APROVADO e AGENDADO aceitam horário — a invariante I-1 e o RF-D04. A API
  // confere de novo: esconder o botão é conveniência, não proteção (regra 17).
  const podeAgendar = status === "APPROVED" || status === "SCHEDULED";

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
      // Se a postagem estava agendada, esta escrita de conteúdo a derrubou — e
      // o horário saiu junto (invariante I-2).
      if (post?.status === "SCHEDULED") setHorarioCaiu(true);
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
   */
  async function salvar(): Promise<string | null> {
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
          (atual) => setPostMediaAction(username, criada.data.id, { version: atual, media: paraEnvio(midias) }),
          v,
        );
        if (comMidia === null) return null;
        v = comMidia;
      }

      return criada.data.id;
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
        (atual) => setPostMediaAction(username, post.id, { version: atual, media: paraEnvio(midias) }),
        v,
      );
      if (depois === null) return null;
    }

    return post.id;
  }

  return (
    <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-7">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
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
            {midias.length > 0 && (
              <MediaStrip
                midias={midias}
                format={format}
                disabled={ocupado}
                onMover={moverMidia}
                onRemover={removerMidia}
              />
            )}

            {/* O aviso da reordenação, só para quem usa leitor de tela: a faixa
                já mostra a ordem nova para quem enxerga. */}
            <p aria-live="polite" className="sr-only">
              {anuncio}
            </p>

            {cheia ? (
              <p className="text-[13px] text-muted-foreground">
                {maximo === 1
                  ? `${POST_FORMAT_LABELS[format]} aceita uma mídia só.`
                  : "Você já tem 10 — o máximo que o Instagram aceita numa postagem."}
              </p>
            ) : (
              <div className="flex flex-col gap-2 sm:max-w-xs">
                {/* As duas portas: o acervo, e o envio. */}
                <MediaPicker
                  media={media}
                  format={format}
                  remaining={maximo - midias.length}
                  disabled={ocupado}
                  onConfirm={(escolhidas) => setMidias((atual) => [...atual, ...escolhidas])}
                />
                <UploadField
                  mode={{ format }}
                  label="Enviar nova"
                  icon={ImagePlus}
                  onUploaded={(enviada) => {
                    // Acrescenta: a postagem nasce no salvamento, e a imagem já
                    // está no acervo de qualquer forma.
                    setMidias((atual) => [...atual, enviada]);
                    router.refresh();
                  }}
                />
              </div>
            )}

            {incompativeis.length > 0 && (
              <p className="text-[13px] text-destructive">
                {incompativeis.length === 1
                  ? "Uma das imagens não serve para "
                  : `${incompativeis.length} imagens não servem para `}
                {POST_FORMAT_LABELS[format]}. Remova ou troque de formato.
              </p>
            )}
          </div>
        </ComposeSection>

        <ComposeSection title="Legenda">
          <label htmlFor="legenda" className="sr-only">
            Legenda
          </label>
          <textarea
            id="legenda"
            value={caption}
            disabled={ocupado}
            onChange={(evento) => setCaption(evento.target.value)}
            rows={7}
            className="min-h-33 w-full rounded-[10px] border bg-transparent px-3.5 py-3 text-[15px]/relaxed focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-accent focus-visible:outline-none"
            placeholder="O que vai junto com a imagem"
          />

          <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground tabular-nums">
            <Contador atual={contagem.length} limite={CAPTION_MAX_LENGTH} nome="caracteres" />
            <Contador atual={contagem.hashtags} limite={CAPTION_MAX_HASHTAGS} nome="hashtags" />
            <Contador atual={contagem.mentions} limite={CAPTION_MAX_MENTIONS} nome="menções" />
          </p>
        </ComposeSection>

        <ComposeSection
          title="Quando publicar"
          aside={<span className="text-[13px] text-muted-foreground">{accountZoneName(timeZone)}, o fuso da conta</span>}
        >
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="dia" className="text-sm font-semibold">
                Data
              </label>
              <input
                id="dia"
                type="date"
                value={day}
                min={todayIn(timeZone)}
                disabled={ocupado || post === null}
                onChange={(evento) => setDay(evento.target.value)}
                className="h-11 w-45 rounded-[10px] border bg-transparent px-3 text-sm tabular-nums focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="hora" className="text-sm font-semibold">
                Hora
              </label>
              <input
                id="hora"
                type="time"
                value={time}
                disabled={ocupado || post === null}
                onChange={(evento) => setTime(evento.target.value)}
                className="h-11 w-28 rounded-[10px] border bg-transparent px-3 text-sm tabular-nums focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50"
              />
            </div>

            <Button
              type="button"
              variant="outline"
              className="h-11 md:h-10"
              disabled={ocupado || post === null || day === "" || time === "" || !podeAgendar}
              onClick={() =>
                void comBloqueio(async () => {
                  if (post === null) return;
                  const nova = await escrever(
                    (v) => schedulePostAction(username, post.id, { version: v, day, time }),
                    version,
                  );
                  if (nova !== null) {
                    setHorarioCaiu(false);
                    router.refresh();
                  }
                })
              }
            >
              <CalendarClock className="size-4" aria-hidden />
              {status === "SCHEDULED" ? "Reagendar" : "Agendar"}
            </Button>
          </div>

          {horarioCaiu && (
            <p className="text-[13px] text-warning">
              A edição derrubou esta postagem para rascunho e desmarcou o horário. Marque como pronta e
              agende de novo.
            </p>
          )}

          {post !== null && post.scheduledAt !== null && (
            <p className="text-[13px] text-muted-foreground">
              Vai ao ar em <AccountDateTime iso={post.scheduledAt} timeZone={timeZone} />.
            </p>
          )}

          {post === null && (
            <p className="text-[13px] text-muted-foreground">
              Salve o rascunho e marque como pronta para poder agendar.
            </p>
          )}
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
            className="h-11 md:h-10"
            disabled={ocupado || !temMudanca}
            onClick={() =>
              void comBloqueio(async () => {
                const id = await salvar();
                if (id === null) return;
                // Só agora a tela deixa de ser "Nova postagem".
                if (post === null) router.replace(`/c/${username}/postagens/${id}`);
                else router.refresh();
              })
            }
          >
            {ocupado ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Salvar rascunho
          </Button>

          <Button
            type="button"
            variant="outline"
            className="h-11 md:h-10"
            disabled={
              ocupado || midias.length === 0 || midias.length > maximo || incompativeis.length > 0 || status === "APPROVED"
            }
            onClick={() =>
              void comBloqueio(async () => {
                // Salvar antes: marcar como pronta algo que só existe na tela
                // aprovaria uma coisa e publicaria outra.
                const id = await salvar();
                if (id === null) return;

                if (post === null) {
                  router.replace(`/c/${username}/postagens/${id}`);
                  return;
                }

                const pronta = await escrever(
                  (v) => markPostReadyAction(username, post.id, { version: v }),
                  version,
                );
                if (pronta !== null) router.refresh();
              })
            }
          >
            <Check className="size-4" aria-hidden />
            {status === "APPROVED" ? "Pronta" : "Marcar como pronta"}
          </Button>

          {post !== null && status === "SCHEDULED" && (
            <Button
              type="button"
              variant="ghost"
              className="h-11 text-muted-foreground md:ml-auto md:h-10"
              disabled={ocupado}
              onClick={() =>
                void comBloqueio(async () => {
                  const cancelou = await escrever(
                    (v) => cancelPostAction(username, post.id, { version: v }),
                    version,
                  );
                  if (cancelou !== null) router.push(`/c/${username}/postagens`);
                })
              }
            >
              <Trash2 className="size-4" aria-hidden />
              Cancelar agendamento
            </Button>
          )}

          {post !== null && status === "DRAFT" && (
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
 * decide qual imagem manda no recorte do carrossel.
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
      },
  );
}

/** A lista como a rota de mídia a espera. O texto alternativo é da Fase 2. */
function paraEnvio(midias: readonly MediaSummary[]): { mediaId: string; altText: string | null }[] {
  return midias.map((item) => ({ mediaId: item.id, altText: null }));
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
