import type { PostStatus, PostTrailAction } from "@repo/shared";

/**
 * Que linha de `Aprovacao` uma mudança de status feita por uma pessoa deixa
 * (ADR 0026, decisão 3).
 *
 * `Aprovacao` é o registro de **toda decisão humana de estado** — é dela que a
 * linha do tempo da Revisão conta quem enviou, quem reprovou e por quê, quem
 * agendou para quando. Uma transição sem linha é um buraco na história, e por isso
 * o serviço de escrita pergunta aqui em vez de cada rota lembrar a sua.
 *
 * Devolve `null` para o que não é decisão humana: `PROCESSANDO`, `PUBLICADO` e
 * `FALHOU` são do worker, e o que ele faz vai para `EventoPublicacao`.
 *
 * A invalidação por edição (`INVALIDATED_BY_EDIT`) não passa por aqui: é a mesma
 * transição de "voltar para a composição", com outra causa, e quem sabe a causa é
 * quem escreve.
 */
export function trailActionFor(
  from: PostStatus,
  to: PostStatus,
  options: { readonly reason?: string | null } = {},
): PostTrailAction | null {
  switch (to) {
    case "IN_REVIEW":
      return "SUBMITTED_FOR_REVIEW";
    case "APPROVED":
      // De AGENDADO, é o agendamento que sai; a aprovação já existia.
      return from === "SCHEDULED" ? "UNSCHEDULED" : "APPROVED";
    case "SCHEDULED":
      // Aprovar e agendar é uma decisão só, e a linha diz as duas coisas.
      return from === "IN_REVIEW" ? "APPROVED" : "SCHEDULED";
    case "DRAFT":
      // Reprovar é voltar da revisão com um motivo; sem motivo, é só voltar.
      return from === "IN_REVIEW" && options.reason ? "REJECTED" : "RETURNED_TO_DRAFT";
    case "CANCELED":
      return "CANCELED";
    case "PROCESSING":
    case "PUBLISHED":
    case "FAILED":
      return null;
  }
}
