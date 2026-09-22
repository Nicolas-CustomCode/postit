import { Injectable } from "@nestjs/common";
import type { Prisma } from "@repo/database";
import type { PublishFailureCause } from "@repo/shared";
import { PrismaService } from "../../prisma/prisma.service";

type Tx = Prisma.TransactionClient;

/**
 * **O único arquivo do worker que escreve em `Postagem`** — o
 * `architecture.spec.ts` confere.
 *
 * Toda escrita aqui é **cercada**: só vale se a linha ainda estiver no estado, na
 * versão ou nas mãos da execução que a pede. É assim que o worker convive com a
 * pessoa editando a mesma postagem e com uma execução antiga que ainda roda.
 *
 * ⚠️ **Nenhuma escrita toca `versao`** (AGENTS.md, regra 20). A versão é da
 * pessoa: ela sobe a cada edição, e é justamente por isso que aqui ela só aparece
 * na condição, para saber se a postagem ainda é a que foi despachada.
 */
@Injectable()
export class PostOutcomeStore {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Toma a postagem para esta execução (invariante I-6).
   *
   * O pg-boss dá por travada uma execução que passa do prazo e **inicia outra com
   * a primeira ainda rodando** — ele não tem como matá-la. Por isso quem fala com a
   * Meta é quem segura o arrendamento, e só se toma arrendamento livre ou vencido.
   * O relógio é o do banco, o mesmo para todas as execuções.
   *
   * Soma uma tentativa: é a nossa conta, e não a do pg-boss, que decide a primeira
   * execução (I-8) e o fim das tentativas — a do pg-boss conta também as
   * expirações.
   *
   * `null` quando a postagem não está mais para esta execução: saiu de
   * `PROCESSANDO`, mudou de versão ou outra execução a segura. Nos três casos quem
   * chama sai quieto; se ficar alguém sem dono, o despachante a recolhe.
   */
  async claimRun(
    postId: string,
    version: number,
    runId: string,
    leaseMs: number,
  ): Promise<{ attempts: number; scheduledAt: Date; lastErrorCode: string | null } | null> {
    const rows = await this.prisma.db.$queryRaw<
      { tentativas: number; publicarEm: Date; ultimoErroCodigo: string | null }[]
    >`
      UPDATE "Postagem"
         SET "tentativas" = "tentativas" + 1,
             "execucaoId" = ${runId}::uuid,
             "execucaoExpiraEm" = now() + ${leaseMs} * interval '1 millisecond'
       WHERE "id" = ${postId}::uuid
         AND "status" = 'PROCESSANDO'
         AND "versao" = ${version}
         AND ("execucaoExpiraEm" IS NULL OR "execucaoExpiraEm" < now())
      RETURNING "tentativas", "publicarEm", "ultimoErroCodigo"`;

    const row = rows[0];
    if (!row) return null;
    return { attempts: row.tentativas, scheduledAt: row.publicarEm, lastErrorCode: row.ultimoErroCodigo };
  }

  /**
   * Renova o arrendamento antes de cada chamada que muda algo na Meta.
   * `false` quer dizer que outra execução tomou a postagem: pare sem escrever nada.
   */
  async holdLease(postId: string, runId: string, leaseMs: number): Promise<boolean> {
    const count = await this.prisma.db.$executeRaw`
      UPDATE "Postagem"
         SET "execucaoExpiraEm" = now() + ${leaseMs} * interval '1 millisecond'
       WHERE "id" = ${postId}::uuid AND "execucaoId" = ${runId}::uuid AND "status" = 'PROCESSANDO'`;
    return count === 1;
  }

  /** Solta o arrendamento, guardando a causa da tentativa que não deu certo. */
  async releaseRun(postId: string, runId: string, cause?: PublishFailureCause): Promise<void> {
    await this.prisma.db.post.updateMany({
      where: { id: postId, runId, status: "PROCESSING" },
      data: { runId: null, runLeaseUntil: null, ...(cause === undefined ? {} : { lastErrorCode: cause }) },
    });
  }

