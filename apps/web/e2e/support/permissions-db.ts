import { Client } from "pg";

/**
 * Permissões direto no banco de teste, para montar os papéis da revisão.
 *
 * ⚠️ **Infraestrutura de teste, não código do produto** — como
 * [posts-db.ts](./posts-db.ts). A tela de permissões é da Fase 4; até lá, quem
 * concede é o banco. Nada em `app/` ou `lib/` pode importar este arquivo.
 */
export async function concederPermissoes(email: string, permissoes: readonly string[]): Promise<void> {
  const client = new Client({ connectionString: process.env["TEST_DATABASE_URL"] });
  await client.connect();

  try {
    for (const permissao of permissoes) {
      await client.query(
        `INSERT INTO "PermissaoUsuario" (id, "usuarioId", permissao)
         SELECT gen_random_uuid(), id, $2::"Permissao" FROM "Usuario" WHERE email = $1
         ON CONFLICT DO NOTHING`,
        [email, permissao],
      );
    }
  } finally {
    await client.end();
  }
}
