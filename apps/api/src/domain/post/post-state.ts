import type { PostStatus } from "@repo/shared";

/**
 * A máquina de estados da postagem (docs/05, "Máquina de estados da postagem").
 *
 * **O coração do sistema.** Todo comportamento se ancora aqui, e por isso ela é
 * código puro: sem Nest, sem Prisma, sem HTTP. Um erro silencioso nesta tabela
 * custa uma publicação duplicada ou uma postagem que some — e é o tipo de erro
 * que só aparece em produção, de madrugada.
 *
 * ⚠️ **Nenhuma aresta nova foi inventada para a autoaprovação.** Marcar como
 * pronta percorre `RASCUNHO → EM_REVISAO → APROVADO` — as duas transições que o
 * diagrama já tem —, **na mesma transação**, gravando as duas linhas de
 * `Aprovacao`. Nenhuma postagem *persiste* em `EM_REVISAO`, então não existe
 * fila de revisão nesta fase; mas a máquina continua igual ao desenho, a
 * invariante I-1 vale sem asterisco, e a trilha conta a verdade: "Fulano enviou
 * e aprovou às 14h32".
 *
 * Na Fase 4, quando a revisão por terceiro chegar, a mudança é **parar de
 * encadear**. Nenhuma aresta some, nenhum diagrama muda.
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
  SCHEDULED: ["DRAFT", "PROCESSING", "CANCELED", "FAILED"],
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
 * O caminho que "marcar como pronta" percorre, em uma transação só.
 *
 * Duas transições legais encadeadas, em vez de uma aresta inventada de
 * `RASCUNHO` direto para `APROVADO`. Cada passo vira uma linha de `Aprovacao`,
 * e é por isso que a lista está aqui e não escondida no serviço: o domínio é
 * quem sabe qual é o caminho.
 */
export const READY_CHAIN = ["IN_REVIEW", "APPROVED"] as const satisfies readonly PostStatus[];

/** O caminho de `READY_CHAIN` é percorrível a partir daqui? */
export function canMarkReady(from: PostStatus): boolean {
  let atual = from;

  for (const passo of READY_CHAIN) {
    if (!canTransition(atual, passo)) return false;
    atual = passo;
  }

  return true;
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
  return current === "APPROVED" || current === "SCHEDULED" ? "DRAFT" : current;
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
  return status !== "PUBLISHED" && status !== "CANCELED" && status !== "PROCESSING";
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
