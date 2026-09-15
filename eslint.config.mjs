/**
 * ESLint da API, do shared e do database. O `eslint` de cada pacote sobe as
 * pastas até achar esta configuração. O web tem a dele (apps/web/eslint.config.mjs),
 * com as regras do Next, e ela é achada primeiro.
 */
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["**/dist/**", "**/src/generated/**", "**/coverage/**", "apps/web/**"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      // Variável que começa com _ é descartada de propósito.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    // Configurações do Jest e scripts do Node: CommonJS por necessidade.
    files: ["**/*.js", "**/*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: globals.node },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
]);
