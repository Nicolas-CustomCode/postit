/**
 * Especificações de mídia para imagem de feed (docs/08, "Imagens — feed e itens
 * de carrossel"; RF-B02).
 *
 * **Uma lista só, usada pelas duas pontas**, que é o motivo de morar aqui: a
 * tela avisa **antes** de enviar o que dá para saber sem abrir o arquivo — tipo
 * e tamanho —, e a API confere **de verdade** depois, com as dimensões (docs/02,
 * RF-B02). Duas listas que discordassem deixariam o usuário enviar 8 MB para
 * ouvir um "não" do outro lado.
 *
 * Estes números também limitam a política de envio assinada: é o MinIO que
 * recusa tipo e tamanho errados, antes de qualquer byte chegar à API
 * (ADR 0012).
 */

/** Só JPEG. PNG, WebP, HEIC e AVIF são recusados (docs/08). */
export const FEED_IMAGE_MIME = "image/jpeg";

/**
 * O limite de 8 MB da Meta, em bytes.
 *
 * ⚠️ **Decimal, e é uma escolha conservadora.** A documentação da Meta diz
 * "8MB" sem dizer a base; 8 MiB seriam 8.388.608. Aceitar o valor maior
 * deixaria passar um arquivo que ela recusaria **na hora de publicar** — e o
 * docs/08 diz que erro de mídia não deveria chegar lá. Recusar cedo, com
 * mensagem clara, custa menos do que uma publicação que falha sozinha de
 * madrugada.
 */
export const FEED_IMAGE_MAX_BYTES = 8_000_000;

/**
 * Largura mínima. Abaixo disso a Meta renderiza mal.
 *
 * ⚠️ **Não há máximo.** O docs/08 lista 1440 px, mas a Meta não devolve erro
 * para largura e redimensiona sozinha — e foto de celular passa de 3000 px.
 * Recusar barraria quase todo envio vindo do telefone, e o redimensionamento
 * automático (RF-B06) está marcado como "Depois". Decisão registrada no docs/08.
 */
export const FEED_IMAGE_MIN_WIDTH = 320;

/**
 * A faixa de proporção aceita: de 4:5 (retrato) a 1.91:1 (paisagem).
 *
 * Guardada como fração inteira de propósito. Comparar `largura / altura` com
 * `1.91` traz a pergunta "1,9115 passa?" e a resposta muda com arredondamento;
 * com inteiros, `largura * 100 <= altura * 191` é exato e não depende de ponto
 * flutuante.
 */
export const FEED_IMAGE_MIN_RATIO = { width: 4, height: 5 } as const;
export const FEED_IMAGE_MAX_RATIO = { width: 191, height: 100 } as const;

/** Como a faixa aparece para quem lê a mensagem de recusa. */
export const FEED_IMAGE_RATIO_LABEL = "4:5 a 1.91:1";

/** Texto alternativo, por acessibilidade (RF-B05). Opcional, nunca bloqueia. */
export const ALT_TEXT_MAX_LENGTH = 1000;

/**
 * O que a tela consegue conferir **sem abrir o arquivo**: só o que o navegador
 * entrega de graça no objeto `File`.
 *
 * Devolve o motivo ou `null`. A API confere tudo de novo, e mais — esta função
 * existe para evitar um envio de 8 MB que já se sabe condenado, não para
 * proteger (AGENTS.md, regra 17: quem decide é a API).
 */
export type MediaPreProblem = "WRONG_TYPE" | "TOO_LARGE" | "EMPTY";

export function feedImagePreProblem(file: { type: string; size: number }): MediaPreProblem | null {
  // Sem o `; charset=`, que alguns navegadores acrescentam.
  const tipo = file.type.split(";")[0]?.trim().toLowerCase() ?? "";

  if (tipo !== FEED_IMAGE_MIME) return "WRONG_TYPE";
  if (file.size === 0) return "EMPTY";
  if (file.size > FEED_IMAGE_MAX_BYTES) return "TOO_LARGE";
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
