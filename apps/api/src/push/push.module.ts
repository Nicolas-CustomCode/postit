import { Module, type DynamicModule } from "@nestjs/common";
import type { WorkerEnv } from "../config/env";
import { PUSH_CONFIG, pushConfigFrom } from "./push.config";
import { PushDeliveryService } from "./push-delivery.service";
import { PushSender, WebPushSender } from "./push-sender";
import { PushWorker } from "./push.worker";

/**
 * O envio do push (ADR 0017). **Só do worker**: usa a fila e o `web-push`, que o
 * processo HTTP não pode alcançar (AGENTS.md, regra 1) — o `architecture.spec.ts`
 * confere. As rotas de inscrição e preferências moram em `notifications/`, e só
 * gravam no banco.
 */
@Module({})
export class PushModule {
  static forEnv(env: WorkerEnv): DynamicModule {
    return {
      module: PushModule,
      providers: [
        { provide: PUSH_CONFIG, useValue: pushConfigFrom(env) },
        { provide: PushSender, useClass: WebPushSender },
        PushDeliveryService,
        PushWorker,
      ],
    };
  }
}
