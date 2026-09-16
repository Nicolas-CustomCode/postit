import { execFileSync } from "node:child_process";
import { join } from "node:path";

/**
 * Cria um usuário pelo mesmo comando que uma pessoa rodaria no servidor.
 *
 * É de propósito: o primeiro acesso do PostIt começa nesse comando, e o teste de
 * tela precisa cobrir o caminho inteiro — inclusive o link que ele imprime.
 */
const CLI = join(__dirname, "../../../api/dist/cli/main.js");

export interface NovoUsuario {
  readonly email: string;
  readonly signupUrl: string;
}

export function criarUsuario(appUrl: string, sufixo: string): NovoUsuario {
  const email = `e2e-${sufixo}-${Date.now()}@exemplo.com`;

  const saida = execFileSync(process.execPath, [CLI, "create", "--email", email, "--name", "Pessoa do Teste"], {
    encoding: "utf-8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      APP_URL: appUrl,
      // O comando fala com o MESMO banco que a API dos testes usa.
      DATABASE_URL: process.env["TEST_DATABASE_URL"] ?? "",
    },
  });

  const signupUrl = /https?:\/\/\S+\/cadastro\/[A-Za-z0-9_-]{43}/.exec(saida)?.[0];
  if (signupUrl === undefined) throw new Error(`O comando não imprimiu o link de cadastro:\n${saida}`);

  return { email, signupUrl };
}
