import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import {
  confirmUploadSchema,
  deleteMediaSchema,
  type DeleteMediaInput,
  type MediaSummary,
  type UploadPermission,
} from "@repo/shared";
import { AnyAuthenticated, RequirePermission } from "../authorization/policy.decorators";
import { Auth } from "../auth/auth.decorators";
import type { AuthContext } from "../auth/session.service";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { MediaDomainService } from "./media.domain.service";
import { MediaQueryService } from "./media.query.service";

/**
 * O acervo: enviar, listar e excluir (RF-B01, RF-B02, RF-B04, RF-B07; ADR 0012).
 *
 * As rotas de envio e de exclusão são **ação**, e exigem `POST_EDIT` — a mesma
 * permissão que o ADR 0015 já descreve como "enviar mídia" e "descartar
 * rascunho". Excluir do acervo é o inverso da primeira e da mesma natureza da
 * segunda: tirar conteúdo que a própria pessoa pôs. Listar é leitura, e leitura
 * é `@AnyAuthenticated` (AGENTS.md, regra 5).
 *
 * Nenhuma delas recebe o arquivo: o navegador o envia direto ao MinIO, com a
 * permissão que a primeira devolve. É isso que deixa o limite de 1 MB por
 * requisição valer sem exceção (regra 10).
 */
@Controller("media")
export class MediaController {
  constructor(
    private readonly media: MediaDomainService,
    private readonly acervo: MediaQueryService,
  ) {}

  /** O que já foi enviado, para reaproveitar numa postagem (RF-B04). */
  @AnyAuthenticated()
  @Get()
  list(): Promise<MediaSummary[]> {
    return this.acervo.list();
  }

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

  /**
   * Tira imagens do acervo (RF-B07).
   *
   * Uma lista sempre — a lixeira de um card manda um id só. E `POST`, não
   * `DELETE`: o cliente do Next conhece GET e POST, e o projeto escreve por
   * caminho-verbo (`/discard`, `/cancel`, `/confirm`).
   */
  @RequirePermission("POST_EDIT")
  @Post("delete")
  @HttpCode(200)
  remove(
    @Body(new ZodValidationPipe(deleteMediaSchema)) body: DeleteMediaInput,
  ): Promise<{ deleted: number }> {
    return this.media.deleteMedia(body.ids);
  }
}
