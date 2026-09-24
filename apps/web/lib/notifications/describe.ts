import type { NotificationItem } from "@repo/shared";
import { civilFieldsFor } from "@/components/account-time";

/**
 * A frase de cada aviso do sino e para onde ele leva (RF-J01; docs/04, 11.3).
 *
 * Montada aqui, com os dados de agora, porque o banco guarda só tipo e alvo
 * (docs/07). O horário sai no fuso **da conta**, como em toda tela de postagem
 * (ADR 0006; AGENTS.md, regra 7).
 *
 * Alvo que sumiu não quebra a lista: a frase diz isso, e a linha leva ao próprio
 * sino em vez de a uma página 404.
 */
export interface NotificationView {
  readonly text: string;
  readonly href: string;
}

export function describeNotification(item: NotificationItem): NotificationView {
  const conta = item.account === null ? null : `@${item.account.username}`;
  const postagem =
    item.post === null || item.account === null ? null : `/c/${item.account.username}/postagens/${item.post.id}`;

  switch (item.type) {
    case "ACCOUNT_ACCESS_LOST":
      return conta === null
        ? { text: "Uma conta que não existe mais perdeu o acesso ao Instagram.", href: "/notificacoes" }
        : { text: `${conta} perdeu o acesso ao Instagram — reconecte para voltar a publicar.`, href: "/contas" };

    case "PUBLISH_FAILED": {
      if (postagem === null || item.account === null) return semPostagem;
      const quando = horario(item.post?.scheduledAt ?? null, item.account.timezone);
      return {
        text: quando === null ? `Uma publicação em ${conta} falhou.` : `A publicação de ${quando} em ${conta} falhou.`,
        href: postagem,
      };
    }

    case "AWAITING_APPROVAL":
      return postagem === null ? semPostagem : { text: `Uma postagem de ${conta} aguarda aprovação.`, href: postagem };

    case "POST_REJECTED":
      return postagem === null
        ? semPostagem
        : { text: `Uma postagem de ${conta} foi reprovada — o motivo está na composição.`, href: postagem };

    // Tipos que ainda não geram aviso (docs/12): sem frase própria, mas sem quebrar.
    default:
      return { text: "Um aviso do sistema.", href: postagem ?? "/notificacoes" };
  }
}

const semPostagem: NotificationView = { text: "Esta postagem não existe mais.", href: "/notificacoes" };

/** "24/09 às 14:00", no fuso da conta. */
function horario(iso: string | null, timeZone: string): string | null {
  const { day, time } = civilFieldsFor(iso, timeZone);
  if (day === "") return null;
  const [, mes, dia] = day.split("-");
  return `${dia}/${mes} às ${time}`;
}