  /**
   * `AGENDADO → PROCESSANDO`, na transação que cria a tarefa (camada 3 de
   * idempotência; AGENTS.md, regra 8).
   *
   * A condição inclui a versão lida na varredura: se a pessoa reagendou entre a
   * leitura e aqui, a postagem continua `AGENDADO` e a tarefa não nasce com o
   * horário velho. Zera as tentativas e a causa anterior — é um ciclo novo.
   */
  async dispatch(tx: Tx, postId: string, version: number): Promise<boolean> {
    const { count } = await tx.post.updateMany({
      where: { id: postId, status: "SCHEDULED", version },
      data: { status: "PROCESSING", attempts: 0, lastErrorCode: null, lastErrorMessage: null, runId: null, runLeaseUntil: null },
    });
    return count === 1;
  }

  /** Sem cota: continua `AGENDADO`, com o motivo à vista (RF-D09). `true` só na primeira vez. */
  async defer(postId: string, version: number): Promise<boolean> {
    const { count } = await this.prisma.db.post.updateMany({
      // O nulo explícito: em SQL, `NOT (coluna = 'X')` com a coluna nula não é verdade.
      where: {
        id: postId,
        status: "SCHEDULED",
        version,
        OR: [{ lastErrorCode: null }, { lastErrorCode: { not: "QUOTA_DEFERRED" } }],
      },
      data: { lastErrorCode: "QUOTA_DEFERRED" },
    });
    return count === 1;
  }

  /**
   * `→ FALHOU`, com a causa. Cercada de um de dois jeitos:
   *
   * - `{ runId }` — pelo publicador: só se esta execução ainda segura a postagem;
   * - `{ status, version }` — pelo despachante e pelo tratador de falhas, que não
   *   têm arrendamento: só se a postagem ainda é a do ciclo que eles conhecem, e
   *   ninguém a segura.
   */
  async fail(
    tx: Tx,
    postId: string,
    cause: PublishFailureCause,
    tag: string | null,
    fence: { runId: string } | { status: "SCHEDULED" | "PROCESSING"; version: number },
  ): Promise<boolean> {
    const where: Prisma.PostWhereInput =
      "runId" in fence
        ? { id: postId, status: "PROCESSING", runId: fence.runId }
        : {
            id: postId,
            status: fence.status,
            version: fence.version,
            OR: [{ runLeaseUntil: null }, { runLeaseUntil: { lt: new Date() } }],
          };

    const { count } = await tx.post.updateMany({
      where,
      data: { status: "FAILED", lastErrorCode: cause, lastErrorMessage: tag, runId: null, runLeaseUntil: null },
    });
    return count === 1;
  }

  /**
   * `PROCESSANDO → PUBLICADO`.
   *
   * **Sem cerca de arrendamento, de propósito.** A Meta ter publicado é fato, e
   * não depende de quem segura a postagem: uma execução que perdeu o arrendamento
   * enquanto esperava a resposta ainda precisa registrar o que aconteceu, senão a
   * postagem ficaria `PROCESSANDO` com a `Publicacao` já gravada.
   */
  async publish(tx: Tx, postId: string): Promise<void> {
    await tx.post.updateMany({
      where: { id: postId, status: "PROCESSING" },
      data: { status: "PUBLISHED", lastErrorCode: null, lastErrorMessage: null, runId: null, runLeaseUntil: null },
    });
  }

  /**
   * Marca, **antes** do `media_publish`, que ele foi pedido para este container.
   *
   * Cercada pelo arrendamento na mesma instrução: se outra execução tomou a
   * postagem, nada é marcado e quem chamou não publica. A execução seguinte que
   * encontrar a marca sabe que esta pode ter publicado — e confere antes de
   * publicar de novo (docs/09, "O caso difícil").
   */
  async markPublishRequested(containerId: string, postId: string, runId: string): Promise<boolean> {
    const count = await this.prisma.db.$executeRaw`
      UPDATE "ContainerPublicacao" c
         SET "publicarPedidoEm" = now()
        FROM "Postagem" p
       WHERE c."id" = ${containerId}::uuid
         AND p."id" = ${postId}::uuid
         AND c."postagemId" = p."id"
         AND p."execucaoId" = ${runId}::uuid
         AND p."status" = 'PROCESSANDO'`;
    return count === 1;
  }
}
