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
  /*
   * Os três endereços da Meta, separados porque a Meta os separa: a autorização
   * é no instagram.com, a troca do código é no api.instagram.com e o resto é no
   * graph.instagram.com (docs/08, "Fluxo de autorização").
   *
   * Existem como variável por um motivo só: o teste apontar para a Meta falsa.
   * Por isso a trava logo abaixo — trocar qualquer um deles fora de NODE_ENV=test
   * impede o processo de subir (AGENTS.md, regra 23).
   */
  META_AUTH_URL: z.string().url().default("https://www.instagram.com"),
  META_TOKEN_URL: z.string().url().default("https://api.instagram.com"),
  META_GRAPH_URL: z.string().url().default("https://graph.instagram.com"),
};

/** Os padrões acima, para a trava saber o que é "não foi trocado". */
const META_DEFAULTS = {
  META_AUTH_URL: "https://www.instagram.com",
  META_TOKEN_URL: "https://api.instagram.com",
  META_GRAPH_URL: "https://graph.instagram.com",
} as const;

/**
 * Recusa subir quando alguém aponta a Meta para outro lugar fora do teste.
 *
 * Falha barulhenta e cedo, no mesmo espírito do `assertTestEnvironment` da Meta
 * falsa. A alternativa — ignorar o valor em silêncio — deixaria quem configurou
 * errado descobrir pelo comportamento, e um erro de configuração que redireciona
 * token de verdade não pode depender de alguém reparar.
 */
function refuseMetaOverrideOutsideTests(
  value: Record<string, unknown>,
  ctx: z.RefinementCtx,
): void {
  if (value["NODE_ENV"] === "test") return;

  for (const [chave, padrao] of Object.entries(META_DEFAULTS)) {
    if (value[chave] !== padrao) {
      ctx.addIssue({
        code: "custom",
        path: [chave],
        message: `só pode ser trocada com NODE_ENV=test (AGENTS.md, regra 23)`,
      });
    }
  }
}

// Prazos e limites da autenticação. Os padrões são os valores decididos no
// ADR 0013 e no ADR 0015: ambiente sem estas variáveis continua correto, e
// mexer num número é ajuste de operação, não mudança de código.
const minutes = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const apiSchema = z.object({
  ...shared,
  APP_URL: z.string().url(),
  INTERNAL_API_KEY: z.string().min(32, "precisa ter ao menos 32 caracteres"),
  API_HOST: z.string().min(1),
  API_PORT: z.coerce.number().int().positive(),
  SESSION_IDLE_DAYS: z.coerce.number().int().positive().default(7),
  SESSION_MAX_DAYS: z.coerce.number().int().positive().default(30),
  TOTP_ISSUER: z.string().min(1).default("PostIt"),
  CHALLENGE_TTL_MINUTES: minutes(5),
  CHALLENGE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOCKOUT_WINDOW_MINUTES: minutes(30),
  LOCKOUT_ACCOUNT_ATTEMPTS: z.coerce.number().int().positive().default(10),
  LOCKOUT_ACCOUNT_MINUTES: minutes(15),
  LOCKOUT_IP_ATTEMPTS: z.coerce.number().int().positive().default(20),
  LOCKOUT_IP_MINUTES: minutes(30),
  LOCKOUT_REPEAT_MINUTES: minutes(60),
  LOCKOUT_REPEAT_WINDOW_HOURS: z.coerce.number().int().positive().default(24),
  SIGNUP_LINK_DAYS: z.coerce.number().int().positive().default(7),
  PASSWORD_RESET_LINK_HOURS: z.coerce.number().int().positive().default(24),
  RECENT_CONFIRMATION_MINUTES: minutes(15),
  STATE_SECRET: hex32,
  IG_REDIRECT_URI: z.preprocess(emptyAsMissing, z.string().url().optional()),
}).superRefine(refuseMetaOverrideOutsideTests);

const workerSchema = z
  .object({
    ...shared,
    /*
     * O push (ADR 0017). Opcionais **de propósito**: sem as três, o worker sobe e o
     * push fica desligado, com um aviso no log — o sino continua recebendo tudo.
     */
    VAPID_PUBLIC_KEY: optional,
    VAPID_PRIVATE_KEY: optional,
    VAPID_SUBJECT: optional,
    /** De quanto em quanto tempo o worker procura avisos ainda não enviados por push. */
    PUSH_SWEEP_SECONDS: z.coerce.number().int().positive().default(10),
    /*
     * O mesmo prazo de inatividade da API: é por ele que o worker sabe se a sessão
     * que ativou o push ainda está viva. Valores diferentes nos dois processos
     * fariam o push chegar a um aparelho cuja sessão a API já considera vencida.
     */
    SESSION_IDLE_DAYS: z.coerce.number().int().positive().default(7),
    /*
     * Só para o teste de tela: o despachante varre também a cada tantos segundos,
     * além do cron de um minuto. Fora de NODE_ENV=test o processo não sobe com ela —
     * em produção, varrer a cada segundo seria só carga sem motivo.
     */
    DISPATCH_TICK_SECONDS: z.preprocess(emptyAsMissing, z.coerce.number().int().positive().optional()),
  })
  .superRefine(refuseMetaOverrideOutsideTests)
  .superRefine((value, ctx) => {
    if (value.DISPATCH_TICK_SECONDS !== undefined && value.NODE_ENV !== "test") {
      ctx.addIssue({ code: "custom", path: ["DISPATCH_TICK_SECONDS"], message: "só vale com NODE_ENV=test" });
    }
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
