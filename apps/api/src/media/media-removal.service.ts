import { Injectable, Logger } from "@nestjs/common";
import { MediaInUseError } from "../common/errors";
import { holdsMedia } from "../domain/post/post-state";
import { PrismaService } from "../prisma/prisma.service";
import { StorageService } from "../storage/storage.service";

/**
 * Apagar mídia de vez: a linha no banco e o arquivo em `publicas/` (RF-B07).
 *
 * **A única exclusão física de conteúdo do sistema**, e por isso num lugar só,
 * usado por dois caminhos: a pessoa excluindo do acervo (processo HTTP) e a
 * limpeza das recortadas órfãs (worker, `OrphanDerivativesService`).
 *
 * ⚠️ **Fora do `MediaModule`, de propósito.** Aquele exige `STATE_SECRET` e
 * registra o controlador HTTP; o worker não tem nem um nem outro. Este depende só
 * de `PrismaService` e `StorageService`, globais nos dois processos — o mesmo
 * arranjo do `InstagramTokenRefreshService`.
 *
 * `Postagem` e `Sessao` usam exclusão lógica; aqui não há volta.
 */
@Injectable()
export class MediaRemovalService {
  private readonly logger = new Logger("Media");

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Apaga as mídias, **todas ou nenhuma**, e devolve quantas saíram.
   *
   * ⚠️ **A linha primeiro, o objeto depois.** O `confirmUpload` já registrou a
   * doutrina inversa: um objeto que falta com a linha presente é *"uma imagem
   * quebrada para sempre"*. Apagar o arquivo antes de a transação fechar
   * reproduz exatamente esse defeito. O banco é a verdade; o bucket segue
   * (regra 8).
   *
   * ⚠️ **Tudo-ou-nada no banco.** Quem chama já sabe quem está preso — o `inUse`
   * da listagem, ou a consulta da limpeza —, então a recusa aqui é corrida ou tela
   * velha, não o caminho normal. Com exclusão parcial, quem pediu dez ficaria com a
   * seleção pela metade e sem saber o que aconteceu. A limpeza, que não quer
   * derrubar o lote por uma presa, chama uma por uma.
   *
   * Id inexistente é ignorado em vez de virar 404: a linha já não está lá, a
   * intenção está cumprida, e a chamada precisa ser idempotente — dois cliques na
   * mesma lixeira não podem virar tela de erro.
   */
  async remove(ids: readonly string[]): Promise<{ deleted: number }> {
    const midias = await this.prisma.db.media.findMany({
      where: { id: { in: [...ids] } },
      select: {
        id: true,
        objectKey: true,
        usages: { select: { post: { select: { status: true } } } },
        /*
         * A capa entra na conferência apesar de nada gravá-la hoje (é de Reels,
         * Fase 2): `capaMidiaId` é `SET NULL`, então no dia em que for gravada a
         * falha não seria um erro — seria um Reels perdendo a capa em silêncio.
         */
        coverOfPosts: { select: { id: true }, take: 1 },
      },
    });

    const presa = midias.some(
      (midia) => midia.usages.some((uso) => holdsMedia(uso.post.status)) || midia.coverOfPosts.length > 0,
    );
    if (presa) throw new MediaInUseError();

    const alvos = midias.map((midia) => midia.id);
    if (alvos.length === 0) return { deleted: 0 };

    try {
      await this.prisma.db.$transaction(async (tx) => {
        /*
         * Na ordem das restrições: `Marcacao` e `PostagemMidia` são as duas
         * RESTRICT. Nada grava `Marcacao` hoje, e é justamente por isso que o
         * caso precisa de teste escrito à mão — senão o 500 só apareceria na
         * Fase 2.
         */
        await tx.userTag.deleteMany({
          where: { postMedia: { mediaId: { in: alvos }, post: { status: "CANCELED" } } },
        });
        /*
         * ⚠️ O filtro por descartada **não** é redundante com a conferência
         * acima: é a segunda camada contra a corrida de alguém anexar a imagem
         * entre uma coisa e outra. Com ele, um vínculo vivo nunca é apagado — e
         * o RESTRICT do banco faz o delete da `Midia` falhar logo em seguida.
         */
        await tx.postMedia.deleteMany({ where: { mediaId: { in: alvos }, post: { status: "CANCELED" } } });
        await tx.media.deleteMany({ where: { id: { in: alvos } } });
      });
    } catch (error) {
      // A chave estrangeira segurou: houve corrida, e nada foi gravado.
      if (isForeignKeyViolation(error)) throw new MediaInUseError();
      throw error;
    }

    /*
     * Só depois do commit, e cada uma por conta própria: uma falha não pode
     * impedir as outras. E a chamada **não** falha por isto — a intenção já foi
     * cumprida, a linha não volta, e repetir não ajudaria.
     */
    for (const midia of midias) {
      await this.storage.removePublic(midia.objectKey).catch(() => {
        // O id, nunca a chave: em `publicas/` a URL imprevisível é a proteção
        // (ADR 0005), e um log com a chave publicaria o que sobrou.
        this.logger.warn(`Mídia ${midia.id} saiu do banco, mas o objeto ficou em publicas/.`);
      });
    }

    return { deleted: alvos.length };
  }
}

/**
 * O Postgres recusou por chave estrangeira?
 *
 * Confere só o código, sem importar o tipo de erro do Prisma: a forma do objeto
 * é estável e o import traria o client gerado para dentro de uma regra que só
 * precisa de uma string.
 */
function isForeignKeyViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2003";
}
