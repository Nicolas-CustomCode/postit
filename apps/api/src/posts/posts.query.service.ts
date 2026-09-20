import { Inject, Injectable } from "@nestjs/common";
import { POST_EXCERPT_LENGTH, type PostDetail, type PostSummary } from "@repo/shared";
import { PostNotFoundError } from "../common/errors";
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
    }));
  }

  async detail(accountId: string, postId: string): Promise<PostDetail> {
    const post = await this.prisma.db.post.findFirst({
      where: { id: postId, accountId },
      include: {
        media: { orderBy: { position: "asc" }, include: { media: true } },
        createdBy: { select: { name: true } },
        updatedBy: { select: { name: true } },
      },
    });

    if (post === null) throw new PostNotFoundError();

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
    };
  }

  private urlFor(objectKey: string): string {
    return publicUrlFor(objectKey, {
      publicUrl: this.config.mediaPublicUrl,
      bucket: this.config.mediaBucket,
    });
  }
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
