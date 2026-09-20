import { z } from "zod";
import { ALT_TEXT_MAX_LENGTH } from "./media-types";

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

export const createPostSchema = z.strictObject({
  // Nesta fase só existe imagem de feed; os outros formatos chegam na Fase 2.
  format: z.literal("FEED_IMAGE"),
  caption: z.string().max(CAPTION_SANITY_LIMIT).nullish(),
});

export const setCaptionSchema = z.strictObject({
  version,
  caption: z.string().max(CAPTION_SANITY_LIMIT).nullable(),
});

export const setPostMediaSchema = z.strictObject({
  version,
  mediaId: z.string().uuid(),
  altText: z.string().max(ALT_TEXT_MAX_LENGTH).nullish(),
});

/** Marcar como pronta e descartar não mudam conteúdo — só a versão viaja. */
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

export type SchedulePostInput = z.infer<typeof schedulePostSchema>;

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type SetCaptionInput = z.infer<typeof setCaptionSchema>;
export type SetPostMediaInput = z.infer<typeof setPostMediaSchema>;
