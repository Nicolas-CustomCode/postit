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
 *
 * transformIgnorePatterns — o Jest não transforma node_modules por padrão, e o
 * otplib 13 (com @scure/base e @noble/hashes) é publicado só como ESM. Em
 * CommonJS, que é como o Jest roda aqui, carregar ESM por require só funciona a
 * partir do Node 24.9. A exceção abaixo manda o ts-jest compilá-los na hora do
 * teste, usando tsconfig.spec.json (allowJs). Em produção nada disso acontece: o
 * Node 22 carrega esses pacotes sozinho.
 */
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.spec.ts"],
  maxWorkers: 1,
  // Os testes de integração sobem a aplicação inteira e falam com o Postgres: os
  // 5 s padrão do Jest não cobrem nem a subida.
  testTimeout: 30_000,
  transform: { "^.+\\.(ts|js|mjs)$": ["ts-jest", { tsconfig: "tsconfig.spec.json" }] },
  transformIgnorePatterns: [
    // Nada de node_modules, exceto os pacotes ESM do código de 6 dígitos.
    "node_modules[\\\\/](?!(otplib|@otplib|@scure|@noble)[\\\\/])",
    // O dist dos pacotes do monorepo já é CommonJS compilado: transformá-lo de
    // novo só gera aviso e lentidão.
    "packages[\\\\/][^\\\\/]+[\\\\/]dist[\\\\/]",
  ],
};
