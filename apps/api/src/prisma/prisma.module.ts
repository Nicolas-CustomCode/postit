import { DynamicModule, Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";

@Global()
@Module({})
export class PrismaModule {
  static forUrl(databaseUrl: string): DynamicModule {
    return {
      module: PrismaModule,
      providers: [{ provide: PrismaService, useFactory: () => new PrismaService(databaseUrl) }],
      exports: [PrismaService],
    };
  }
}
