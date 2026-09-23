import { Injectable } from "@nestjs/common";
import { canDeleteComment, COMMENT_DELETE_WINDOW_MS } from "@repo/shared";
import {
  CommentDeleteExpiredError,
  CommentNotFoundError,
  CommentNotYoursError,
  PostNotFoundError,
} from "../common/errors";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Comentários internos da postagem (RF-E04; ADR 0026, decisão 4).
 *
 * **De qualquer usuário logado**, em qualquer estado da postagem: a conversa
 * "sobrevive às mudanças de status" (RF-E04), e quem só acompanha também tem voz.
 *
 * ⚠️ **Não escreve em `Postagem`.** Comentar não muda conteúdo nem status, então
 * não passa pela trava da versão (regra 20) e não disputa com quem está editando —
 * por isso mora fora de `PostsDomainService`, a única porta de escrita da postagem.
 */
@Injectable()
export class PostCommentsDomainService {
  constructor(private readonly prisma: PrismaService) {}

  async add(input: { accountId: string; postId: string; userId: string; text: string }): Promise<{ id: string }> {
    // Pelos dois identificadores: comentar numa postagem de outra conta é 404 (regra 24).
    const post = await this.prisma.db.post.findFirst({
      where: { id: input.postId, accountId: input.accountId },
      select: { id: true },
    });
    if (post === null) throw new PostNotFoundError();

    return this.prisma.db.internalComment.create({
      data: { postId: post.id, userId: input.userId, text: input.text },
      select: { id: true },
    });
  }

  /**
   * Excluir o próprio comentário, nos primeiros 5 minutos (ADR 0026) — o "apagar
   * para todos" de um chat, para o erro de digitação ou a postagem errada. Depois
   * disso ele já foi lido e respondido, e fica.
   *
   * ⚠️ **O `deleteMany` repete as condições**, e não só o id: entre a leitura e a
   * exclusão o prazo pode vencer. Nada apagado depois da leitura dizer que podia é
   * o mesmo que não ter podido.
   */
  async remove(input: { accountId: string; postId: string; commentId: string; userId: string; now: Date }): Promise<void> {
    // A postagem primeiro, pela conta — o mesmo 404 de toda rota da postagem (regra 24).
    const post = await this.prisma.db.post.findFirst({
      where: { id: input.postId, accountId: input.accountId },
      select: { id: true },
    });
    if (post === null) throw new PostNotFoundError();

    // E o comentário dentro dela: o de outra postagem não existe aqui.
    const comentario = await this.prisma.db.internalComment.findFirst({
      where: { id: input.commentId, postId: post.id },
      select: { userId: true, createdAt: true },
    });
    if (comentario === null) throw new CommentNotFoundError();
    if (comentario.userId !== input.userId) throw new CommentNotYoursError();
    if (!canDeleteComment({ authorId: comentario.userId, at: comentario.createdAt }, input.userId, input.now)) {
      throw new CommentDeleteExpiredError();
    }

    const limite = new Date(input.now.getTime() - COMMENT_DELETE_WINDOW_MS);
    const { count } = await this.prisma.db.internalComment.deleteMany({
      where: { id: input.commentId, userId: input.userId, createdAt: { gte: limite } },
    });
    if (count === 0) throw new CommentDeleteExpiredError();
  }
}
