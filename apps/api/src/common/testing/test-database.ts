// Carrega o .env da raiz, onde mora TEST_DATABASE_URL. Os testes que sobem a
// aplicação já passavam por aqui sem perceber; os que só falam com o banco e o
// pg-boss, não.
import "../../config/env";

/**
 * Trava de segurança dos testes de integração, como no hotclone (docs/15):
 * recusa rodar se o banco não terminar em _test. Impede apagar o banco errado por
 * engano de configuração.
 */
export function testDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  const url = source["TEST_DATABASE_URL"];
  if (!url) {
    throw new Error("TEST_DATABASE_URL não definida. Os testes de integração precisam de um banco próprio.");
  }
  const name = new URL(url).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(`Recusado: o banco de teste precisa terminar em _test (recebido: "${name}").`);
  }
  return url;
}
