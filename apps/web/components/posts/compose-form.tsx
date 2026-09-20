"use client";

import { Check, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  captionCounts,
  CAPTION_MAX_HASHTAGS,
  CAPTION_MAX_LENGTH,
  CAPTION_MAX_MENTIONS,
  IMAGE_SPECS,
  POST_FORMAT_LABELS,
  type ActionConflict,
  type PostDetail,
} from "@repo/shared";
import { LocalDate } from "@/components/local-date";
import { UploadField } from "@/components/media/upload-field";
import { ComposeSection } from "@/components/posts/compose-section";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  discardPostAction,
  markPostReadyAction,
  setCaptionAction,
  setPostMediaAction,
} from "@/lib/actions/posts";
import { cn } from "@/lib/utils";

/**
 * Compor uma postagem de imagem de feed (RF-C01, RF-C03, RF-C12).
 *
 * ⚠️ **O conflito de edição não pode custar o texto de ninguém.** Quando a API
 * recusa com `POST_VERSION_CONFLICT`, o que está no campo **continua lá** — a
 * tela mostra quem salvou antes e oferece as duas saídas do RF-C12. Limpar o
 * formulário seria transformar um aviso em perda de trabalho.
 *
 * **Só a legenda e a versão vivem em estado local.** Imagem e situação vêm da
 * prop, que o `router.refresh()` renova depois de cada escrita: guardar cópia
 * delas aqui criaria duas verdades para a mesma coisa. A versão é a exceção
 * necessária — a escrita seguinte precisa dela **antes** de o refresh chegar.
 */
export function ComposeForm({ username, post }: { readonly username: string; readonly post: PostDetail }): ReactNode {
  const router = useRouter();
  const [caption, setCaption] = useState(post.caption ?? "");
  const [version, setVersion] = useState(post.version);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [conflito, setConflito] = useState<ActionConflict | null>(null);

  const contagem = captionCounts(caption);
  const legendaMudou = caption !== (post.caption ?? "");
  const temImagem = post.media.length > 0;
  const imagem = post.media[0];

  /**
   * Executa uma escrita e devolve a versão nova, ou `null` se falhou.
   *
   * ⚠️ **Devolve, em vez de só guardar no estado.** Marcar como pronta encadeia
   * duas escritas, e `setVersion` não atualiza a variável na mesma passagem —
   * ler o estado entre as duas mandaria a versão velha e cairia num conflito
   * consigo mesma.
   */
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

  const salvarLegenda = (versaoAtual: number) =>
    escrever(
      (v) => setCaptionAction(username, post.id, { version: v, caption: caption === "" ? null : caption }),
      versaoAtual,
    );

  return (
    <div className="flex flex-col gap-4">
      {conflito !== null && (
        <Alert role="alert">
          <AlertDescription className="flex flex-col gap-3">
            <span>
              Esta postagem foi alterada por {conflito.updatedByName ?? "outra pessoa"} às{" "}
              <LocalDate iso={conflito.updatedAt} format="comHora" />. O que você escreveu continua aqui.
            </span>
            <span className="flex flex-col gap-2 md:flex-row">
              <Button
                type="button"
                variant="outline"
                className="h-11 md:h-10"
                onClick={() => {
                  // A versão do banco: a próxima tentativa parte dela, com o
                  // texto que a pessoa digitou.
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
                 * Recarga de verdade, e não `router.refresh()`: o texto certo é
                 * o que está no **servidor agora**, e um `setCaption(post.caption)`
                 * traria a legenda de quando esta tela carregou — que é
                 * exatamente a versão que acabou de ficar velha. O refresh
                 * atualiza a prop, mas o campo já está em estado local e não
                 * voltaria sozinho.
                 */
                onClick={() => window.location.reload()}
              >
                Descartar minhas alterações
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      )}

      {/*
       * O formato é fixo nesta fase; o artboard mostra pílulas de escolha, que
       * chegam na Fase 2 junto com carrossel, vídeo, Reels e Stories.
       */}
      <ComposeSection title="Formato">
        <p className="inline-flex h-10 w-fit items-center rounded-full border bg-muted px-4 text-sm font-semibold">
          {POST_FORMAT_LABELS[post.format]}
        </p>
      </ComposeSection>

      <ComposeSection
        title="Mídia"
        aside={
          <span className="text-[13px] text-muted-foreground">
            JPEG até 8 MB, proporção de {IMAGE_SPECS.FEED_IMAGE.ratioLabel}
          </span>
        }
      >
        {imagem !== undefined && (
          /*
           * O endereço vem do nosso armazenamento e muda junto com o túnel; o
           * otimizador do Next exigiria domínio fixo na configuração.
           */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imagem.url}
            alt={imagem.altText ?? ""}
            className="w-full max-w-sm rounded-lg border"
            width={imagem.width}
            height={imagem.height}
          />
        )}

        {/*
         * Com formato de destino: aqui a imagem precisa servir ao feed, e
         * "enviar como está" seria um beco — o arquivo entraria no acervo e a
         * API recusaria anexá-lo em seguida.
         */}
        <UploadField
          mode={{ format: "FEED_IMAGE" }}
          onUploaded={(enviada) =>
            void comBloqueio(async () => {
              const nova = await escrever(
                (v) => setPostMediaAction(username, post.id, { version: v, mediaId: enviada.id, altText: null }),
                version,
              );
              if (nova !== null) router.refresh();
            })
          }
        />
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

        {/* Os três contadores do RF-C03, com os limites da Meta. */}
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground tabular-nums">
          <Contador atual={contagem.length} limite={CAPTION_MAX_LENGTH} nome="caracteres" />
          <Contador atual={contagem.hashtags} limite={CAPTION_MAX_HASHTAGS} nome="hashtags" />
          <Contador atual={contagem.mentions} limite={CAPTION_MAX_MENTIONS} nome="menções" />
        </p>
      </ComposeSection>

      {erro !== null && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      {/*
       * No celular as ações ficam **fixas no rodapé** (docs/13, "Compor"): com o
       * formulário mais alto que a tela, um botão no fim do documento some de
       * vista justo quando se precisa dele.
       */}
      <div className="sticky bottom-0 -mx-4 flex flex-col gap-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:static md:mx-0 md:flex-row md:border-0 md:bg-transparent md:p-0">
        <Button
          type="button"
          className="h-11 md:h-10"
          disabled={ocupado || !legendaMudou}
          onClick={() =>
            void comBloqueio(async () => {
              if ((await salvarLegenda(version)) !== null) router.refresh();
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
          disabled={ocupado || !temImagem || post.status === "APPROVED"}
          onClick={() =>
            void comBloqueio(async () => {
              // Salvar antes: marcar como pronta uma legenda que só existe na
              // tela aprovaria uma coisa e publicaria outra.
              const depoisDaLegenda = legendaMudou ? await salvarLegenda(version) : version;
              if (depoisDaLegenda === null) return;

              const pronta = await escrever(
                (v) => markPostReadyAction(username, post.id, { version: v }),
                depoisDaLegenda,
              );
              if (pronta !== null) router.refresh();
            })
          }
        >
          <Check className="size-4" aria-hidden />
          {post.status === "APPROVED" ? "Pronta" : "Marcar como pronta"}
        </Button>

        {post.status === "DRAFT" && (
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
  );
}

/**
 * Um contador da legenda, no formato do artboard: o número em destaque, o limite
 * com separador de milhar, e o nome por extenso.
 *
 * Passar do limite fica em vermelho — e o número continua visível, porque saber
 * **de quanto** foi é o que diz quanto cortar.
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
