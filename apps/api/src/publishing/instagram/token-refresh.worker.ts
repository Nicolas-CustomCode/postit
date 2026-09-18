import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { InstagramUnavailableError } from "../../common/errors";
import { InstagramTokenRefreshService } from "../../instagram/token-refresh.service";
import { BossService } from "../../queues/boss.service";
import { TOKEN_REFRESH_QUEUE } from "../../queues/queue-names";

/**
 * Liga a fila `renovar-tokens-instagram` ao serviço que faz o trabalho.
 *
 * É só a ponta: toda a regra mora no `InstagramTokenRefreshService`, que fica no
 * `InstagramModule` porque o comando `admin:refresh-tokens` também precisa dele
 * e o CLI não pode importar `publishing/` (AGENTS.md, regra 1).
 *
 * **É aqui que se decide repetir.** O serviço nunca lança: devolve o que
 * aconteceu, e o contrato do pg-boss — erro lançado quer dizer "tente de novo"
 * (docs/09) — é conhecimento desta camada, não dele. Falha fatal não sobe:
 * acesso revogado não melhora na terceira tentativa, e já ficou em `EventoToken`.
 */
@Injectable()
export class TokenRefreshWorker implements OnModuleInit {
  private readonly logger = new Logger("Filas");

  constructor(
    private readonly queues: BossService,
    private readonly refresh: InstagramTokenRefreshService,
  ) {}

  async onModuleInit(): Promise<void> {
    // O pg-boss entrega as tarefas em lista; com o lote padrão vem uma só. Esta
    // tarefa não carrega dado nenhum: ela mesma descobre quais contas renovar.
    await this.queues.boss.work(TOKEN_REFRESH_QUEUE, async () => {
      const resultado = await this.refresh.refreshDue(new Date());

      if (resultado.recoverable > 0) {
        throw new InstagramUnavailableError();
      }
    });

    this.logger.log(`Ouvindo a fila ${TOKEN_REFRESH_QUEUE}.`);
  }
}
