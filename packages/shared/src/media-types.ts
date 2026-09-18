import { IMAGE_UPLOAD_SPEC } from "./media-formats";

/**
 * O contrato do envio de mídia (RF-B01, RF-B02; ADR 0012).
 *
 * As **especificações** — o que cada formato aceita — moram em
 * [media-formats.ts](./media-formats.ts). Aqui ficam os tipos que atravessam a
 * fronteira entre a tela e a API, e a conferência barata que a tela faz antes de
 * gastar um envio.
 */

/** Texto alternativo, por acessibilidade (RF-B05). Opcional, nunca bloqueia. */
export const ALT_TEXT_MAX_LENGTH = 1000;

/**
 * O que a tela consegue conferir **sem abrir o arquivo**: só o que o navegador
 * entrega de graça no objeto `File`.
 *
 * Devolve o motivo ou `null`. A API confere tudo de novo, e mais — esta função
 * existe para evitar um envio de 8 MB que já se sabe condenado, não para
 * proteger (AGENTS.md, regra 17: quem decide é a API).
 *
 * Não confere proporção, e nem poderia: o `File` não traz dimensões. Também não
 * deveria — a proporção depende do formato de destino (RF-B03).
 */
export type MediaPreProblem = "WRONG_TYPE" | "TOO_LARGE" | "EMPTY";

export function imageUploadPreProblem(file: { type: string; size: number }): MediaPreProblem | null {
  // Sem o `; charset=`, que alguns navegadores acrescentam.
  const tipo = file.type.split(";")[0]?.trim().toLowerCase() ?? "";

  if (tipo !== IMAGE_UPLOAD_SPEC.mime) return "WRONG_TYPE";
  if (file.size === 0) return "EMPTY";
  if (file.size > IMAGE_UPLOAD_SPEC.maxBytes) return "TOO_LARGE";
  return null;
}

/** Megabytes com uma casa, para as mensagens: "Este arquivo tem 12,3 MB". */
export function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1).replace(".", ",");
}

/**
 * A permissão de envio que a API devolve (ADR 0012).
 *
 * O `url` é o endereço **público** do armazenamento; o interno nunca sai da API
 * (AGENTS.md, regra 4).
 *
 * A chave do objeto vem dentro de `fields.key` — o protocolo do S3 exige, é como
 * o armazenamento sabe onde gravar. O que amarra o envio a quem o pediu é o
 * `ticket`, e é ele que a confirmação exige.
 */
export interface UploadPermission {
  readonly url: string;
  /** Os campos assinados. Vão no formulário **antes** do arquivo. */
  readonly fields: Record<string, string>;
  /** O comprovante que a confirmação exige. Opaco para a tela. */
  readonly ticket: string;
  readonly expiresAt: string;
}

/** A mídia já validada e pública. O endereço é montado na leitura, não aqui. */
export interface MediaSummary {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
}
