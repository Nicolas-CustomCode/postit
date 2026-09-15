/**
 * Roda uma vez, quando o servidor do Next sobe.
 *
 * Valida as variáveis aqui, e não no next.config: o build da imagem Docker não
 * tem os segredos, e só o processo que vai atender páginas precisa deles.
 * Variável faltando impede o servidor de subir.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { readWebEnv } = await import("./lib/env");
  readWebEnv();
}
