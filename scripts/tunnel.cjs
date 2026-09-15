/**
 * Abre os dois túneis rápidos da Cloudflare do desenvolvimento local.
 *
 *   npm run tunnel
 *
 * Um túnel para o Next e outro para o MinIO: cada túnel rápido aponta para uma
 * porta só, e a Meta precisa baixar a mídia por um endereço público próprio.
 * Decisão e limites em docs/adr/0022.
 *
 * DEIXE RODANDO. O endereço *.trycloudflare.com é sorteado a cada vez que o
 * cloudflared sobe; fechar este processo troca os endereços, e aí é preciso
 * seguir a lista impressa no fim.
 *
 * As portas saem do .env da raiz, como no tunel.cjs do nossobuncker: o túnel
 * aponta para onde o servidor está, não para uma porta escrita à mão.
 */

const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

function readEnvFile() {
  const file = path.join(__dirname, "..", ".env");
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

const env = { ...readEnvFile(), ...process.env };
const targets = [
  { name: "app", port: env.WEB_PORT || "3010" },
  { name: "mídia", port: env.MINIO_LOCAL_PORT || "9002" },
];

const found = {};

for (const target of targets) {
  const url = `http://localhost:${target.port}`;
  console.log(`Abrindo túnel de ${target.name} para ${url} …`);

  // shell no Windows: o cloudflared costuma ser resolvido por .cmd, e sem shell
  // o spawn não o encontra no PATH.
  const child = spawn("cloudflared", ["tunnel", "--url", url], {
    shell: process.platform === "win32",
  });

  // O cloudflared escreve o endereço sorteado no stderr, no meio do log.
  const lookForUrl = (data) => {
    const match = data.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && !found[target.name]) {
      found[target.name] = match[0];
      if (Object.keys(found).length === targets.length) printSummary();
    }
  };
  child.stdout.on("data", lookForUrl);
  child.stderr.on("data", lookForUrl);

  child.on("error", (error) => {
    console.error(`Não foi possível iniciar o cloudflared: ${error.message}`);
    console.error("Instale o cloudflared e confira se ele está no PATH.");
    process.exit(1);
  });
  child.on("exit", (code) => {
    console.error(`O túnel de ${target.name} parou (código ${code}). Os endereços vão mudar ao abrir de novo.`);
    process.exit(code ?? 1);
  });
}

function printSummary() {
  const app = found.app;
  const media = found["mídia"];
  const changed = env.APP_URL && env.MINIO_PUBLIC_URL && (env.APP_URL !== app || env.MINIO_PUBLIC_URL !== media);

  console.log(`
Túneis de pé. Deixe este terminal aberto.

  App:   ${app}
  Mídia: ${media}
`);
  if (!changed && env.APP_URL === app) {
    console.log("Os endereços são os mesmos do .env. Nada a atualizar.\n");
    return;
  }
  console.log(`${changed ? "Os endereços MUDARAM." : "Primeira vez?"} Atualize:

  1. .env
       APP_URL=${app}
       IG_REDIRECT_URI=${app}/contas/conectar/retorno
       MINIO_PUBLIC_URL=${media}
  2. Painel da Meta, app PostIt Dev: URI de retorno ${app}/contas/conectar/retorno
  3. npm run media:setup   (reaplica o CORS do MinIO)
  4. Reinicie o npm run dev
  5. Entre de novo no PostIt
  6. No celular: reinstale o app e reative as notificações
`);
}
