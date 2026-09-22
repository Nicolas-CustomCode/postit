import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { InstagramClient, MetaRefusedError } from "./client";

/**
 * As chamadas de publicação na Meta: container, estado, `media_publish` e
 * permalink (docs/08, "Publicação em duas etapas").
 *
 * ⚠️ **Só o worker.** Não é provido pelo `InstagramModule`, que a API HTTP e a CLI
 * também importam: quem o provê é o `PublishingModule`, importado apenas pelo
 * `WorkerModule` (AGENTS.md, regra 1). Assim nenhum outro processo tem como
 * publicar, nem por engano.
 *
 * Aqui mora só **o que se manda e o que volta**. Decidir o que fazer com um erro,
 * quando reaproveitar um container e quando desistir é das regras de
 * `domain/publishing/` e do publicador.
 */

/**
 * `media_publish` é a chamada em que desistir cedo custa caro: sem resposta, não se
 * sabe se a Meta publicou. O dobro do padrão das leituras dá margem a uma Meta
 * lenta sem segurar o tratador para sempre.
 */
const PUBLISH_TIMEOUT_MS = 40_000;

/** Os valores de `status_code` que a documentação lista (docs/08). */
export const CONTAINER_STATUS_CODES = ["IN_PROGRESS", "FINISHED", "ERROR", "EXPIRED", "PUBLISHED"] as const;
export type ContainerStatusCode = (typeof CONTAINER_STATUS_CODES)[number];

/** Onde a imagem vai aparecer — decide quais parâmetros da matriz do docs/08 entram. */
export type ImageContainerKind = "FEED" | "CAROUSEL_ITEM" | "STORY";

export interface ImageContainerParams {
  readonly imageUrl: string;
  readonly kind: ImageContainerKind;
  /** Só vale em `FEED`. Nos outros dois a Meta não aceita, e é descartada aqui. */
  readonly caption?: string;
  /** Vale em `FEED` e `CAROUSEL_ITEM`. Stories não aceita. */
  readonly altText?: string | null;
}

export interface ContainerStatusReading {
  readonly statusCode: ContainerStatusCode;
  /** Texto livre de diagnóstico, sem lista fechada: só para a auditoria. */
  readonly status: string | null;
}

const idSchema = z.object({ id: z.string().min(1) }).loose();
const statusSchema = z
  .object({ status_code: z.enum(CONTAINER_STATUS_CODES), status: z.string().optional() })
  .loose();
const permalinkSchema = z.object({ permalink: z.string().url().optional() }).loose();

@Injectable()
export class InstagramPublishingApi {
  constructor(private readonly client: InstagramClient) {}

  /**
   * Cria o container de uma imagem, seguindo a matriz de parâmetros do docs/08:
   *
   * | | `caption` | `alt_text` | extra |
   * |---|---|---|---|
   * | Feed | sim | sim | — |
   * | Item de carrossel | não | sim | `is_carousel_item` |
   * | Stories | não | não | `media_type=STORIES` |
   */
  async createImageContainer(igUserId: string, token: string, params: ImageContainerParams): Promise<string> {
    const body: Record<string, unknown> = { image_url: params.imageUrl };

    if (params.kind === "FEED" && params.caption) body["caption"] = params.caption;
    if (params.kind !== "STORY" && params.altText) body["alt_text"] = params.altText;
    if (params.kind === "CAROUSEL_ITEM") body["is_carousel_item"] = true;
    if (params.kind === "STORY") body["media_type"] = "STORIES";

    return this.id(await this.client.post(`/${igUserId}/media`, token, body));
  }

  /**
   * O container pai do carrossel. A legenda vai aqui, nunca nos filhos.
   *
   * `children` vai como texto separado por vírgula, que é o formato do exemplo do
   * guia de publicação do Instagram Login — a referência descreve "an array", mas
   * o exemplo da via que usamos é o texto.
   */
  async createCarouselContainer(
    igUserId: string,
    token: string,
    params: { children: readonly string[]; caption?: string },
  ): Promise<string> {
    const body: Record<string, unknown> = { media_type: "CAROUSEL", children: params.children.join(",") };
    if (params.caption) body["caption"] = params.caption;

    return this.id(await this.client.post(`/${igUserId}/media`, token, body));
  }

  async containerStatus(containerId: string, token: string): Promise<ContainerStatusReading> {
    const corpo = await this.client.get(`/${containerId}`, token, { fields: "status_code,status" });
    const lido = statusSchema.safeParse(corpo);
    if (!lido.success) throw unexpected();
    return { statusCode: lido.data.status_code, status: lido.data.status ?? null };
  }

  /** Publica o container pronto e devolve o id da mídia no Instagram. */
  async publish(igUserId: string, token: string, creationId: string): Promise<string> {
    return this.id(
      await this.client.post(`/${igUserId}/media_publish`, token, { creation_id: creationId }, { timeoutMs: PUBLISH_TIMEOUT_MS }),
    );
  }

  /**
   * O endereço público da publicação.
   *
   * `null` quando a Meta não manda: o link é conveniência da tela, e a postagem
   * não deixa de estar publicada por falta dele.
   */
  async permalink(mediaId: string, token: string): Promise<string | null> {
    const lido = permalinkSchema.safeParse(await this.client.get(`/${mediaId}`, token, { fields: "permalink" }));
    return lido.success ? (lido.data.permalink ?? null) : null;
  }

  private id(corpo: unknown): string {
    const lido = idSchema.safeParse(corpo);
    if (!lido.success) throw unexpected();
    return lido.data.id;
  }
}

/** Resposta 200 que não tem o formato documentado: tratada como recusa sem código. */
function unexpected(): MetaRefusedError {
  return new MetaRefusedError({ status: 200, code: null, subcode: null, type: null });
}
