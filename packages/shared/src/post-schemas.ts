import { z } from "zod";
import { ALT_TEXT_MAX_LENGTH } from "./media-types";
import { POST_MEDIA_MAX } from "./post-formats";

/**
 * O que a API aceita ao compor uma postagem (RF-C01, RF-C03, RF-C12).
 *
 * ⚠️ **Um schema por intenção, e não um `update` que aceita tudo.** Com um
 * schema gordo, "este campo é conteúdo?" — a pergunta de que a invariante I-2
 * depende — viraria um `if` em tempo de execução que alguém esqueceria de
 * atualizar ao acrescentar um campo. Separados, a resposta é uma propriedade do
 * **tipo**: a rota de legenda mexe em conteúdo, ponto.
 *
 * ⚠️ **O limite de 2200 caracteres não está aqui.** O RF-C03 diz que a legenda
 * fora do limite impede **o agendamento**, não que impede digitar — recusar no
 * schema faria a pessoa perder o texto ao salvar um rascunho. Quem aplica o
 * limite é `postReadinessProblem()`, no momento de marcar como pronta. O teto
 * abaixo é só sanidade, para o corpo da requisição não virar negação de serviço.
 */

/** Bem acima dos 2200 da Meta: aqui só se impede abuso, não se valida regra. */
const CAPTION_SANITY_LIMIT = 8000;

/**
 * A versão que a tela carregou, devolvida em toda escrita (RF-C12). É ela que
 * faz a API recusar com 409 quando outra pessoa salvou no meio.
 */
const version = z.number().int().min(1);

/**
 * Os formatos que a composição oferece hoje: os dois de **imagem**.
 *
 * Reels exige o validador de vídeo — Fase 2. A tela o mostra apagado, com o
 * rótulo da fase, em vez de escondê-lo: saber que existe e quando chega é
 * informação útil.
 */
export const COMPOSABLE_FORMATS = ["FEED", "STORIES"] as const;
export type ComposableFormat = (typeof COMPOSABLE_FORMATS)[number];

export const createPostSchema = z.strictObject({
  format: z.enum(COMPOSABLE_FORMATS),
  caption: z.string().max(CAPTION_SANITY_LIMIT).nullish(),
});

/**
 * Trocar o formato **é mudança de conteúdo** (RF-E05, que cita formato com todas
 * as letras): derruba para rascunho e revalida a imagem já anexada, porque uma
 * arte 9:16 serve a Stories e não ao feed.
 */
export const setPostFormatSchema = z.strictObject({
  version,
  format: z.enum(COMPOSABLE_FORMATS),
});

export const setCaptionSchema = z.strictObject({
  version,
  caption: z.string().max(CAPTION_SANITY_LIMIT).nullable(),
});

/** Uma mídia da postagem. O `altText` é por imagem — a Meta o recebe em cada filho. */
const postMediaItemSchema = z.strictObject({
  mediaId: z.string().uuid(),
  altText: z.string().max(ALT_TEXT_MAX_LENGTH).nullish(),
});

/**
 * A lista **inteira, na ordem final** — não um acréscimo. Trocar, reordenar e
 * remover são a mesma chamada, e nenhuma rota nova nasce para isso.
 *
 * ⚠️ **A posição vem do índice no array**, nunca de um campo que a tela mandaria.
 * Um índice explícito abriria a porta para lista com buraco, repetida ou fora de
 * ordem, e o banco tem unicidade de `(postagemId, ordem)`: o erro sairia como
 * violação de restrição, não como regra.
 *
 * ⚠️ **Lista vazia é aceita**, e significa "tirei todas". Mesmo raciocínio de
 * `caption: null`: o schema não impede salvar rascunho incompleto — quem impede
 * a postagem ficar **pronta** é `postReadinessProblem()`.
 *
 * ⚠️ **Repetida é aceita.** Nada na documentação da Meta proíbe a mesma imagem
 * duas vezes num carrossel, e `PostagemMidia` só tem unicidade de posição.
 * Recusar seria inventar regra sem fonte.
 */
export const setPostMediaSchema = z.strictObject({
  version,
  media: z.array(postMediaItemSchema).max(POST_MEDIA_MAX),
});

/** Enviar, aprovar, voltar para a composição e descartar não mudam conteúdo — só a versão viaja. */
export const postVersionSchema = z.strictObject({ version });

/**
 * Agendar: **campos civis, não instante** (RF-D01; ADR 0006).
 *
 * ⚠️ A tela manda o dia e a hora que a pessoa escolheu, e a **API** converte
 * usando o fuso da conta. Mandar um instante pronto significaria confiar na
 * conversão feita no navegador — e é justamente ali que o fuso do aparelho
 * entraria por engano, dando o horário certo em Lisboa e errado no Brasil.
 *
 * Sem segundos na hora: é o que `<input type="time">` entrega.
 */
export const schedulePostSchema = z.strictObject({
  version,
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

/** Teto do motivo da reprovação: um recado para quem vai corrigir, não um relatório. */
export const REJECTION_REASON_MAX_LENGTH = 1000;
/** Teto de um comentário interno. */
export const COMMENT_MAX_LENGTH = 2000;

/**
 * Reprovar exige motivo (RF-E03): quem recebe a postagem de volta precisa saber o
 * que ajustar. O `trim` vem antes do mínimo — um motivo só de espaços não diz nada.
 */
export const rejectPostSchema = z.strictObject({
  version,
  reason: z.string().trim().min(1).max(REJECTION_REASON_MAX_LENGTH),
});

/**
 * Um comentário interno (RF-E04). **Sem `version`**: comentar não escreve em
 * `Postagem` — não muda status nem conteúdo, e não pode disputar com quem edita.
 */
export const createCommentSchema = z.strictObject({
  text: z.string().trim().min(1).max(COMMENT_MAX_LENGTH),
});

export type RejectPostInput = z.infer<typeof rejectPostSchema>;
export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type SchedulePostInput = z.infer<typeof schedulePostSchema>;
export type SetPostFormatInput = z.infer<typeof setPostFormatSchema>;

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type SetCaptionInput = z.infer<typeof setCaptionSchema>;
export type SetPostMediaInput = z.infer<typeof setPostMediaSchema>;
