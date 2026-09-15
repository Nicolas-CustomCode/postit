/**
 * Versão única do PostIt, no padrão do nossobuncker.
 *
 *   node scripts/version.mjs patch | minor | major   sobe a versão e propaga
 *   node scripts/version.mjs sync                    só propaga a versão atual
 *
 * A fonte é o "version" do package.json da raiz. Daqui ela vai para:
 *   - o "version" de cada workspace, para os logs mostrarem o mesmo número
 *   - packages/shared/src/version.ts, lido por /health e pelo rodapé das telas
 *   - o package-lock.json, que guarda a versão de cada workspace e ficaria
 *     dessincronizado — o npm ci reclama de lock que não bate com os package.json
 *
 * Sem dependências: roda antes do npm install e dentro do hook de pre-commit.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const writeJson = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + "\n");

const action = process.argv[2];
const validActions = ["patch", "minor", "major", "sync"];
if (!validActions.includes(action)) {
  console.error(`Uso: node scripts/version.mjs ${validActions.join(" | ")}`);
  process.exit(1);
}

const rootPackage = join(root, "package.json");
const rootJson = readJson(rootPackage);
const [major, minor, patch] = rootJson.version.split(".").map(Number);

let next = rootJson.version;
if (action === "patch") next = `${major}.${minor}.${patch + 1}`;
if (action === "minor") next = `${major}.${minor + 1}.0`;
if (action === "major") next = `${major + 1}.0.0`;

rootJson.version = next;
writeJson(rootPackage, rootJson);

const workspaces = [];
for (const group of ["apps", "packages"]) {
  const folder = join(root, group);
  if (!existsSync(folder)) continue;
  for (const name of readdirSync(folder)) {
    const pkg = join(folder, name, "package.json");
    if (!existsSync(pkg)) continue;
    const json = readJson(pkg);
    json.version = next;
    writeJson(pkg, json);
    workspaces.push(`${group}/${name}`);
  }
}

const lock = join(root, "package-lock.json");
if (existsSync(lock)) {
  const json = readJson(lock);
  json.version = next;
  if (json.packages?.[""]) json.packages[""].version = next;
  for (const ws of workspaces) {
    if (json.packages?.[ws]) json.packages[ws].version = next;
  }
  writeJson(lock, json);
}

writeFileSync(
  join(root, "packages/shared/src/version.ts"),
  `// Gerado por scripts/version.mjs. Não editar à mão.\nexport const VERSION = "${next}";\n`,
);

console.log(`PostIt ${next}`);
