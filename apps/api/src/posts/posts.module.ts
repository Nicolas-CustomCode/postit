import { Module, type DynamicModule } from "@nestjs/common";
import type { ApiEnv } from "../config/env";
import { POSTS_CONFIG, postsConfigFrom } from "./posts.config";
import { PostCommentsDomainService } from "./post-comments.domain.service";
import { PostsController } from "./posts.controller";
import { PostsDomainService } from "./posts.domain.service";
import { PostsQueryService } from "./posts.query.service";

/**
 * A postagem: compor, revisar (enviar, aprovar, reprovar, agendar) e comentar.
 *
 * **Não importa módulo nenhum.** A config própria existe para isso: importar o
 * `AccountsModule` só para reaproveitar `MINIO_PUBLIC_URL` registraria o
 * `AccountsController` uma segunda vez, porque `forEnv` devolve um módulo novo a
 * cada chamada — e o Fastify recusa a rota duplicada.
 *
 * ⚠️ **Vive só no processo HTTP.** Nada aqui publica nem fala com a Meta; o
 * despachante e o publicador são do worker, e chegam na 1d (AGENTS.md, regra 1).
 *
 * **As decisões da revisão moram em `PostsDomainService`, e não num módulo
 * `approval/`** (ADR 0026): toda mudança de status passa pela trava da versão e
 * grava `Aprovacao` na mesma transação, e o teste de arquitetura só deixa aquele
 * serviço escrever na postagem. Um módulo à parte precisaria de uma segunda porta.
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
        PostCommentsDomainService,
      ],
    };
  }
}
