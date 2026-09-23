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
/** Só `POSTAGEM_EDITAR`: compõe e envia para revisão, não aprova (ADR 0015, atalho "Editor"). */
export const ESTADO_EDITOR = "e2e/.auth/editor.json";
/** `POSTAGEM_EDITAR` e `POSTAGEM_APROVAR`, sem agendar (atalho "Aprovador"). */
export const ESTADO_APROVADOR = "e2e/.auth/aprovador.json";
