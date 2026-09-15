/**
 * Testes da API.
 *
 * *.spec.ts              regras e peças isoladas, sem banco
 * *.integration.spec.ts  integração com o Postgres de verdade (docs/15: um banco
 *                        falso não reproduz transações concorrentes). Recusam
 *                        rodar se o banco não terminar em _test — ver
 *                        src/common/testing/test-database.ts.
 *
 * maxWorkers: 1 — um processo só, arquivos em série. Os testes de integração
 * dividem o mesmo banco postit_test: em paralelo, um arquivo apagaria ou mudaria
 * os dados de outro no meio do teste. Em paralelo, o Jest também avisava de
 * processo auxiliar que não saía a tempo depois dos testes com banco.
 */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.spec.ts"],
  maxWorkers: 1,
  transform: { "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
};
