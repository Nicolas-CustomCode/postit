import { Client } from "pg";

/**
 * Uma autorização do assistente direto no banco de teste, para o cartão
 * "Aplicativos conectados" do Perfil (ADR 0029).
 *
 * ⚠️ **Infraestrutura de teste, não código do produto**, como o
 * [posts-db.ts](./posts-db.ts). O fluxo OAuth inteiro tem o seu teste no Jest; aqui o
 * que importa é a tela.
 */
export async function semearAutorizacao(autor: string): Promise<string> {
  const client = new Client({ connectionString: process.env["TEST_DATABASE_URL"] });
  await client.connect();

  try {
    // O mais recente com aquele começo de e-mail: cada rodada da preparação cria usuários novos.
    const { rows: usuarios } = await client.query<{ id: string }>(
      `SELECT id FROM "Usuario" WHERE email LIKE $1 || '-%' ORDER BY "criadoEm" DESC LIMIT 1`,
      [autor],
    );
    const usuario = usuarios[0]?.id;
    if (usuario === undefined) throw new Error(`Nenhum usuário ${autor}`);

    // Uma autorização viva por vez: as anteriores, de outra rodada, saem do caminho.
    await client.query(`UPDATE "AutorizacaoOAuth" SET "revogadaEm" = now() WHERE "usuarioId" = $1`, [usuario]);

    const { rows: clientes } = await client.query<{ id: string }>(
      `INSERT INTO "ClienteOAuth" (id, identificador, origem, nome, "enderecosRetorno", "lidaEm")
       VALUES (gen_random_uuid(), 'https://chatgpt.com/oauth/client.json', 'CIMD', 'ChatGPT',
               ARRAY['https://chatgpt.com/connector_platform_oauth_redirect'], now())
       ON CONFLICT (identificador) DO UPDATE SET nome = EXCLUDED.nome
       RETURNING id`,
    );

    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO "AutorizacaoOAuth" (id, "usuarioId", "clienteId", escopo, "expiraEm", "ultimoUsoEm")
       VALUES (gen_random_uuid(), $1, $2, 'postagens:compor', now() + interval '30 days', now())
       RETURNING id`,
      [usuario, clientes[0]?.id],
    );
    return rows[0]?.id as string;
  } finally {
    await client.end();
  }
}
