import { Inject, Injectable } from "@nestjs/common";
import {
  isPublishFailureCause,
  POST_EXCERPT_LENGTH,
  type PostDetail,
  type PostDecision,
  type PostHistoryEntry,
  type PostSummary,
  type PostTimelineEntry,
  type PublishFailureCause,
} from "@repo/shared";
import { PostNotFoundError } from "../common/errors";
import { publishMilestones } from "../domain/publishing/timeline";
import { PrismaService } from "../prisma/prisma.service";
import { publicUrlFor } from "../storage/public-url";
import { POSTS_CONFIG, type PostsConfig } from "./posts.config";

/**
 * Leitura das postagens de uma conta.
 *
 * ⚠️ **`accountId` é o primeiro parâmetro de tudo, e entra em todo `where`.**
 * Não por estilo: é a garantia da regra 24 do AGENTS.md. Uma consulta por `id`
 * sozinho devolveria a postagem de outra conta para quem adivinhasse o
 * identificador. Como existe **um** `detail()` e **um** `findOrThrow()`, há só
 * dois lugares onde esse esquecimento caberia — e um teste varre as rotas para
 * provar que nenhum deles aconteceu.
 *
 * Monta os DTOs campo a campo; nunca devolve o registro do Prisma (regra 6).
 */
@Injectable()
export class PostsQueryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(POSTS_CONFIG) private readonly config: PostsConfig,
  ) {}

  async list(accountId: string): Promise<PostSummary[]> {
    const posts = await this.prisma.db.post.findMany({
      // Descartada sai da lista: é para isso que se descarta. A linha continua
      // no banco — nada aqui apaga postagem —, mas tirar da frente é o efeito
      // que a pessoa pediu.
      where: { accountId, status: { not: "CANCELED" } },
      // O que foi mexido por último primeiro: é o que a pessoa veio ver.
      orderBy: { updatedAt: "desc" },
      include: { media: { orderBy: { position: "asc" }, take: 1, include: { media: true } } },
    });

    return posts.map((post) => ({
      id: post.id,
      format: post.format,
      status: post.status,
      excerpt: excerptOf(post.caption),
      thumbnailUrl: post.media[0] === undefined ? null : this.urlFor(post.media[0].media.objectKey),
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
      updatedAt: post.updatedAt.toISOString(),
      failureCause: causeOf(post.lastErrorCode),
    }));
  }

  async detail(accountId: string, postId: string): Promise<PostDetail> {
    const post = await this.prisma.db.post.findFirst({
      where: { id: postId, accountId },
      include: {
        media: { orderBy: { position: "asc" }, include: { media: true } },
        createdBy: { select: { name: true } },
        updatedBy: { select: { name: true } },
        publication: { select: { publishedAt: true, permalink: true } },
        account: { select: { accessLostAt: true } },
        // A última decisão: `id` desempata as que caem no mesmo milissegundo.
        approvals: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          include: { user: { select: { name: true } } },
        },
      },
    });

    if (post === null) throw new PostNotFoundError();
    const ultima = post.approvals[0];

    return {
      id: post.id,
      format: post.format,
      status: post.status,
      caption: post.caption,
      version: post.version,
      media: post.media.map((item) => ({
        mediaId: item.mediaId,
        url: this.urlFor(item.media.objectKey),
        width: item.media.width,
        height: item.media.height,
        altText: item.altText,
        position: item.position,
      })),
      scheduledAt: post.scheduledAt?.toISOString() ?? null,
      createdById: post.createdById,
      createdByName: post.createdBy.name,
      updatedByName: post.updatedBy?.name ?? null,
      updatedAt: post.updatedAt.toISOString(),
      publication:
        post.publication === null
          ? null
          : { publishedAt: post.publication.publishedAt.toISOString(), permalink: post.publication.permalink },
      failureCause: causeOf(post.lastErrorCode),
      attempts: post.attempts,
      accountAccessLost: post.account.accessLostAt !== null,
      lastDecision: ultima === undefined ? null : decisionOf(ultima),
    };
  }

  /**
   * A linha do tempo da Revisão (ADR 0026, decisão 5): a criação, as decisões, os
   * comentários e os marcos da publicação, em ordem — cada comentário no seu
   * contexto.
   *
   * ⚠️ **Só nomes, e nada da resposta da Meta** (AGENTS.md, regra 3): quem só vê
   * também lê isto. `respostaMeta` nem é lido aqui; o detalhe técnico fica em
   * `history()`, recolhido na tela da falha.
   */
  async timeline(accountId: string, postId: string): Promise<PostTimelineEntry[]> {
    const post = await this.prisma.db.post.findFirst({
      where: { id: postId, accountId },
      select: {
        id: true,
        createdAt: true,
        status: true,
        lastErrorCode: true,
        createdBy: { select: { name: true } },
        approvals: { include: { user: { select: { name: true } } } },
        // Os mais recentes, com teto: uma conversa de mil comentários não vem inteira
        // numa página de celular. A ordem final é feita abaixo, junto com o resto.
        internalComments: {
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: COMMENTS_LIMIT,
          include: { user: { select: { name: true } } },
        },
        publishEvents: { select: { id: true, createdAt: true, step: true, result: true } },
      },
    });
    if (post === null) throw new PostNotFoundError();

    const eventos = [...post.publishEvents]
      .sort(byTimeThenId)
      .map((evento) => ({ id: evento.id, at: evento.createdAt.toISOString(), step: evento.step, result: evento.result }));

    const linhas: (PostTimelineEntry & { readonly sortAt: Date })[] = [
      { kind: "CREATED", id: post.id, at: post.createdAt.toISOString(), byName: post.createdBy.name, sortAt: post.createdAt },
      ...post.approvals.map((linha) => ({
        kind: "DECISION" as const,
        id: linha.id,
        ...decisionOf(linha),
        sortAt: linha.createdAt,
      })),
      ...post.internalComments.map((linha) => ({
        kind: "COMMENT" as const,
        id: linha.id,
        at: linha.createdAt.toISOString(),
        byName: linha.user.name,
        text: linha.text,
        sortAt: linha.createdAt,
      })),
      ...publishMilestones(eventos, { status: post.status, failureCause: causeOf(post.lastErrorCode) }).map(
        (marco) => ({ kind: "PUBLISHING" as const, ...marco, sortAt: new Date(marco.at) }),
      ),
    ];

    return linhas
      .sort((a, b) => byTimeThenId({ createdAt: a.sortAt, id: a.id }, { createdAt: b.sortAt, id: b.id }))
      .map(({ sortAt: _sortAt, ...linha }) => linha);
  }

  /**
   * O que o motor fez com a postagem, na ordem em que fez (RF-F09; RNF-10).
   *
   * `respostaMeta` sai como foi gravada: o cliente da Meta já a saneou antes de
   * gravar, sem o token (docs/08, "O erro cru vai para a auditoria"). A postagem é
   * conferida pela conta, como toda leitura daqui (regra 24).
   */
  async history(accountId: string, postId: string): Promise<PostHistoryEntry[]> {
    const post = await this.prisma.db.post.findFirst({ where: { id: postId, accountId }, select: { id: true } });
    if (post === null) throw new PostNotFoundError();

    const events = await this.prisma.db.publishEvent.findMany({
      where: { postId },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true, step: true, result: true, metaResponse: true },
    });

    return events.map((event) => ({
      at: event.createdAt.toISOString(),
      step: event.step,
      result: event.result,
      detail: event.metaResponse,
    }));
  }

  private urlFor(objectKey: string): string {
    return publicUrlFor(objectKey, {
      publicUrl: this.config.mediaPublicUrl,
      bucket: this.config.mediaBucket,
    });
  }
}

