import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * O comprovante de envio: a autorização para **confirmar** o que foi enviado.
 *
 * **O problema que ele resolve.** A confirmação precisa saber de qual objeto
 * está falando, e a `Midia` só passa a existir depois — não há no banco nenhum
 * registro pendente onde conferir dono. Se a rota aceitasse a chave direto,
 * qualquer sessão com permissão de editar confirmaria o envio de outra pessoa e
 * ficaria com a mídia dela.
 *
 * ⚠️ **Não é sigilo da chave.** A chave vai para o navegador de qualquer jeito,
 * no campo `key` do formulário — é assim que o protocolo do S3 diz ao MinIO onde
 * gravar, e não há como esconder. O que o comprovante carrega é a **prova de que
 * esta pessoa pediu esta chave**, assinada, com prazo.
 *
 * Mesmo desenho do `state` do OAuth (`instagram/oauth.service.ts`): corpo em
 * base64url, ponto, HMAC.
 */

export interface UploadTicket {
  readonly objectKey: string;
  readonly userId: string;
  readonly contentType: string;
  readonly maxBytes: number;
  /** Quando o comprovante deixa de valer, em milissegundos. */
  readonly expiresAt: number;
}

export function signUploadTicket(ticket: UploadTicket, secret: Buffer): string {
  const corpo = Buffer.from(
    JSON.stringify({
      k: ticket.objectKey,
      u: ticket.userId,
      t: ticket.contentType,
      m: ticket.maxBytes,
      e: ticket.expiresAt,
      // Dois envios do mesmo usuário no mesmo milissegundo não geram o mesmo
      // texto. Não é conferido na volta: a chave já é única.
      n: randomBytes(8).toString("base64url"),
    }),
    "utf8",
  ).toString("base64url");

  return `${corpo}.${sign(corpo, secret)}`;
}

/**
 * Lê o comprovante, ou devolve `null`.
 *
 * **Um `null` só, para todos os motivos** — assinatura errada, prazo vencido,
 * formato estranho, dono diferente. Distinguir diria a quem forja exatamente o
 * que ele acertou, e é a mesma postura do `verifyState` do OAuth.
 */
export function readUploadTicket(
  raw: string,
  userId: string,
  secret: Buffer,
  now: Date,
): UploadTicket | null {
  const partes = raw.split(".");
  if (partes.length !== 2) return null;

  const [corpo, assinatura] = partes as [string, string];
  if (!signatureMatches(corpo, assinatura, secret)) return null;

  let dados: unknown;
  try {
    dados = JSON.parse(Buffer.from(corpo, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  // `JSON.parse("null")` devolve null com sucesso, sem lançar: sem esta linha,
  // um corpo `null` escaparia do catch e só estouraria ao ler um campo.
  if (typeof dados !== "object" || dados === null) return null;

  const { k, u, t, m, e } = dados as Record<string, unknown>;
  if (typeof k !== "string" || typeof u !== "string" || typeof t !== "string") return null;
  if (typeof m !== "number" || typeof e !== "number") return null;

  if (u !== userId) return null;
  if (e < now.getTime()) return null;

  return { objectKey: k, userId: u, contentType: t, maxBytes: m, expiresAt: e };
}

function sign(corpo: string, secret: Buffer): string {
  return createHmac("sha256", secret).update(corpo).digest("base64url");
}

/** Comparação de tempo constante: com `===`, o tempo entrega a assinatura. */
function signatureMatches(corpo: string, recebida: string, secret: Buffer): boolean {
  const esperada = Buffer.from(sign(corpo, secret), "utf8");
  const dada = Buffer.from(recebida, "utf8");

  return esperada.length === dada.length && timingSafeEqual(esperada, dada);
}
