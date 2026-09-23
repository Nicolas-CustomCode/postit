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

export interface PostagemSemeada {
  /** O status no banco, em português: `FALHOU`, `PUBLICADO`, `PROCESSANDO`… */
  readonly status: "RASCUNHO" | "AGENDADO" | "PROCESSANDO" | "PUBLICADO" | "FALHOU" | "CANCELADO";
  readonly caption?: string;
  readonly scheduledAt?: Date;
  readonly attempts?: number;
  /** A causa, como o motor grava em `ultimoErroCodigo` — `TOKEN_INVALID`, `RATE_LIMITED`… */
  readonly failureCause?: string;
  /** As imagens, já no acervo, com o texto alternativo de cada uma. */
  readonly media: readonly { readonly id: string; readonly altText?: string }[];
  /** Com permalink, ou `null` para a publicada sem link (V-28). */
  readonly publication?: { readonly permalink: string | null; readonly publishedAt: Date };
  /**
   * Com uma execução segurando a postagem, como o publicador a deixaria. Sem isso,
   * uma `PROCESSANDO` semeada é órfã para o despachante do worker dos testes, que a
   * recolheria e publicaria no meio do teste.
   */
  readonly leased?: boolean;
  /** Linhas de `EventoPublicacao`, na ordem. */
  readonly events?: readonly { readonly step: string; readonly result: string; readonly detail?: unknown }[];
}

/**
 * Uma postagem no estado que o motor a deixaria — publicada, falhada, saindo —
 * sem passar pelo motor. O caminho inteiro até `PUBLICADO` tem o seu teste; estes
 * são para as telas de cada estado.
 */
export async function semearPostagem(postagem: PostagemSemeada): Promise<string> {
  const client = new Client({ connectionString: process.env["TEST_DATABASE_URL"] });
  await client.connect();

  try {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO "Postagem" (id, "contaId", formato, status, legenda, "publicarEm", tentativas, "ultimoErroCodigo",
                               "criadoPorId", "agendadoPorId", versao, "criadoEm", "atualizadoEm",
                               "execucaoId", "execucaoExpiraEm")
       VALUES (
         gen_random_uuid(),
         (SELECT id FROM "Conta" ORDER BY "criadoEm" LIMIT 1),
         'FEED',
         $1::"StatusPostagem",
         $2, $3, $4, $5,
         (SELECT id FROM "Usuario" ORDER BY "criadoEm" LIMIT 1),
         (SELECT id FROM "Usuario" ORDER BY "criadoEm" LIMIT 1),
         1, now(), now(),
         CASE WHEN $6 THEN gen_random_uuid() END,
         CASE WHEN $6 THEN now() + interval '10 minutes' END
       )
       RETURNING id`,
      [
        postagem.status,
        postagem.caption ?? "Legenda semeada",
        postagem.scheduledAt ?? new Date(Date.now() - 30 * 60_000),
        postagem.attempts ?? 0,
        postagem.failureCause ?? null,
        postagem.leased === true,
      ],
    );
    const id = rows[0]?.id as string;

    for (const [ordem, item] of postagem.media.entries()) {
      await client.query(
        `INSERT INTO "PostagemMidia" (id, "postagemId", "midiaId", ordem, "textoAlternativo")
         VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [id, item.id, ordem, item.altText ?? null],
      );
    }

    if (postagem.publication !== undefined) {
      await client.query(
        `INSERT INTO "Publicacao" (id, "postagemId", "idExterno", permalink, "publicadoEm")
         VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
        [
          id,
          postagem.publication.permalink === null ? null : `1800${Math.floor(Math.random() * 1_000_000_000)}`,
          postagem.publication.permalink,
          postagem.publication.publishedAt,
        ],
      );
    }

    for (const evento of postagem.events ?? []) {
      await client.query(
        `INSERT INTO "EventoPublicacao" (id, "postagemId", etapa, resultado, "respostaMeta", "criadoEm")
         VALUES (gen_random_uuid(), $1, $2::"EtapaPublicacao", $3::"ResultadoEtapa", $4, clock_timestamp())`,
        [id, evento.step, evento.result, evento.detail === undefined ? null : JSON.stringify(evento.detail)],
      );
    }

    return id;
  } finally {
    await client.end();
  }
}
