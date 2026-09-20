"use client";

import { Check, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  captionCounts,
  CAPTION_MAX_HASHTAGS,
  CAPTION_MAX_LENGTH,
  CAPTION_MAX_MENTIONS,
  type ActionConflict,
  type PostDetail,
} from "@repo/shared";
import { LocalDate } from "@/components/local-date";
import { UploadField } from "@/components/media/upload-field";
import { PostStatusBadge } from "@/components/posts/post-status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <PostStatusBadge status={post.status} />
        <span className="text-sm text-muted-foreground">
          Criada por {post.createdByName} · <LocalDate iso={post.updatedAt} format="comHora" />
        </span>
      </div>

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

      <div className="flex flex-col gap-3">
        <Label>Imagem</Label>
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
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="legenda">Legenda</Label>
        <textarea
          id="legenda"
          value={caption}
          disabled={ocupado}
          onChange={(evento) => setCaption(evento.target.value)}
          rows={8}
          className="w-full rounded-lg border bg-transparent p-3 text-sm"
          placeholder="O que vai junto com a imagem"
        />

        {/* Os três contadores do RF-C03, com os limites da Meta. */}
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <Contador atual={contagem.length} limite={CAPTION_MAX_LENGTH} nome="caracteres" />
          <Contador atual={contagem.hashtags} limite={CAPTION_MAX_HASHTAGS} nome="hashtags" />
          <Contador atual={contagem.mentions} limite={CAPTION_MAX_MENTIONS} nome="menções" />
        </p>
      </div>

      {erro !== null && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-2 md:flex-row">
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
          Salvar
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

/** Passar do limite fica em vermelho — e o número diz de quanto foi. */
function Contador({ atual, limite, nome }: { readonly atual: number; readonly limite: number; readonly nome: string }) {
  return (
    <span className={cn(atual > limite && "font-semibold text-destructive")}>
      {atual} / {limite} {nome}
    </span>
  );
}
