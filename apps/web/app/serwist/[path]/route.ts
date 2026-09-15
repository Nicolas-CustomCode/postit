import { spawnSync } from "node:child_process";

import { createSerwistRoute } from "@serwist/turbopack";

/**
 * Versão da página offline guardada. Sai do commit: mudou o commit, o navegador
 * busca a página nova. Sem git — a construção da imagem Docker não leva a pasta
 * .git —, cai num valor aleatório, que invalida sempre. Perder cache é o lado
 * seguro de errar.
 */
const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() || crypto.randomUUID();

export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } = createSerwistRoute({
  swSrc: "app/sw.ts",
  additionalPrecacheEntries: [{ url: "/~offline", revision }],
  useNativeEsbuild: true,
});
