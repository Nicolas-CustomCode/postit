import { Module, type DynamicModule } from "@nestjs/common";
import { McpController } from "./mcp.controller";
import { McpRateLimiter } from "./mcp-rate-limiter";
import { McpToolsService } from "./mcp-tools.service";

/**
 * O servidor MCP do assistente (ADR 0029), só no processo HTTP — o assistente
 * compõe, e quem publica continua sendo só o worker (regra 1).
 *
 * Recebe os módulos **já montados** pelo `AppModule`: chamar `forEnv` de novo
 * registraria as rotas deles duas vezes, e o Fastify recusa rota duplicada.
 */
@Module({})
export class McpModule {
  static with(modules: {
    oauth: DynamicModule;
    accounts: DynamicModule;
    posts: DynamicModule;
    media: DynamicModule;
  }): DynamicModule {
    return {
      module: McpModule,
      imports: [modules.oauth, modules.accounts, modules.posts, modules.media],
      controllers: [McpController],
      providers: [McpToolsService, McpRateLimiter],
    };
  }
}