/** Teto de comentários lidos por vez na linha do tempo — os mais recentes. */
const COMMENTS_LIMIT = 500;

/**
 * Em ordem de acontecimento. `id` desempata o mesmo milissegundo: envio e
 * aprovação encadeados caem na mesma transação, e os ids são uuid v7, crescentes.
 */
function byTimeThenId(a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function decisionOf(linha: {
  action: PostDecision["action"];
  createdAt: Date;
  reason: string | null;
  scheduledFor: Date | null;
  user: { name: string };
}): PostDecision {
  return {
    action: linha.action,
    byName: linha.user.name,
    at: linha.createdAt.toISOString(),
    reason: linha.reason,
    scheduledFor: linha.scheduledFor?.toISOString() ?? null,
  };
}

/** O código gravado, se for uma causa conhecida — nunca texto solto para a tela. */
function causeOf(code: string | null): PublishFailureCause | null {
  return isPublishFailureCause(code) ? code : null;
}

/**
 * O trecho que vai na lista.
 *
 * A legenda inteira chega a 2200 caracteres; cinquenta delas são mais de 100 KB
 * para mostrar três linhas truncadas no celular.
 */
function excerptOf(caption: string | null): string | null {
  if (caption === null) return null;
  const limpo = caption.trim();
  if (limpo.length === 0) return null;

  return limpo.length <= POST_EXCERPT_LENGTH ? limpo : `${limpo.slice(0, POST_EXCERPT_LENGTH)}…`;
}
