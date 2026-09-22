import { Injectable } from "@nestjs/common";
import { isPublishFailureCause } from "@repo/shared";
import { PrismaService } from "../../prisma/prisma.service";
import type { PublishJobData } from "./dispatcher.service";
import { PostOutcomeStore } from "./post-outcome.store";
import { PublishFailureService } from "./publish-failure.service";

/**
 * O tratador da fila `publicar-instagram-falhas` (docs/09, "O que acontece ao
 * esgotar as tentativas"): marca `FALHOU` com a causa da última tentativa.
 *
 * **Não lança, nunca.** Se a postagem não está como ele espera — já publicada,
 * noutro ciclo, ou alguém ainda a segura —, ele sai quieto: a escrita é cercada
 * pela versão e pelo arrendamento livre, e o que sobrar sem dono o despachante
 * recolhe. Lançar gastaria as tentativas desta fila em segundos, com a postagem
 * ainda segura por uma execução viva.
 */
@Injectable()
export class DeadLetterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly store: PostOutcomeStore,
    private readonly failures: PublishFailureService,
  ) {}

  async run(job: PublishJobData): Promise<void> {
    const post = await this.prisma.db.post.findUnique({
      where: { id: job.postId },
      select: { lastErrorCode: true, publication: { select: { id: true } } },
    });
    if (post === null) return;

    // A Publicacao é o fato: se ela existe, a postagem saiu.
    if (post.publication !== null) {
      await this.store.publish(this.prisma.db, job.postId);
      return;
    }

    await this.failures.fail({
      postId: job.postId,
      cause: isPublishFailureCause(post.lastErrorCode) ? post.lastErrorCode : "SYSTEM_UNAVAILABLE",
      step: "GIVE_UP",
      fence: { status: "PROCESSING", version: job.version },
    });
  }
}
