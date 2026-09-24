import { Injectable, Logger } from "@nestjs/common";
import { MediaInUseError } from "../common/errors";
import { PrismaService } from "../prisma/prisma.service";
import { MediaRemovalService } from "./media-removal.service";

/** Quanto tempo uma recortada recém-enviada é poupada — a composição pode estar aberta. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/** Quantas candidatas por consulta. */
const BATCH = 100;

/**
 * Teto de voltas numa execução. Cada volta apaga uma camada de pontas — uma cadeia
 * de recortes de recortes precisa de uma volta por elo —, e nenhuma pessoa ajusta a
 * mesma foto cinquenta vezes. É só a garantia de que um defeito não gira sem fim.
 */
const MAX_ROUNDS = 50;

/**
 * Apaga as imagens recortadas que ninguém usa (ADR 0025; docs/09, `manutencao`).
 *
 * A imagem ajustada vira uma `Midia` **derivada**, e o acervo a esconde — para uma
 * foto não virar três. O efeito colateral: quando ela deixa de ser usada — a
 * postagem nunca foi salva, a foto foi trocada, a postagem foi descartada —,
 * ninguém mais a vê nem a apaga. Esta limpeza faz isso, todo dia, no worker.
 *
 * **Órfã é a derivada que:**
 * - tem mais de 24 horas: antes disso, a composição pode estar aberta, com a imagem
 *   já enviada e a postagem ainda não salva;
 * - não está em postagem viva — só em descartada, e esse vínculo sai junto;
 * - não é capa;
 * - **não tem derivada dela.** Apagar a mãe antes das filhas faria o `SET NULL`
 *   soltá-las, e elas reapareceriam no acervo. Por isso a limpeza vai das pontas
 *   para dentro: cada volta apaga as pontas, e a mãe vira ponta na seguinte.
 *
 * Original do acervo **nunca** entra: quem a apaga é a pessoa. E a recortada de uma
 * postagem publicada fica, porque `PUBLICADO` segura a mídia (`holdsMedia`).
 */
@Injectable()
export class OrphanDerivativesService {
  private readonly logger = new Logger("Manutenção");

  constructor(
    private readonly prisma: PrismaService,
    private readonly removal: MediaRemovalService,
  ) {}

  async sweep(now: Date): Promise<{ deleted: number; skipped: number }> {
    const limite = new Date(now.getTime() - ORPHAN_GRACE_MS);
    // As que ficaram presas nesta execução: não voltam na próxima consulta.
    const puladas = new Set<string>();
    let apagadas = 0;

    for (let volta = 0; volta < MAX_ROUNDS; volta += 1) {
      const candidatas = await this.prisma.db.media.findMany({
        where: {
          derivedFromId: { not: null },
          createdAt: { lt: limite },
          derivatives: { none: {} },
          coverOfPosts: { none: {} },
          usages: { none: { post: { status: { not: "CANCELED" } } } },
          ...(puladas.size > 0 ? { id: { notIn: [...puladas] } } : {}),
        },
        select: { id: true },
        orderBy: { id: "asc" },
        take: BATCH,
      });
      if (candidatas.length === 0) break;

      /*
       * Uma por uma, e não o lote inteiro: o `remove` é tudo-ou-nada, e uma que
       * alguém anexou entre a consulta e agora derrubaria as outras.
       */
      for (const { id } of candidatas) {
        try {
          apagadas += (await this.removal.remove([id])).deleted;
        } catch (error) {
          if (!(error instanceof MediaInUseError)) throw error;
          puladas.add(id);
        }
      }
    }

    // Só números: o id da mídia não diz nada a quem lê o log, e a chave do objeto nunca vai para ele (ADR 0005).
    if (apagadas > 0 || puladas.size > 0) {
      this.logger.log(`Recortadas órfãs: ${apagadas} apagadas, ${puladas.size} presas no caminho.`);
    }
    return { deleted: apagadas, skipped: puladas.size };
  }
}
