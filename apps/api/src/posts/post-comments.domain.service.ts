import { Injectable } from "@nestjs/common";
import { PostNotFoundError } from "../common/errors";
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
}
