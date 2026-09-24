import type { PostStatus } from "@repo/shared";
import { MediaInUseError } from "../common/errors";
import { createTestAccount, createTestUser } from "../common/testing/factories";
import { jpegBytes } from "../common/testing/image-fixtures";
import { ageColumn } from "../common/testing/reset-database";
import { bootTestApp, type TestApp } from "../common/testing/test-app";
import { PrismaService } from "../prisma/prisma.service";
import { publicUrlFor } from "../storage/public-url";
import { StorageService } from "../storage/storage.service";
import { MediaRemovalService } from "./media-removal.service";
import { OrphanDerivativesService } from "./orphan-derivatives.service";

/**
 * A limpeza das imagens recortadas que ninguém usa (ADR 0025; docs/09, `manutencao`).
 *
 * Contra o Postgres e o MinIO de verdade: o que se prova é que a linha **e** o
 * arquivo somem — e, mais importante, tudo o que **não** pode sumir fica.
 *
 * O serviço é montado à mão, com o `PrismaService` e o `StorageService` do app de
 * teste: no processo HTTP ele não existe (é do worker), e aqui só a regra importa. A
 * idade vem do `ageColumn`, como no teste da renovação de tokens.
 */
describe("limpeza das recortadas órfãs", () => {
  let api: TestApp;
  let storage: StorageService;
  let limpeza: OrphanDerivativesService;
  let autorId: string;
  let accountId: string;

  beforeAll(async () => {
    api = await bootTestApp();
    storage = api.app.get(StorageService);
    const prisma = api.app.get(PrismaService);
    limpeza = new OrphanDerivativesService(prisma, new MediaRemovalService(prisma, storage));
  });
  beforeEach(async () => {
    await api.reset();
    autorId = (await createTestUser(api.db, api.config.encryptionKey)).id;
    accountId = (await createTestAccount(api.db, api.config.encryptionKey)).id;
  });
  afterAll(() => api.close());

  /** Uma `Midia` com arquivo de verdade em `publicas/`: original, ou derivada de `mae`. */
  async function midia(options: { mae?: string; idade?: string } = {}): Promise<{ id: string; objectKey: string }> {
    const objectKey = `publicas/postagens/${Math.random().toString(16).slice(2, 18)}.jpg`;
    await storage.putPublic(objectKey, jpegBytes({ width: 400, height: 500 }), "image/jpeg");
    const linha = await api.db.media.create({
      data: {
        objectKey,
        mimeType: "image/jpeg",
        bytes: 1000,
        width: 400,
        height: 500,
        sha256: "c".repeat(64),
        derivedFromId: options.mae ?? null,
      },
      select: { id: true, objectKey: true },
    });
    if (options.idade !== undefined) await ageColumn(api.db, "Midia", "criadoEm", linha.id, options.idade);
    return linha;
  }

  /** Uma derivada, com a original que a gerou, já com mais de 24 horas. */
  async function derivadaVelha(): Promise<{ id: string; objectKey: string; original: string }> {
    const original = await midia({ idade: "3 days" });
    const derivada = await midia({ mae: original.id, idade: "2 days" });
    return { ...derivada, original: original.id };
  }

  async function usarEm(mediaId: string, status: PostStatus): Promise<void> {
    const post = await api.db.post.create({
      data: { accountId, createdById: autorId, format: "FEED", status },
      select: { id: true },
    });
    await api.db.postMedia.create({ data: { postId: post.id, mediaId, position: 0 } });
  }

  const existe = async (id: string) => (await api.db.media.count({ where: { id } })) === 1;
  const arquivoExiste = async (objectKey: string) => {
    const url = publicUrlFor(objectKey, {
      publicUrl: process.env["MINIO_PUBLIC_URL"]!,
      bucket: process.env["MINIO_BUCKET"]!,
    });
    return (await fetch(url)).status === 200;
  };

  it("derivada sem uso, com mais de 24 horas, some — a linha e o arquivo", async () => {
    const derivada = await derivadaVelha();
    expect(await arquivoExiste(derivada.objectKey)).toBe(true);

    const resultado = await limpeza.sweep(new Date());

    expect(resultado).toEqual({ deleted: 1, skipped: 0 });
    expect(await existe(derivada.id)).toBe(false);
    expect(await arquivoExiste(derivada.objectKey)).toBe(false);
    // A original é do acervo: quem a apaga é a pessoa.
    expect(await existe(derivada.original)).toBe(true);
  });

  it("derivada de menos de 24 horas fica: a composição pode estar aberta", async () => {
    const original = await midia();
    const recente = await midia({ mae: original.id, idade: "23 hours" });

    await limpeza.sweep(new Date());

    expect(await existe(recente.id)).toBe(true);
  });

  it.each(["DRAFT", "IN_REVIEW", "SCHEDULED", "PUBLISHED"] as const)(
    "derivada numa postagem em %s fica",
    async (status) => {
      const derivada = await derivadaVelha();
      await usarEm(derivada.id, status);

      await limpeza.sweep(new Date());

      expect(await existe(derivada.id)).toBe(true);
      expect(await arquivoExiste(derivada.objectKey)).toBe(true);
    },
  );

  it("derivada só numa postagem descartada some, e o vínculo sai junto", async () => {
    const derivada = await derivadaVelha();
    await usarEm(derivada.id, "CANCELED");

    await limpeza.sweep(new Date());

    expect(await existe(derivada.id)).toBe(false);
    expect(await api.db.postMedia.count({ where: { mediaId: derivada.id } })).toBe(0);
  });

  it("derivada que é capa de postagem fica", async () => {
    const derivada = await derivadaVelha();
    await api.db.post.create({
      data: { accountId, createdById: autorId, format: "REELS", status: "DRAFT", coverMediaId: derivada.id },
    });

    await limpeza.sweep(new Date());

    expect(await existe(derivada.id)).toBe(true);
  });

  /*
   * O caso que decide a ordem: apagar a mãe antes da filha faria o SET NULL soltar a
   * filha, que reapareceria no acervo. Das pontas para dentro, numa execução só.
   */
  it("recorte de recorte, os dois sem uso: somem os dois, e nenhum volta ao acervo", async () => {
    const mae = await derivadaVelha();
    const filha = await midia({ mae: mae.id, idade: "2 days" });

    const resultado = await limpeza.sweep(new Date());

    expect(resultado.deleted).toBe(2);
    expect(await existe(mae.id)).toBe(false);
    expect(await existe(filha.id)).toBe(false);
    // O acervo continua só com a original.
    expect(await api.db.media.count({ where: { derivedFromId: null } })).toBe(1);
  });

  it("filha em uso segura a mãe, mesmo sem uso: a mãe tem derivada", async () => {
    const mae = await derivadaVelha();
    const filha = await midia({ mae: mae.id, idade: "2 days" });
    await usarEm(filha.id, "SCHEDULED");

    await limpeza.sweep(new Date());

    expect(await existe(mae.id)).toBe(true);
    expect(await existe(filha.id)).toBe(true);
  });

  it("original do acervo sem uso nunca entra", async () => {
    const original = await midia({ idade: "30 days" });

    const resultado = await limpeza.sweep(new Date());

    expect(resultado).toEqual({ deleted: 0, skipped: 0 });
    expect(await existe(original.id)).toBe(true);
  });

  /*
   * A corrida: alguém anexa a imagem entre a consulta e a exclusão, e o `remove`
   * recusa com MediaInUseError. Simulada com uma exclusão que recusa aquela, como a
   * de verdade faria — o que se prova é que as outras não caem junto.
   */
  it("uma presa no meio do caminho é pulada, e não derruba as outras", async () => {
    const [primeira, presa, terceira] = [await derivadaVelha(), await derivadaVelha(), await derivadaVelha()];
    const prisma = api.app.get(PrismaService);
    const real = new MediaRemovalService(prisma, storage);
    const comCorrida = {
      remove: async (ids: readonly string[]) => {
        if (ids.includes(presa.id)) throw new MediaInUseError();
        return real.remove(ids);
      },
    } as MediaRemovalService;

    const resultado = await new OrphanDerivativesService(prisma, comCorrida).sweep(new Date());

    expect(resultado).toEqual({ deleted: 2, skipped: 1 });
    expect(await existe(primeira.id)).toBe(false);
    expect(await existe(presa.id)).toBe(true);
    expect(await existe(terceira.id)).toBe(false);
  });

  it("várias órfãs de uma vez somem todas, e as em uso ficam", async () => {
    const orfas = [await derivadaVelha(), await derivadaVelha(), await derivadaVelha()];
    const emUso = await derivadaVelha();
    await usarEm(emUso.id, "DRAFT");

    const resultado = await limpeza.sweep(new Date());

    expect(resultado).toEqual({ deleted: 3, skipped: 0 });
    for (const orfa of orfas) expect(await existe(orfa.id)).toBe(false);
    expect(await existe(emUso.id)).toBe(true);
  });
});
