import { Global, Module, type DynamicModule } from "@nestjs/common";
import type { ApiEnv, WorkerEnv } from "../config/env";
import { STORAGE_CONFIG, storageConfigFrom } from "./storage.config";
import { StorageService } from "./storage.service";

/**
 * O armazenamento de mídia, compartilhado entre os dois processos: a API grava a
 * foto de perfil ao conectar a conta, o worker grava a mesma foto a cada
 * renovação de token (docs/08, "Padrões de implementação").
 *
 * Global pelo mesmo motivo do `PrismaModule`: é uma conexão, e cada `forEnv`
 * devolve um módulo novo. Sem isto, dois módulos que o importassem abririam dois
 * clientes do MinIO no mesmo processo.
 */
@Global()
@Module({})
export class StorageModule {
  static forEnv(env: ApiEnv | WorkerEnv): DynamicModule {
    return {
      module: StorageModule,
      providers: [{ provide: STORAGE_CONFIG, useValue: storageConfigFrom(env) }, StorageService],
      exports: [STORAGE_CONFIG, StorageService],
    };
  }
}
