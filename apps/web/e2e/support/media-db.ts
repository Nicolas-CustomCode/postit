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

/**
 * Prende a mídia a uma postagem, para provar a recusa de excluir (RF-B07).
 *
 * O estado decide tudo: `CANCELADO` solta a imagem, qualquer outro a segura.
 * Cria a postagem aqui mesmo porque o que importa é a **linha** em
 * `PostagemMidia` — como ela nasceu é assunto de outro teste.
 */
export async function usarMidiaEmPostagem(
  mediaId: string,
  status: "RASCUNHO" | "PUBLICADO" | "CANCELADO",
): Promise<void> {
  const client = new Client({ connectionString: process.env["TEST_DATABASE_URL"] });
  await client.connect();

  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO "Postagem" (id, "contaId", formato, status, "criadoPorId", versao, "criadoEm", "atualizadoEm")
       VALUES (
         gen_random_uuid(),
         (SELECT id FROM "Conta" ORDER BY "criadoEm" LIMIT 1),
         'FEED',
         $1::"StatusPostagem",
         (SELECT id FROM "Usuario" ORDER BY "criadoEm" LIMIT 1),
         1, now(), now()
       )
       RETURNING id`,
      [status],
    );

    await client.query(
      `INSERT INTO "PostagemMidia" (id, "postagemId", "midiaId", ordem)
       VALUES (gen_random_uuid(), $1, $2, 0)`,
      [rows[0]?.id, mediaId],
    );
  } finally {
    await client.end();
  }
}
