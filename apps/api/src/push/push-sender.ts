import { Inject, Injectable } from "@nestjs/common";
import type { PushPayload } from "@repo/shared";
import * as webpush from "web-push";
import { PUSH_CONFIG, type PushConfig } from "./push.config";

/** O que o serviço de push do navegador respondeu. */
export type PushOutcome = "ok" | "gone" | "failed";

export interface PushTarget {
  readonly endpoint: string;
  readonly p256dhKey: string;
  readonly authKey: string;
}

/**
 * A porta do envio: o resto do worker não conhece o `web-push`, e o teste troca o
 * adaptador por um roteirizado — como a Meta falsa, sem rede.
 */
export abstract class PushSender {
  abstract send(target: PushTarget, payload: PushPayload): Promise<PushOutcome>;
}

/** Uma hora: aviso que não chegou nesse prazo já não serve, e o serviço pode descartá-lo. */
const TTL_SECONDS = 60 * 60;

/**
 * O adaptador de verdade (ADR 0017): cifra o payload com as chaves do navegador e
 * assina com o par VAPID.
 *
 * `gone` é 404 ou 410 — o serviço diz que a inscrição não existe mais, e ela é
 * apagada. Qualquer outra recusa, ou erro de rede, é `failed`: pode ser passageiro,
 * e quem decide apagar depois de várias seguidas é quem chama.
 *
 * ⚠️ **Nada daqui vai para log** (regra 3): o erro do `web-push` carrega o
 * `endpoint`, que é o segredo da inscrição.
 */
@Injectable()
export class WebPushSender extends PushSender {
  constructor(@Inject(PUSH_CONFIG) private readonly config: PushConfig) {
    super();
  }

  async send(target: PushTarget, payload: PushPayload): Promise<PushOutcome> {
    const vapid = this.config.vapid;
    if (vapid === null) return "failed";

    try {
      await webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dhKey, auth: target.authKey } },
        // Exatamente título e link (regra 22): nada além do que o contrato montou.
        JSON.stringify({ title: payload.title, url: payload.url }),
        {
          vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
          TTL: TTL_SECONDS,
          urgency: "high",
          timeout: 10_000,
        },
      );
      return "ok";
    } catch (error) {
      if (error instanceof webpush.WebPushError &&(error.statusCode === 404 || error.statusCode === 410)) return "gone";
      return "failed";
    }
  }
}
