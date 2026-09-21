import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import {
  createPostSchema,
  postVersionSchema,
  schedulePostSchema,
  setPostFormatSchema,
  setCaptionSchema,
  setPostMediaSchema,
  type CreatePostInput,
  type PostDetail,
  type PostSummary,
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
      mediaId: body.mediaId,
      altText: body.altText ?? null,
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
      approver: { id: auth.userId, permissions: auth.permissions, superAdmin: auth.superAdmin },
    });
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
