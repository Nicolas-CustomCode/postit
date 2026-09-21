import { Client } from "pg";

/**
 * Mídia do acervo direto no banco de teste.
 *
 * ⚠️ **Infraestrutura de teste, não código do produto** — como
 * [accounts-db.ts](./accounts-db.ts). Nada em `app/` ou `lib/` pode importar
 * este arquivo.
 *
 * Existe porque o **envio completo não roda no Playwright**: o arquivo vai do
 * navegador direto ao MinIO, com política assinada e CORS, e isso é o roteiro
 * manual da fase (docs/12, item V-15). O que dá para provar aqui é o que vem
 * depois — escolher do acervo, anexar, e a postagem nascer só no salvamento.
 */
export async function criarMidia(medidas: {
  width: number;
  height: number;
}): Promise<{ id: string }> {
  const client = new Client({ connectionString: process.env["TEST_DATABASE_URL"] });
  await client.connect();

  try {
    const chave = `publicas/postagens/${Math.random().toString(16).slice(2, 18)}.jpg`;
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO "Midia" (id, "chaveObjeto", "mimeType", bytes, largura, altura, "hashSha256", "criadoEm")
       VALUES (gen_random_uuid(), $1, 'image/jpeg', 1000000, $2, $3, $4, now())
       RETURNING id`,
      [chave, medidas.width, medidas.height, "a".repeat(64)],
    );

    return { id: rows[0]?.id as string };
  } finally {
    await client.end();
  }
}
