/**
 * Variáveis de ambiente, validadas com zod no boot (docs/10, "Variáveis de ambiente").
 *
 * Cada processo valida só o que usa: a API não precisa das chaves VAPID, e o
 * worker não precisa da chave interna nem do state do OAuth. Variável faltando
 * ou inválida impede o processo de subir — melhor do que descobrir no meio de
 * uma publicação.
 *
 * Integração com a Meta e push ainda são opcionais: entram obrigatórias quando
 * esses módulos forem construídos (Fase 0, Bloco C, e Fase 1).
 */
import { config } from "dotenv";
import path from "node:path";
import { z } from "zod";

// .env único na raiz. src/config e dist/config ficam na mesma profundidade, então
// o caminho vale para o código-fonte e para o compilado. Em produção não há
// arquivo: as variáveis já vêm do Easypanel, e o dotenv não sobrescreve.
config({ path: path.resolve(__dirname, "../../../../.env"), quiet: true });

const hex32 = z.string().regex(/^[0-9a-f]{64}$/i, "precisa ter 32 bytes em hexadecimal (64 caracteres)");

// `IG_APP_ID=` vazio no .env conta como ausente, não como texto de tamanho zero.
const emptyAsMissing = (value: unknown) => (value === "" ? undefined : value);
const optional = z.preprocess(emptyAsMissing, z.string().min(1).optional());

const shared = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  MINIO_ENDPOINT: z.string().url(),
  MINIO_ROOT_USER: z.string().min(1),
  MINIO_ROOT_PASSWORD: z.string().min(1),
  MINIO_BUCKET: z.string().min(1),
  MINIO_PUBLIC_URL: z.string().url(),
  ENCRYPTION_KEY: hex32,
  IG_APP_ID: optional,
  IG_APP_SECRET: optional,
  IG_API_VERSION: z.string().default("v26.0"),
};

const apiSchema = z.object({
  ...shared,
  APP_URL: z.string().url(),
  INTERNAL_API_KEY: z.string().min(32, "precisa ter ao menos 32 caracteres"),
  API_HOST: z.string().min(1),
  API_PORT: z.coerce.number().int().positive(),
  SESSION_IDLE_DAYS: z.coerce.number().int().positive().default(7),
  SESSION_MAX_DAYS: z.coerce.number().int().positive().default(30),
  TOTP_ISSUER: z.string().min(1).default("PostIt"),
  STATE_SECRET: hex32,
  IG_REDIRECT_URI: z.preprocess(emptyAsMissing, z.string().url().optional()),
});

const workerSchema = z.object({
  ...shared,
  VAPID_PUBLIC_KEY: optional,
  VAPID_PRIVATE_KEY: optional,
  VAPID_SUBJECT: optional,
});

export type ApiEnv = z.infer<typeof apiSchema>;
export type WorkerEnv = z.infer<typeof workerSchema>;

function validate<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv, processName: string): z.infer<T> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;

  // Só o NOME da variável e o problema — nunca o valor, que pode ser segredo.
  const problems = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
  throw new Error(`Variáveis de ambiente inválidas para o processo ${processName}:\n${problems}`);
}

export const readApiEnv = (source: NodeJS.ProcessEnv = process.env): ApiEnv => validate(apiSchema, source, "api");
export const readWorkerEnv = (source: NodeJS.ProcessEnv = process.env): WorkerEnv =>
  validate(workerSchema, source, "worker");
