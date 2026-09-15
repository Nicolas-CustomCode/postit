/**
 * Variáveis de ambiente do Next, validadas com zod no boot (instrumentation.ts).
 *
 * Só o que o web usa. Nada de banco nem credencial do MinIO: o Next nunca os
 * acessa (AGENTS.md, regra 4). MINIO_PUBLIC_URL entra só para a CSP liberar as
 * imagens e o envio direto ao MinIO.
 */
import { z } from "zod";

const webSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url(),
  INTERNAL_API_URL: z.string().url(),
  INTERNAL_API_KEY: z.string().min(32, "precisa ter ao menos 32 caracteres"),
  MINIO_PUBLIC_URL: z.string().url(),
});

export type WebEnv = z.infer<typeof webSchema>;

export function readWebEnv(source: NodeJS.ProcessEnv = process.env): WebEnv {
  const result = webSchema.safeParse(source);
  if (result.success) return result.data;

  // Só o NOME da variável e o problema — nunca o valor, que pode ser segredo.
  const problems = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Variáveis de ambiente inválidas para o processo web:\n${problems}`);
}
