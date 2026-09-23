import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import {
  createPostSchema,
  postVersionSchema,
  rejectPostSchema,
  schedulePostSchema,
  setPostFormatSchema,
  setCaptionSchema,
  setPostMediaSchema,
  type CreatePostInput,
  type PostDetail,
  type PostHistoryEntry,
  type PostSummary,
  type RejectPostInput,
  type SchedulePostInput,
  type SetPostFormatInput,
  type SetCaptionInput,
  type SetPostMediaInput,
} from "@repo/shared";
import { AnyAuthenticated, RequirePermission } from "../authorization/policy.decorators";
import { Auth } from "../auth/auth.decorators";
import type { AuthContext } from "../auth/session.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PostsDomainService } from "./posts.domain.service";
import { PostsQueryService } from "./posts.query.service";

/**
 * As postagens de uma conta.
 *
 * ⚠️ **A conta está no caminho de todas as rotas**, nunca num filtro opcional.
 * A regra 24 exige que a API confira que a postagem pertence à conta pedida;
 * como parâmetro de caminho é obrigatório, não existe rota aqui que possa
 * esquecê-lo. Um teste de integração varre as rotas descobertas e exige 404
 * quando a postagem é de outra conta — rota nova sem linha nesse teste reprova a
 * CI.
 *
 * ⚠️ **Tudo que escreve é `POST`, inclusive o que pareceria `PATCH`.** O
 * `apiFetch` do Next só conhece `GET` e `POST`, e o projeto já resolve isso com
 * caminho-verbo (`POST /auth/sessions/:id/revoke`). Estender o cliente só por
 * estética REST não pagaria o risco.
 *
 * Leitura é `@AnyAuthenticated`; **toda ação** exige permissão do catálogo
 * (regra 5).
 */
@Controller("accounts/:accountId/posts")
export class PostsController {
  constructor(
    private readonly posts: PostsQueryService,
    private readonly composition: PostsDomainService,
  ) {}

  @AnyAuthenticated()
  @Get()
  list(@Param("accountId") accountId: string): Promise<PostSummary[]> {
    return this.posts.list(accountId);
  }

  @AnyAuthenticated()
  @Get(":postId")
  detail(@Param("accountId") accountId: string, @Param("postId") postId: string): Promise<PostDetail> {
    return this.posts.detail(accountId, postId);
  }

