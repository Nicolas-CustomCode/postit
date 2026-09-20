import { Module, type DynamicModule } from "@nestjs/common";
import type { ApiEnv } from "../config/env";
import { POSTS_CONFIG, postsConfigFrom } from "./posts.config";
import { PostsController } from "./posts.controller";
import { PostsDomainService } from "./posts.domain.service";
import { PostsQueryService } from "./posts.query.service";

/**
 * Composição de postagens: criar, editar, marcar como pronta, descartar.
 *
 * **Não importa módulo nenhum.** A config própria existe para isso: importar o
 * `AccountsModule` só para reaproveitar `MINIO_PUBLIC_URL` registraria o
 * `AccountsController` uma segunda vez, porque `forEnv` devolve um módulo novo a
 * cada chamada — e o Fastify recusa a rota duplicada.
 *
 * ⚠️ **Vive só no processo HTTP.** Nada aqui publica nem fala com a Meta; o
 * despachante e o publicador são do worker, e chegam na 1d (AGENTS.md, regra 1).
 *
 * **Não há módulo `approval/` ainda** — a única regra de aprovação desta fase é
 * a autoaprovação, que mora no serviço. O módulo nasce na Fase 4, junto com
 * reprovar com motivo, fila de pendências e comentários internos.
 */
@Module({})
export class PostsModule {
  static forEnv(env: ApiEnv): DynamicModule {
    return {
      module: PostsModule,
      controllers: [PostsController],
      providers: [
        { provide: POSTS_CONFIG, useValue: postsConfigFrom(env) },
        PostsQueryService,
        PostsDomainService,
      ],
    };
  }
}
