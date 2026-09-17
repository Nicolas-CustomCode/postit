import type { PrismaClient } from "@repo/database";

/**
 * Zera as tabelas de autenticação entre testes.
 *
 * Por que TRUNCATE, e não transação por teste: a aplicação sob teste usa as
 * conexões dela, pelo pool do PrismaService — uma transação segurada pelo teste
 * é invisível para ela. Só funcionaria com banco falso, que é o que docs/15
 * proíbe justamente nestes testes.
 *
 * Por que não basta usar e-mails diferentes por arquivo: bloqueio por IP,
 * contagem de tentativas e a contagem de super admins ativos são consultas
 * agregadas — resíduo de outro arquivo quebra o resultado.
 *
 * Os nomes são os do banco, em português (ADR 0023). A ordem não importa com
 * CASCADE; a lista é explícita para nunca apagar o esquema do pg-boss por engano.
 */
const AUTH_TABLES = [
  "MetricaConta",
  "EventoToken",
  "Conta",
  "PermissaoUsuario",
  "Sessao",
  "DesafioLogin",
  "CodigoRecuperacao",
  "LinkAcesso",
  "TentativaAcesso",
  "BloqueioAcesso",
  "EventoAuditoria",
  "Usuario",
];

export async function resetAuthTables(db: PrismaClient): Promise<void> {
  const list = AUTH_TABLES.map((table) => `"${table}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/**
 * Envelhece uma linha, para testar prazo sem esperar.
 *
 * É o contrário de adiantar o relógio: `jest.useFakeTimers()` sequestraria os
 * temporizadores do driver do Postgres e do Fastify, e a suíte trava. Aqui o
 * relógio é real e o **dado** é que fica velho, que é o que acontece na vida.
 */
export async function ageColumn(
  db: PrismaClient,
  table: string,
  column: string,
  id: string,
  interval: string,
): Promise<void> {
  await db.$executeRawUnsafe(`UPDATE "${table}" SET "${column}" = now() - interval '${interval}' WHERE id = $1::uuid`, id);
}
