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
