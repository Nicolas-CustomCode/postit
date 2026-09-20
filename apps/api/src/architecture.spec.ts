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

  /**
   * Invariante I-2: **editar conteúdo derruba a postagem para rascunho**
   * (docs/05; RF-E05).
   *
   * A garantia é estrutural, não de memória: só `posts.domain.service.ts` escreve
   * na tabela, e lá dentro só dois primitivos privados o fazem. Este teste é o
   * que transforma "lembrar" em "a CI barra".
   *
   * O modo de falha que ele previne: alguém acrescenta uma rota de conteúdo daqui
   * a três meses, chama `post.update` direto, esquece de rebaixar — e o sistema
   * passa a publicar uma legenda que ninguém aprovou. Nada quebra na hora.
   */
  describe("I-2: uma porta só para escrever postagem", () => {
    /*
     * Uma função, e não uma constante: `RegExp` com a flag `g` guarda
     * `lastIndex` entre chamadas, e reusar a mesma instância num `filter` faria
     * o segundo arquivo começar a busca do meio — dando "nenhum infrator" por
     * acidente, que é a pior falha possível num teste de garantia.
     */
    const escritasEm = (fonte: string): string[] =>
      fonte.match(/\b(?:post|postMedia|approval)\.(?:update|updateMany|create|createMany|delete|deleteMany|upsert)\b/g) ??
      [];
    const DOMAIN_SERVICE = "posts/posts.domain.service.ts";

    const arquivosDePostagem = alcancaveis.filter((file) => file.startsWith("posts/") && !file.endsWith(".spec.ts"));

    it("a varredura encontra os arquivos do módulo", () => {
      expect(arquivosDePostagem).toContain(DOMAIN_SERVICE);
      expect(arquivosDePostagem).toContain("posts/posts.query.service.ts");
    });

    it("nenhum arquivo do módulo escreve na tabela, fora o serviço de domínio", () => {
      const infratores = arquivosDePostagem
        .filter((file) => file !== DOMAIN_SERVICE)
        .filter((file) => escritasEm(readFileSync(join(SRC, file), "utf8")).length > 0);

      expect(infratores).toEqual([]);
    });

    /*
     * Dentro do próprio serviço, as escritas moram nos dois primitivos e no
     * `create`. Contá-las prende o número: uma escrita nova em outro lugar muda
     * a conta e o teste chama atenção para ela.
     */
    it("as escritas do serviço cabem nos dois primitivos e na criação", () => {
      const escritas = escritasEm(readFileSync(join(SRC, DOMAIN_SERVICE), "utf8"));

      expect(escritas.sort()).toEqual([
        // create()
        "post.create",
        // applyUserWrite(): a trava otimista
        "post.updateMany",
        // applyContentChange(): o registro de I-2
        "approval.create",
        // markReady(): as duas linhas do caminho
        "approval.createMany",
        // setMedia(): apagar e recriar, uma imagem em position 0
        "postMedia.create",
        "postMedia.deleteMany",
      ].sort());
    });
  });
});
