import { Inject, Injectable } from "@nestjs/common";
import type { MediaSummary } from "@repo/shared";
import { PrismaService } from "../prisma/prisma.service";
import { publicUrlFor } from "../storage/public-url";
import { MEDIA_CONFIG, type MediaConfig } from "./media.config";

/**
 * O acervo: o que já foi enviado e validado (RF-B04).
 *
 * ⚠️ **Não filtra por conta, e não deve.** A `Midia` não tem dono nem conta no
 * schema — é global por desenho, porque o acervo é compartilhado: a mesma foto
 * serve a qualquer conta e a qualquer formato (docs/13, "Acervo"). Filtrar aqui
 * significaria enviar a mesma imagem duas vezes para usá-la em duas contas.
 *
 * Sem paginação: a lista sai com um teto, as mais recentes primeiro. Numa
 * ferramenta interna, paginar antes de haver volume é inventar problema — e o
 * dia em que houver, a busca vem junto, que é o que a pessoa vai querer de
 * verdade.
 */
const LIMITE = 60;

@Injectable()
export class MediaQueryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_CONFIG) private readonly config: MediaConfig,
  ) {}

  async list(): Promise<MediaSummary[]> {
    const midias = await this.prisma.db.media.findMany({
      orderBy: { createdAt: "desc" },
      take: LIMITE,
    });

    return midias.map((midia) => ({
      id: midia.id,
      url: publicUrlFor(midia.objectKey, {
        publicUrl: this.config.mediaPublicUrl,
        bucket: this.config.mediaBucket,
      }),
      width: midia.width,
      height: midia.height,
      bytes: midia.bytes,
      createdAt: midia.createdAt.toISOString(),
    }));
  }
}
