/**
 * Liga os hooks versionados em .githooks, como no hotclone.
 *
 * Roda no postinstall. Fora de um repositório git (a imagem Docker de produção,
 * por exemplo) não faz nada — falhar aqui quebraria o npm install.
 */

import { existsSync } from "node:fs";
import { execSync } from "node:child_process";

if (!existsSync(".git")) process.exit(0);

try {
  execSync("git config core.hooksPath .githooks", { stdio: "ignore" });
} catch {
  // git ausente no PATH: o hook só deixa de subir a versão sozinho.
}
