/**
 * Sobe o Next com a porta do .env da raiz.
 *
 *   node scripts/next.cjs dev
 *   node scripts/next.cjs start
 *
 * O Next só aceita a porta por `-p` ou pela variável PORT, e lê as duas antes de
 * carregar qualquer código do projeto — o .env não chega a tempo. Este arquivo
 * lê WEB_PORT do .env da raiz (o Next não sobe até lá) e a passa como PORT.
 *
 * Só WEB_PORT, e não o arquivo inteiro: o NODE_ENV=development do .env entraria
 * no `next start` e deixaria o servidor de produção em modo inconsistente. O
 * resto do .env é carregado pelo next.config.ts, depois de o Next fixar o modo.
 *
 * Variável já presente no processo vence o arquivo: é assim que o container da
 * etapa 1 define a porta dele. Sem nenhuma, vale 3010 (docs/10).
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("dotenv");

function portFromEnvFile() {
  const file = path.join(__dirname, "../../../.env");
  return fs.existsSync(file) ? parse(fs.readFileSync(file)).WEB_PORT : undefined;
}

const port = process.env.PORT || process.env.WEB_PORT || portFromEnvFile() || "3010";
const nextBin = require.resolve("next/dist/bin/next");

const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, PORT: port },
});

// Repassa o sinal de parada: sem isto, o Docker encerraria só este processo e
// deixaria o Next órfão, ainda ocupando a porta.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
