import { Module } from "@nestjs/common";
import { MediaRemovalService } from "./media-removal.service";

/**
 * A exclusão de mídia, para quem precisa dela sem o resto do `MediaModule`: o
 * acervo (processo HTTP) e a limpeza das recortadas órfãs (worker).
 *
 * Sem `forEnv`: não lê variável nenhuma. `PrismaService` e `StorageService` vêm
 * dos módulos globais que os dois processos já importam.
 */
@Module({
  providers: [MediaRemovalService],
  exports: [MediaRemovalService],
})
export class MediaRemovalModule {}
