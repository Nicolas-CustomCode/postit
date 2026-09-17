/**
 * Onde ficam as sessões guardadas pela preparação dos testes.
 *
 * Fica num módulo de apoio, e não no `auth.setup.ts`, porque o Playwright proíbe
 * um arquivo de teste importar outro — e a preparação é um teste.
 *
 * Os arquivos não entram no git: são credenciais de teste.
 */
export const ESTADO_SUPER_ADMIN = "e2e/.auth/super-admin.json";
export const ESTADO_COMUM = "e2e/.auth/comum.json";
