import type { Prisma } from "@repo/database";
import { recipientsFor, type Notice } from "../domain/notifications/recipients";

/**
 * Grava um aviso do sino (RF-J01, RF-J03): a `Notificacao` e uma
 * `NotificacaoEntrega` por destinatário.
 *
 * **Sempre dentro da transação da mudança que o causou** (AGENTS.md, regra 8): a
 * falha, a perda de acesso, o envio para revisão, a reprovação. Desfeita a
 * mudança — conflito de versão, cerca que não deixou —, o aviso some junto; um
 * aviso de algo que não aconteceu é pior que aviso nenhum.
 *
 * Função, e não serviço do Nest: depende só da transação, e é chamada dos dois
 * processos e do CLI. **Não enfileira nada** — o processo HTTP não tem fila
 * (regra 1). O push (parte H) varre as entregas com `pushEnviadoEm` nulo.
 *
 * Guarda só tipo e alvo: a frase é montada na leitura, com os dados de agora
 * (docs/07).
 */
export interface NoticeTarget {
  readonly type: "POST" | "ACCOUNT";
  readonly id: string;
}

/** Quantas pessoas receberam. Zero não grava nada: aviso sem destinatário não existe. */
export async function recordNotice(
  tx: Prisma.TransactionClient,
  target: NoticeTarget,
  notice: Notice,
): Promise<number> {
  // Todos os ativos: é um cliente só, com poucas pessoas, e a regra precisa das
  // permissões de agora (RF-J03).
  const ativos = await tx.user.findMany({
    where: { deactivatedAt: null },
    select: { id: true, superAdmin: true, permissions: { select: { permission: true } } },
  });

  const ids = recipientsFor(
    notice,
    ativos.map((user) => ({
      id: user.id,
      superAdmin: user.superAdmin,
      permissions: user.permissions.map((linha) => linha.permission),
    })),
  );
  if (ids.length === 0) return 0;

  await tx.notification.create({
    data: {
      type: notice.type,
      targetType: target.type,
      targetId: target.id,
      deliveries: { createMany: { data: ids.map((userId) => ({ userId })) } },
    },
  });
  return ids.length;
}
