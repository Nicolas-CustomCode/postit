import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { parseArgs } from "node:util";
import { readApiEnv } from "../config/env";
import { CliModule } from "./cli.module";
import { collectMetrics, createUser, promoteUser, refreshTokens, resetPassword, resetTwoFactor } from "./commands";

/**
 * Os comandos de administração, pelo terminal do servidor:
 *
 *   npm run admin:create -- --email voce@exemplo.com --name "Você" --super-admin
 *   npm run admin:promote -- --email voce@exemplo.com
 *   npm run admin:reset-password -- --email voce@exemplo.com
 *   npm run admin:reset-2fa -- --email voce@exemplo.com
 *   npm run admin:refresh-tokens
 *   npm run admin:collect-metrics
 *
 * Sem HTTP e sem tela: é o caminho que existe justamente para quando ninguém
 * consegue entrar. Todos gravam auditoria com origem CLI.
 */
async function main(): Promise<void> {
  const [command] = process.argv.slice(2);
  const { values } = parseArgs({
    args: process.argv.slice(3),
    options: {
      email: { type: "string" },
      name: { type: "string" },
      "super-admin": { type: "boolean", default: false },
    },
    allowPositionals: false,
  });

  const env = readApiEnv();
  const app = await NestFactory.createApplicationContext(CliModule.forEnv(env), { logger: ["warn", "error"] });

  try {
    const email = () => required(values.email, "--email");
    const result = await (async () => {
      switch (command) {
        case "create":
          return createUser(app, {
            email: email(),
            name: required(values.name, "--name"),
            superAdmin: values["super-admin"] === true,
            appUrl: env.APP_URL,
          });
        case "promote":
          return promoteUser(app, email());
        case "reset-password":
          return resetPassword(app, email(), env.APP_URL);
        case "reset-2fa":
          return resetTwoFactor(app, email());
        // Os dois que não agem sobre uma pessoa: não pedem --email.
        case "refresh-tokens":
          return refreshTokens(app);
        case "collect-metrics":
          return collectMetrics(app);
        default:
          throw new Error(`Comando desconhecido: ${command ?? "(nenhum)"}`);
      }
    })();

    // A saída é a única vez que o link existe fora do hash. Nunca vai para log.
    for (const line of result.lines) console.log(line);
  } finally {
    await app.close();
  }
}

function required(value: string | undefined, flag: string): string {
  if (value === undefined || value.trim().length === 0) throw new Error(`Faltou ${flag}`);
  return value.trim();
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