  @RequirePermission("POST_EDIT")
  @Post()
  create(
    @Param("accountId") accountId: string,
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(createPostSchema)) body: CreatePostInput,
  ): Promise<{ id: string }> {
    return this.composition.create({
      accountId,
      userId: auth.userId,
      format: body.format,
      caption: body.caption ?? null,
    });
  }

  @RequirePermission("POST_EDIT")
  @Post(":postId/caption")
  @HttpCode(200)
  setCaption(
    @Param("accountId") accountId: string,
    @Param("postId") postId: string,
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(setCaptionSchema)) body: SetCaptionInput,
  ): Promise<{ version: number }> {
    return this.composition.setCaption({
      accountId,
      postId,
      userId: auth.userId,
      version: body.version,
      caption: body.caption,
    });
  }

  @RequirePermission("POST_EDIT")
  @Post(":postId/media")
  @HttpCode(200)
  setMedia(
    @Param("accountId") accountId: string,
    @Param("postId") postId: string,
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(setPostMediaSchema)) body: SetPostMediaInput,
  ): Promise<{ version: number }> {
    return this.composition.setMedia({
      accountId,
      postId,
      userId: auth.userId,
      version: body.version,
      media: body.media.map((item) => ({ mediaId: item.mediaId, altText: item.altText ?? null })),
    });
  }

  /**
   * Trocar o formato de destino (RF-C02).
   *
   * É `POST_EDIT` e não uma permissão nova: formato é conteúdo, como legenda e
   * mídia — o RF-E05 o cita com todas as letras.
   */
  @RequirePermission("POST_EDIT")
  @Post(":postId/format")
  @HttpCode(200)
  setFormat(
    @Param("accountId") accountId: string,
    @Param("postId") postId: string,
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(setPostFormatSchema)) body: SetPostFormatInput,
  ): Promise<{ version: number }> {
    return this.composition.setFormat({
      accountId,
      postId,
      userId: auth.userId,
      version: body.version,
      format: body.format,
    });
  }

  /**
   * ⚠️ **`POST_APPROVE` sozinho no decorator, de propósito.** O guard usa
   * `every()`: declarar `POST_APPROVE_OWN` junto passaria a exigi-la também de
   * quem aprova postagem alheia. E o guard roda antes de a postagem ser
   * carregada — não tem como saber quem é o autor. Quem cobra a segunda
   * permissão é o serviço (AGENTS.md, regra 17).
   */
  @RequirePermission("POST_APPROVE")
  @Post(":postId/ready")
  @HttpCode(200)
  markReady(
    @Param("accountId") accountId: string,
    @Param("postId") postId: string,
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(postVersionSchema)) body: { version: number },
  ): Promise<{ version: number }> {
    return this.composition.markReady({
      accountId,
      postId,
      userId: auth.userId,
      version: body.version,
      approver: approverOf(auth),
    });
  }

  /** Enviar para revisão (RF-E01). É de quem edita: quem escreveu pede o olhar de outro. */
  @RequirePermission("POST_EDIT")
  @Post(":postId/submit")
  @HttpCode(200)
  submit(
    @Param("accountId") accountId: string,
    @Param("postId") postId: string,
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(postVersionSchema)) body: { version: number },
  ): Promise<{ version: number }> {
    return this.composition.submit({ accountId, postId, userId: auth.userId, version: body.version });
  }

  /**
   * Aprovar sem agendar (RF-E02): a postagem fica "aprovada, falta agendar" até
   * alguém com `POST_SCHEDULE` escolher o horário. É a rota de quem aprova e não
   * agenda.
   *
   * ⚠️ **`POST_APPROVE` sozinho no decorator, de propósito** — o mesmo motivo de
   * `ready`: a autoaprovação depende do autor, e quem cobra é o serviço.
   */
  @RequirePermission("POST_APPROVE")
  @Post(":postId/approve")
  @HttpCode(200)
  approve(
    @Param("accountId") accountId: string,
    @Param("postId") postId: string,
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(postVersionSchema)) body: { version: number },
  ): Promise<{ version: number }> {
    return this.composition.approve({
      accountId,
      postId,
      userId: auth.userId,
      version: body.version,
      approver: approverOf(auth),
    });
  }

  /**
   * Aprovar e agendar, numa decisão só (ADR 0026).
   *
   * ⚠️ **Rota própria, e não um "agenda se puder" dentro de `approve`.** O guard
   * exige *todas* as permissões listadas — que é exatamente o que esta ação pede —,
   * e a política continua estática, conferível pelo teste de política de rotas.
   */
  @RequirePermission("POST_APPROVE", "POST_SCHEDULE")
  @Post(":postId/approve-and-schedule")
  @HttpCode(200)
  approveAndSchedule(
    @Param("accountId") accountId: string,
    @Param("postId") postId: string,
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(schedulePostSchema)) body: SchedulePostInput,
  ): Promise<{ version: number }> {
    return this.composition.approve({
      accountId,
      postId,
      userId: auth.userId,
      version: body.version,
      approver: approverOf(auth),
      schedule: { day: body.day, time: body.time, now: new Date() },
    });
  }

  /** Reprovar com motivo (RF-E03): volta para rascunho, e o motivo vai junto. */
  @RequirePermission("POST_APPROVE")
  @Post(":postId/reject")
  @HttpCode(200)
  reject(
    @Param("accountId") accountId: string,
    @Param("postId") postId: string,
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(rejectPostSchema)) body: RejectPostInput,
  ): Promise<{ version: number }> {
    return this.composition.reject({
      accountId,
      postId,
      userId: auth.userId,
      version: body.version,
      approver: approverOf(auth),
      reason: body.reason,
    });
  }

  /**
   * "Voltar para a composição" (ADR 0026): em revisão, aprovada ou agendada →
   * rascunho. `POST_EDIT`, como editar o conteúdo, que já derrubava para rascunho.
   */
  @RequirePermission("POST_EDIT")
  @Post(":postId/reopen")
  @HttpCode(200)
  reopen(
    @Param("accountId") accountId: string,
    @Param("postId") postId: string,
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(postVersionSchema)) body: { version: number },
  ): Promise<{ version: number }> {
    return this.composition.reopen({ accountId, postId, userId: auth.userId, version: body.version });
  }

  /** Cancelar o agendamento sem perder a aprovação (ADR 0026): agendada → aprovada. */
  @RequirePermission("POST_SCHEDULE")
  @Post(":postId/unschedule")
  @HttpCode(200)
  unschedule(
    @Param("accountId") accountId: string,
    @Param("postId") postId: string,
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(postVersionSchema)) body: { version: number },
  ): Promise<{ version: number }> {
    return this.composition.unschedule({ accountId, postId, userId: auth.userId, version: body.version });
  }

  /**
   * Marcar horário — e reagendar, que é a mesma rota (RF-D01, RF-D04).
   *
   * O corpo traz **dia e hora civis**, não um instante: converter no navegador
   * deixaria o fuso do aparelho entrar por engano. Quem converte é a API, com o
   * fuso da conta (ADR 0006).
   */
  @RequirePermission("POST_SCHEDULE")
  @Post(":postId/schedule")
  @HttpCode(200)
  schedule(
    @Param("accountId") accountId: string,
    @Param("postId") postId: string,
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(schedulePostSchema)) body: SchedulePostInput,
  ): Promise<{ version: number }> {
    return this.composition.schedule({
      accountId,
      postId,
      userId: auth.userId,
      version: body.version,
      day: body.day,
      time: body.time,
      now: new Date(),
    });
  }

  /** Cancelar o que já tem horário, ou parou de vez (RF-D05). */
  @RequirePermission("POST_SCHEDULE")
  @Post(":postId/cancel")
  @HttpCode(200)
  cancel(
    @Param("accountId") accountId: string,
    @Param("postId") postId: string,
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(postVersionSchema)) body: { version: number },
  ): Promise<{ version: number }> {
    return this.composition.cancel({ accountId, postId, userId: auth.userId, version: body.version });
  }

  /**
   * `FALHOU → RASCUNHO`, para corrigir antes de agendar de novo (ADR 0007). Pede
   * a mesma permissão de reagendar e cancelar: é decidir sobre uma que falhou.
   */
  @RequirePermission("POST_SCHEDULE")
  @Post(":postId/to-draft")
  @HttpCode(200)
  toDraft(
    @Param("accountId") accountId: string,
    @Param("postId") postId: string,
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(postVersionSchema)) body: { version: number },
  ): Promise<{ version: number }> {
    return this.composition.toDraft({ accountId, postId, userId: auth.userId, version: body.version });
  }

  /** O que o motor fez com esta postagem, tentativa a tentativa (RF-F09). */
  @AnyAuthenticated()
  @Get(":postId/history")
  history(@Param("accountId") accountId: string, @Param("postId") postId: string): Promise<PostHistoryEntry[]> {
    return this.posts.history(accountId, postId);
  }

  @RequirePermission("POST_EDIT")
  @Post(":postId/discard")
  @HttpCode(200)
  discard(
    @Param("accountId") accountId: string,
    @Param("postId") postId: string,
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(postVersionSchema)) body: { version: number },
  ): Promise<{ version: number }> {
    return this.composition.discard({ accountId, postId, userId: auth.userId, version: body.version });
  }
}

/** Quem decide, com as permissões da sessão: a autoaprovação depende das duas coisas. */
function approverOf(auth: AuthContext) {
  return { id: auth.userId, permissions: auth.permissions, superAdmin: auth.superAdmin };
}
