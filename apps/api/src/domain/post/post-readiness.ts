import {
  captionProblem,
  postMediaCountProblem,
  validateImageFormat,
  type CaptionProblem,
  type ImageFacts,
  type ImageFormat,
  type ImageProblem,
  type MediaCountProblem,
} from "@repo/shared";

/**
 * A postagem está pronta para sair do rascunho? (RF-C01, RF-C03, RF-B03)
 *
 * **Este é o portão de verdade.** A tela avisa antes e a rota de anexar recusa
 * na hora, mas as duas são conveniência: é aqui que se decide se a postagem
 * pode deixar de ser rascunho, e nenhum caminho para `APROVADO` desvia deste
 * ponto.
 *
 * ⚠️ **Os fatos da imagem vêm do registro `Midia`, nunca do que a tela mandou.**
 * As medidas gravadas lá já têm a rotação do EXIF aplicada; aceitar medidas do
 * cliente seria deixá-lo declarar que uma foto em pé é paisagem.
 *
 * É aqui, e não no schema de entrada, que o limite de 2200 caracteres morde: o
 * RF-C03 diz que a legenda longa impede **o agendamento**, não que impede
 * digitar. Recusar no schema faria a pessoa perder o texto ao salvar.
 */
export type PostProblem = MediaCountProblem | CaptionProblem | ImageProblem;

export interface PostReadiness {
  readonly format: ImageFormat;
  readonly caption: string | null;
  readonly media: readonly ImageFacts[];
}

/** O que impede esta postagem de ficar pronta. `null` quando nada impede. */
export function postReadinessProblem(post: PostReadiness): PostProblem | null {
  // A quantidade vem antes da proporção: em Stories, duas imagens 9:16 são as
  // duas válidas e ainda assim a postagem não pode existir. Reclamar da segunda
  // por proporção mandaria trocar a foto, que não é o que resolve.
  const quantidade = postMediaCountProblem(post.format, post.media.length);
  if (quantidade !== null) return quantidade;

  for (const imagem of post.media) {
    const problema = validateImageFormat(imagem, post.format);
    if (problema !== null) return problema;
  }

  return post.caption === null ? null : captionProblem(post.caption);
}

/** Um problema da postagem, com a imagem a que se refere (a partir de 0), quando é de imagem. */
export interface PostProblemAt {
  readonly problem: PostProblem;
  readonly imageIndex: number | null;
}

/**
 * **Todos** os problemas de uma vez, cada um apontando a imagem — o que o assistente
 * precisa para dizer à pessoa o que falta (`conferir_rascunho`, docs/16).
 *
 * Mesmas regras e mesma ordem de `postReadinessProblem`, que para no primeiro: o
 * primeiro desta lista é sempre o que ela devolveria.
 */
export function postProblems(post: PostReadiness): PostProblemAt[] {
  const problemas: PostProblemAt[] = [];

  const quantidade = postMediaCountProblem(post.format, post.media.length);
  if (quantidade !== null) problemas.push({ problem: quantidade, imageIndex: null });

  post.media.forEach((imagem, indice) => {
    const problema = validateImageFormat(imagem, post.format);
    if (problema !== null) problemas.push({ problem: problema, imageIndex: indice });
  });

  const legenda = post.caption === null ? null : captionProblem(post.caption);
  if (legenda !== null) problemas.push({ problem: legenda, imageIndex: null });

  return problemas;
}

/**
 * O problema impede **gravar** a composição, ou só impede a revisão?
 *
 * Postagem sem imagem ainda é rascunho em montagem: nunca barra gravar. A proporção
 * fora do formato **não barra** a postagem que o assistente compôs (ADR 0029): a
 * foto entra marcada para ajuste, e recortar é decisão de quem vê a foto, na tela.
 * Vale pela **origem da postagem**, e não por quem grava — senão a pessoa não
 * conseguiria reordenar na tela o rascunho que o assistente montou.
 *
 * Em tudo, a prontidão continua barrando a revisão.
 */
export function blocksSaving(problem: PostProblem | null, origin: "SCREEN" | "ASSISTANT"): boolean {
  if (problem === null || problem === "POST_MEDIA_REQUIRED") return false;
  if (problem === "MEDIA_RATIO_UNSUPPORTED" && origin === "ASSISTANT") return false;
  return true;
}
