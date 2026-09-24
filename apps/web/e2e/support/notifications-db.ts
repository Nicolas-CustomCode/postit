import { Client } from "pg";

/**
 * Avisos do sino direto no banco de teste, para montar cenário de tela.
 *
 * ⚠️ **Infraestrutura de teste, não código do produto** — como o
 * [posts-db.ts](./posts-db.ts). Nada em `app/` ou `lib/` pode importar isto.
 *
 * Quem grava o aviso de verdade é a API, na transação do que o causou; isso tem
 * teste no Jest. Aqui o que se prova é a **tela**: o número, a frase, o destino.
 */

async function comBanco<T>(fazer: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env["TEST_DATABASE_URL"] });
  await client.connect();
  try {
    return await fazer(client);
  } finally {
    await client.end();
  }
}

/**
 * Apaga todos os avisos. O `resetAccounts` não os alcança: o alvo é texto, sem
 * chave estrangeira, e outros testes geram avisos de verdade — o editor que envia
 * para revisão avisa o super admin.
 */
export async function limparAvisos(): Promise<void> {
  await comBanco((client) => client.query(`TRUNCATE TABLE "NotificacaoEntrega", "Notificacao"`));
}

export interface AvisoSemeado {
  /** O tipo no banco, em português: `PUBLICACAO_FALHOU`, `CONTA_SEM_ACESSO`… */
  readonly type: "PUBLICACAO_FALHOU" | "CONTA_SEM_ACESSO" | "AGUARDANDO_APROVACAO" | "POSTAGEM_REPROVADA";
  /** Uma postagem pelo id, ou a primeira conta do banco. */
  readonly target: { readonly post: string } | "conta";
  /** Para quem, pelo começo do e-mail dos usuários da preparação — `e2e-setup-super`. */
  readonly to: string;
}

/** Um aviso entregue ao usuário mais recente com aquele começo de e-mail. */
export async function semearAviso(aviso: AvisoSemeado): Promise<string> {
  return comBanco(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `WITH alvo AS (
         SELECT CASE WHEN $2::text IS NULL THEN (SELECT id::text FROM "Conta" ORDER BY "criadoEm" LIMIT 1)
                     ELSE $2::text END AS id
       ), aviso AS (
         INSERT INTO "Notificacao" (id, tipo, "alvoTipo", "alvoId", "criadaEm")
         SELECT gen_random_uuid(), $1::"TipoNotificacao", $3, alvo.id, clock_timestamp() FROM alvo
         RETURNING id
       )
       INSERT INTO "NotificacaoEntrega" (id, "notificacaoId", "usuarioId")
       SELECT gen_random_uuid(), aviso.id,
              (SELECT id FROM "Usuario" WHERE email LIKE $4 || '-%' ORDER BY "criadoEm" DESC LIMIT 1)
         FROM aviso
       RETURNING "notificacaoId" AS id`,
      [
        aviso.type,
        aviso.target === "conta" ? null : aviso.target.post,
        aviso.target === "conta" ? "ACCOUNT" : "POST",
        aviso.to,
      ],
    );
    return rows[0]?.id as string;
  });
}
