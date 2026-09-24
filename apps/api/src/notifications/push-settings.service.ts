import { Injectable } from "@nestjs/common";
import {
  describeDevice,
  PUSH_NOTIFICATION_TYPES,
  type PushPreference,
  type PushPreferenceInput,
  type PushSubscriptionInput,
} from "@repo/shared";
import { NotificationNotFoundError } from "../common/errors";
import { PrismaService } from "../prisma/prisma.service";

/**
 * O que cada pessoa decide sobre o próprio push (RF-J02, RF-J04; ADR 0017): em
 * que aparelhos recebe e de que tipos.
 *
 * Só o processo HTTP, e sem enviar nada: quem envia é o worker (regra 1). O
 * push de teste aqui é só um pedido gravado na inscrição, que a varredura do
 * worker atende em segundos.
 *
 * ⚠️ **O `endpoint` é segredo** (regra 3): com ele, qualquer um manda push para o
 * aparelho. Nunca vai para log nem volta em resposta.
 */
@Injectable()
export class PushSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Os quatro tipos, cada um com o que a pessoa escolheu. Sem linha, vale ligado. */
  async preferences(userId: string): Promise<PushPreference[]> {
    const linhas = await this.prisma.db.notificationPreference.findMany({
      where: { userId },
      select: { type: true, push: true },
    });
    const escolha = new Map(linhas.map((linha) => [linha.type, linha.push]));
    return PUSH_NOTIFICATION_TYPES.map((type) => ({ type, push: escolha.get(type) ?? true }));
  }

  async setPreference(userId: string, input: PushPreferenceInput): Promise<PushPreference[]> {
    await this.prisma.db.notificationPreference.upsert({
      where: { userId_type: { userId, type: input.type } },
      create: { userId, type: input.type, push: input.push },
      update: { push: input.push },
    });
    return this.preferences(userId);
  }

  /**
   * Inscreve este aparelho, preso à **sessão atual**: saiu do PostIt ou revogou o
   * aparelho, o worker apaga a inscrição sem enviar (decidido em 24/09/2026).
   *
   * Pelo `endpoint`, que é único por navegador: o mesmo navegador com outra pessoa
   * logada passa a inscrição para quem entrou — o aparelho é de quem está nele. As
   * falhas zeram, porque a inscrição acabou de ser confirmada pelo navegador.
   */
  async subscribe(userId: string, sessionId: string, input: PushSubscriptionInput): Promise<void> {
    const sessao = await this.prisma.db.session.findUniqueOrThrow({
      where: { id: sessionId },
      select: { userAgent: true },
    });
    const dados = {
      userId,
      sessionId,
      p256dhKey: input.keys.p256dh,
      authKey: input.keys.auth,
      device: describeDevice(sessao.userAgent).label,
      consecutiveFailures: 0,
    };

    await this.prisma.db.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { endpoint: input.endpoint, ...dados },
      update: dados,
    });
  }

  /** Desativa neste aparelho. Idempotente: a de outra pessoa ou a que já não existe não muda nada. */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.db.pushSubscription.deleteMany({ where: { endpoint, userId } });
  }

  /** Pede um push de teste para este aparelho; o worker envia na próxima varredura. */
  async requestTest(userId: string, endpoint: string, now: Date): Promise<void> {
    const { count } = await this.prisma.db.pushSubscription.updateMany({
      where: { endpoint, userId },
      data: { testRequestedAt: now },
    });
    // Mesmo 404 do aviso alheio: dizer "existe, mas não é sua" entregaria o aparelho.
    if (count === 0) throw new NotificationNotFoundError();
  }
}
