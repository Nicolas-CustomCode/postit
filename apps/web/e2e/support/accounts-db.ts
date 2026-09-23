import { createCipheriv, randomBytes } from "node:crypto";
import { Client } from "pg";

/**
 * Contas do Instagram direto no banco de teste, para os testes de tela.
 *
 * ⚠️ **Isto é infraestrutura de teste, não código do produto.** A regra de que o
 * `apps/web` nunca fala com o banco (AGENTS.md, regra 4) vale para o app: aqui é
 * o teste montando o cenário, como faz `admin:create` para os usuários. Nada em
 * `app/` ou `lib/` pode importar este arquivo — e o `pg` é dependência só de
 * desenvolvimento.
 *
 * Existe porque conectar conta de verdade depende do OAuth, que chega na
 * próxima entrega. Quando ele existir, o cenário passa a ser montado pelo fluxo
 * real contra a Meta falsa, e este arquivo some.
 */

const TABELAS = [
  // O motor de publicação (Fase 1d): o worker dos testes grava aqui.
  '"EventoPublicacao"',
  '"MetricaPostagem"',
  '"Publicacao"',
  '"ContainerPublicacao"',
  '"Aprovacao"',
  '"PostagemMidia"',
  '"Postagem"',
  '"Midia"',
  '"MetricaConta"',
  '"EventoToken"',
  '"Conta"',
];

async function comBanco<T>(usar: (cliente: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: process.env["TEST_DATABASE_URL"] });
  await client.connect();
  try {
    return await usar(client);
  } finally {
    await client.end();
  }
}

/** Zera as contas entre cenários: os testes do Jest deixam as suas para trás. */
export async function resetAccounts(): Promise<void> {
  await comBanco(async (client) => {
    await client.query(`TRUNCATE TABLE ${TABELAS.join(", ")} CASCADE`);
  });
}

export interface ContaDeTeste {
  readonly username: string;
  readonly name?: string;
  readonly timezone?: string;
  /** Dias até o token vencer — negativo para uma conta já sem acesso. */
  readonly tokenExpiresInDays?: number;
  /**
   * Com um token que a Meta falsa aceita, cifrado como a API cifra: é o que o
   * worker dos testes precisa para publicar de verdade (contra a Meta falsa).
   */
  readonly publishable?: boolean;
}

/** O token de longa duração da conta de testes na Meta falsa (`FAKE_META_LONG_TOKEN`). */
const FAKE_META_LONG_TOKEN = "fake-long-codigo-ok";

/**
 * A mesma cifra de `apps/api/src/common/crypto.ts` — AES-256-GCM, com o propósito
 * como dado autenticado. Repetida aqui porque o teste de tela não importa código
 * da API; se o envelope mudar lá, o teste de publicação quebra, que é o aviso certo.
 */
function cifrarToken(token: string): string {
  const key = Buffer.from(process.env["ENCRYPTION_KEY"] ?? "", "hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("instagram-token", "utf8"));
  const cifrado = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), cifrado.toString("base64url")].join(":");
}

export async function createAccount(conta: ContaDeTeste): Promise<void> {
  // O token nunca é decifrado nesta etapa: a listagem não o lê, e é justamente
  // isso que o teste da API prova. Aqui basta um texto qualquer.
  const tokenFalso = conta.publishable === true ? cifrarToken(FAKE_META_LONG_TOKEN) : `v1:teste:${conta.username}`;
  const expira = new Date(Date.now() + (conta.tokenExpiresInDays ?? 60) * 24 * 60 * 60 * 1000);

  await comBanco(async (client) => {
    await client.query(
      `INSERT INTO "Conta" (id, rede, "idExterno", username, nome, "tokenCifrado", "tokenExpiraEm", escopos, "fusoHorario", ativa, "criadoEm")
       VALUES (gen_random_uuid(), 'INSTAGRAM', $1, $2, $3, $4, $5, $6, $7, true, now())`,
      [
        `1784140${Math.floor(Math.random() * 1_000_000_000)}`,
        conta.username,
        conta.name ?? null,
        tokenFalso,
        expira,
        "instagram_business_basic",
        conta.timezone ?? "America/Sao_Paulo",
      ],
    );
  });
}
