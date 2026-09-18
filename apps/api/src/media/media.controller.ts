import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { confirmUploadSchema, type MediaSummary, type UploadPermission } from "@repo/shared";
import { RequirePermission } from "../authorization/policy.decorators";
import { Auth } from "../auth/auth.decorators";
import type { AuthContext } from "../auth/session.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { MediaDomainService } from "./media.domain.service";

/**
 * Envio de mídia (RF-B01, RF-B02; ADR 0012).
 *
 * As duas rotas são **ação**, e exigem `POST_EDIT` — a permissão que o docs/02
 * mapeia para RF-B01 a RF-B05 (AGENTS.md, regra 5).
 *
 * Nenhuma delas recebe o arquivo: o navegador o envia direto ao MinIO, com a
 * permissão que a primeira devolve. É isso que deixa o limite de 1 MB por
 * requisição valer sem exceção (regra 10).
 */
@Controller("media")
export class MediaController {
  constructor(private readonly media: MediaDomainService) {}

  /** Autoriza um envio: para onde mandar, com quais campos, e por quanto tempo. */
  @RequirePermission("POST_EDIT")
  @Post("upload-policy")
  @HttpCode(200)
  authorize(@Auth() auth: AuthContext): Promise<UploadPermission> {
    return this.media.authorizeUpload(auth.userId, new Date());
  }

  /** Confere o que foi enviado. Passou, vira `Midia`; não passou, é apagado. */
  @RequirePermission("POST_EDIT")
  @Post("confirm")
  @HttpCode(201)
  confirm(
    @Auth() auth: AuthContext,
    @Body(new ZodValidationPipe(confirmUploadSchema)) body: { ticket: string },
  ): Promise<MediaSummary> {
    return this.media.confirmUpload({ userId: auth.userId, ticket: body.ticket, now: new Date() });
  }
}
