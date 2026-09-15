/**
 * A política de segurança de conteúdo (CSP), montada a cada página.
 * Decisão e o porquê de cada diretiva em docs/adr/0014 e docs/adr/0017.
 */

/**
 * A origem do domínio de mídia, lida uma vez no boot.
 *
 * Miniaturas e prévias vêm do MinIO, e o envio de arquivo vai direto para lá
 * (docs/adr/0012). Sem esta origem, a CSP bloqueia justamente as imagens que o
 * sistema existe para mostrar — nada desenha e nada aparece no log.
 */
function mediaOrigin(): string | null {
  try {
    return new URL(process.env.MINIO_PUBLIC_URL ?? "").origin;
  } catch {
    // Valor inválido não derruba a página: o boot (instrumentation.ts) já recusa
    // subir com MINIO_PUBLIC_URL errado.
    return null;
  }
}

const MEDIA = mediaOrigin();

/**
 * `upgrade-insecure-requests` só quando o app é servido por https. No local por
 * http, ele trocaria http://localhost por https://localhost, que não existe.
 */
const SERVED_OVER_HTTPS = (process.env.APP_URL ?? "").startsWith("https://");

/**
 * Sem `'strict-dynamic'`: ele descarta `'self'`, e os arquivos de script do Next
 * deixariam de ser permitidos pela origem.
 *
 * `style-src-attr 'unsafe-inline'`: menus e popovers do shadcn/ui posicionam
 * elementos pelo atributo `style`. Estilo não executa código; bloco `<style>`
 * continua exigindo nonce.
 *
 * Em desenvolvimento, `'unsafe-eval'` porque o React usa eval para mostrar a
 * pilha de erro do servidor no navegador. Em produção, nenhum dos dois usa.
 */
export function buildCsp(nonce: string, development: boolean): string {
  const media = MEDIA ? ` ${MEDIA}` : "";

  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'${development ? " 'unsafe-inline'" : ""}`,
    `style-src-attr 'unsafe-inline'`,
    // blob: é a prévia do arquivo antes do envio; data: é o SVG embutido.
    `img-src 'self' data: blob:${media}`,
    `media-src 'self' blob:${media}`,
    `connect-src 'self'${media}`,
    // As fontes são baixadas pelo next/font na construção e servidas pelo app.
    `font-src 'self'`,
    // Service worker e manifesto do app instalável (docs/adr/0017).
    `worker-src 'self'`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(SERVED_OVER_HTTPS ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
