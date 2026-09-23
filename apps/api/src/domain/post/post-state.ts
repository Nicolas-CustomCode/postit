import { isPostEditable, type PostStatus } from "@repo/shared";

/**
 * A máquina de estados da postagem (docs/05, "Máquina de estados da postagem").
 *
 * **O coração do sistema.** Todo comportamento se ancora aqui, e por isso ela é
 * código puro: sem Nest, sem Prisma, sem HTTP. Um erro silencioso nesta tabela
 * custa uma publicação duplicada ou uma postagem que some — e é o tipo de erro
 * que só aparece em produção, de madrugada.
 *
 * Na Fase 1, "Marcar como pronta" encadeava `RASCUNHO → EM_REVISAO → APROVADO`
 * numa transação. Desde a 1e (ADR 0026) enviar e aprovar são decisões
 * separadas, e a única cadeia que sobrou é "aprovar e agendar" — de novo com as
 * transições que o diagrama já tem, sem aresta inventada.
 */

/**
 * Para onde cada estado pode ir. É a tradução direta do diagrama do docs/05 —
 * quem mexer aqui precisa mexer lá, e vice-versa.
 */
const TRANSITIONS: Record<PostStatus, readonly PostStatus[]> = {
  DRAFT: ["IN_REVIEW", "CANCELED"],
  IN_REVIEW: ["DRAFT", "APPROVED"],
  // I-1: é daqui, e só daqui, que se chega a AGENDADO.
  APPROVED: ["SCHEDULED", "DRAFT"],
  // → APROVADO é cancelar o agendamento: a aprovação continua, só o horário sai
  // (ADR 0026). I-1 não muda — é de APROVADO que se chega aqui, não o contrário.
  SCHEDULED: ["DRAFT", "APPROVED", "PROCESSING", "CANCELED", "FAILED"],
  // O laço PROCESSANDO → PROCESSANDO é a nova tentativa depois de erro
  // recuperável: o status não muda, então não é transição.
  PROCESSING: ["PUBLISHED", "FAILED"],
  // I-4: só ação humana tira daqui. O worker nunca reagenda sozinho.
  FAILED: ["SCHEDULED", "DRAFT", "CANCELED"],
  // I-3: terminal e irreversível. A API da Meta não apaga posts.
  PUBLISHED: [],
  CANCELED: [],
};

