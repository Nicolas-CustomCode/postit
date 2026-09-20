import { Client } from "pg";

/**
 * Postagens direto no banco de teste, para montar cenário de tela.
 *
 * ⚠️ **Infraestrutura de teste, não código do produto.** A regra de que o
 * `apps/web` nunca fala com o banco (AGENTS.md, regra 4) vale para o app; aqui é
 * o teste montando o cenário, como em [accounts-db.ts](./accounts-db.ts). Nada
 * em `app/` ou `lib/` pode importar este arquivo.
 */

/**
 * Simula outra pessoa salvando a mesma postagem.
 *
 * Sobe a `versao` como a API faria, e é exatamente isso que faz a tela levar
 * `POST_VERSION_CONFLICT` no próximo salvamento (RF-C12). Vai pelo banco em vez
 * de abrir um segundo navegador: o que importa provar aqui é a **tela reagindo**
 * — a corrida em si já tem teste de integração contra o Postgres.
 */
export async function salvarComoOutraPessoa(postId: string, caption: string): Promise<void> {
  const client = new Client({ connectionString: process.env["TEST_DATABASE_URL"] });
  await client.connect();

  try {
    await client.query(
      `UPDATE "Postagem"
          SET legenda = $1,
              versao = versao + 1,
              "atualizadoPorId" = (SELECT id FROM "Usuario" ORDER BY "criadoEm" LIMIT 1),
              "atualizadoEm" = now()
        WHERE id = $2::uuid`,
      [caption, postId],
    );
  } finally {
    await client.end();
  }
}
