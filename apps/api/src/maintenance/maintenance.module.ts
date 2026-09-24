import { Module } from "@nestjs/common";
import { MediaRemovalModule } from "../media/media-removal.module";
import { OrphanDerivativesService } from "../media/orphan-derivatives.service";
import { MaintenanceWorker } from "./maintenance.worker";

/**
 * A faxina diária do worker (docs/09, `manutencao`).
 *
 * ⚠️ **Só do worker**, como o `PublishingModule`: o `MaintenanceWorker` usa o
 * `BossService`, que o processo HTTP não pode alcançar (AGENTS.md, regra 1). Por
 * isso a ponta da fila mora aqui, e não em `media/` — que o processo HTTP importa.
 * O serviço de limpeza fica em `media/`, perto da regra de mídia que ele aplica.
 */
@Module({
  imports: [MediaRemovalModule],
  providers: [OrphanDerivativesService, MaintenanceWorker],
})
export class MaintenanceModule {}