export function canTransition(from: PostStatus, to: PostStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * O caminho de "aprovar e agendar" (ADR 0026): uma decisão, duas transições
 * legais, **uma transação** — nenhuma aresta
 * `EM_REVISAO → AGENDADO` inventada; a I-1 continua dizendo que só se agenda o que
 * foi aprovado, e aqui a aprovação acontece de fato, no mesmo instante.
 */
export const APPROVE_AND_SCHEDULE = ["APPROVED", "SCHEDULED"] as const satisfies readonly PostStatus[];

/**
 * Dá para aprovar e agendar a partir daqui?
 *
 * ⚠️ **Só de `EM_REVISAO`, e não "de onde o caminho for percorrível".** Com a
 * aresta `AGENDADO → APROVADO`, o caminho também se percorre a partir de `AGENDADO`
 * (→ APROVADO → AGENDADO) — e "aprovar" uma postagem que já estava aprovada
 * gravaria uma aprovação que ninguém deu. O teste da matriz pegou isso.
 */
export function canApproveAndSchedule(from: PostStatus): boolean {
  if (from !== "IN_REVIEW") return false;
  let atual: PostStatus = from;

  for (const passo of APPROVE_AND_SCHEDULE) {
    if (!canTransition(atual, passo)) return false;
    atual = passo;
  }

  return true;
}

/**
 * "Voltar para a composição" (ADR 0026): a porta explícita para editar uma postagem
 * que já saiu do rascunho.
 *
 * ⚠️ **Lista literal, e `FALHOU` fica de fora de propósito**, embora a aresta
 * `FALHOU → RASCUNHO` exista. São duas portas para a mesma aresta com permissões
 * diferentes — esta é `POSTAGEM_EDITAR`; decidir sobre falha é `POSTAGEM_AGENDAR`
 * (ADR 0015) e tem rota própria. Mesmo raciocínio de `canCancel` × descartar.
 */
const REOPENABLE: readonly PostStatus[] = ["IN_REVIEW", "APPROVED", "SCHEDULED"];

export function canReopen(status: PostStatus): boolean {
  return REOPENABLE.includes(status);
}

/** Cancelar o agendamento sem perder a aprovação: só de `AGENDADO` (ADR 0026). */
export function canUnschedule(status: PostStatus): boolean {
  return status === "SCHEDULED";
}

/**
 * O status que uma postagem assume depois de alguém **editar o conteúdo** dela
 * — legenda, mídia ou texto alternativo.
 *
 * ⚠️ **É a invariante I-2, e ela existe para impedir um acidente específico:**
 * aprovar uma coisa e publicar outra. Quem aprovou olhou uma legenda; se a
 * legenda mudar depois sem derrubar a aprovação, vai ao ar algo que ninguém
 * aprovou (RF-E05).
 *
 * Por isso esta função é o **único** lugar que decide isso, e o serviço de
 * escrita passa por ela sempre — em vez de cada rota lembrar de aplicar a regra.
 */
export function statusAfterContentEdit(current: PostStatus): PostStatus {
  /*
   * `FALHOU` também cai, desde 23/09/2026 (decisão 3 da 1d). Quem corrige uma
   * postagem que falhou está mudando o que vai ao ar — e o que foi aprovado era a
   * versão que falhou. Sem cair, bastava editar e reagendar para publicar algo que
   * ninguém aprovou.
   *
   * `EM_REVISAO` também, desde a 1e (ADR 0026: só se edita em rascunho). Sem cair,
   * quem tem `POSTAGEM_APROVAR` reescreveria a postagem de um colega em revisão e a
   * aprovaria em seguida — a autoaprovação só olha quem criou —, e a edição não
   * deixaria rastro na linha do tempo. Revisão que muda de conteúdo volta a ser
   * rascunho, e precisa ser enviada de novo.
   */
  return current === "IN_REVIEW" || current === "APPROVED" || current === "SCHEDULED" || current === "FAILED"
    ? "DRAFT"
    : current;
}

/**
 * O horário marcado sobrevive à mudança para este estado?
 *
 * ⚠️ **Volta a ser editável, o horário some.** Uma postagem que caiu para
 * rascunho não pode continuar exibindo horário de saída: a invariante I-2 existe
 * para tornar visível que a aprovação morreu, e um horário sobrevivente diria o
 * contrário **no campo que a pessoa foi conferir**. Ela fecharia o navegador
 * achando que a postagem sai sexta às 10:00, e não sairia.
 *
 * O que a pessoa digitou não se perde — a tela mantém os campos preenchidos e
 * oferece reagendar num clique. Mas o banco não guarda horário que não vai
 * cumprir.
 *
 * `PROCESSANDO`, `PUBLICADO` e `FALHOU` guardam: é contra `publicarEm` que a
 * invariante I-8 mede o atraso. `CANCELADO` guarda porque é história.
 */
export function keepsSchedule(next: PostStatus): boolean {
  return next !== "DRAFT" && next !== "IN_REVIEW" && next !== "APPROVED";
}

/**
 * Dá para editar o conteúdo de uma postagem neste estado?
 *
 * `PUBLICADO` e `CANCELADO` são terminais (I-3). `PROCESSANDO` está no meio de
 * uma publicação: mudar a legenda agora significaria publicar uma coisa e
 * guardar outra.
 */
export function isEditable(status: PostStatus): boolean {
  // A mesma lista com que a tela decide abrir só para ver: as duas não podem divergir.
  return isPostEditable(status);
}

/**
 * Esta postagem ainda segura a mídia que usa (RF-B07)?
 *
 * **Tudo menos `CANCELADO`.** `PUBLICADO` segura de propósito: o histórico não
 * se apaga, e a imagem de um post que foi ao ar não é rascunho de ninguém. As
 * vivas seguram porque ainda vão ao ar. `CANCELADO` solta — é o único estado
 * terminal que não deixou marca no mundo, e sem ele a mídia de um rascunho
 * descartado ficaria refém para sempre: `discard()` não apaga o vínculo.
 *
 * ⚠️ **Não use `isEditable` aqui.** Ela exclui `PROCESSANDO`, e uma postagem em
 * processamento é justamente a que mais segura a mídia — o worker está subindo
 * o arquivo naquele instante.
 */
export function holdsMedia(status: PostStatus): boolean {
  return status !== "CANCELED";
}
