import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

/**
 * Invariante I-9: **só o worker publica** (AGENTS.md, regra 1).
 *
 * O teste percorre os imports a partir de `app.module.ts` — o processo HTTP — e
 * falha se algum arquivo alcançável estiver em `publishing/` ou `queues/`.
 *
 * Por que um teste, e não confiança: o dia em que alguém importar o despachante
 * para "reaproveitar uma função", o processo HTTP passa a poder publicar, e nada
 * quebra na hora. O defeito aparece como postagem publicada duas vezes, semanas
 * depois.
 */
const SRC = __dirname;
const FORBIDDEN = ["publishing", "queues"];

function resolveImport(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, join(base, "index.ts")]) {
    try {
      readFileSync(candidate);
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function reachableFrom(entry: string): string[] {
  const visited = new Set<string>();
  const queue = [entry];

  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (visited.has(file)) continue;
    visited.add(file);

    const source = readFileSync(file, "utf8");
    const specifiers = [...source.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((match) => match[1] ?? "");
    for (const specifier of specifiers) {
      const target = resolveImport(file, specifier);
      if (target !== null) queue.push(target);
    }
  }

  return [...visited];
}

describe("arquitetura", () => {
  const alcancaveis = reachableFrom(join(SRC, "app.module.ts")).map((file) => relative(SRC, file).replace(/\\/g, "/"));

  it("o processo HTTP alcança os módulos que deve alcançar", () => {
    // Se a varredura parasse no primeiro arquivo, o teste passaria vazio.
    expect(alcancaveis).toContain("auth/auth.controller.ts");
    expect(alcancaveis.length).toBeGreaterThan(20);
  });

  it("o processo HTTP não alcança publicação nem filas", () => {
    const proibidos = alcancaveis.filter((file) => FORBIDDEN.some((pasta) => file.startsWith(`${pasta}/`)));
    expect(proibidos).toEqual([]);
  });

  it("a Meta falsa não entra no processo HTTP", () => {
    // Ela só sobe pelo próprio ponto de entrada, e só com NODE_ENV=test.
    expect(alcancaveis.filter((file) => file.startsWith("fake-meta/"))).toEqual([]);
  });
});
