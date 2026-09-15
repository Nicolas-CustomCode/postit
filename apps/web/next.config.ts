import { withSerwist } from "@serwist/turbopack";
import { config as loadDotenv } from "dotenv";
import type { NextConfig } from "next";

/**
 * O .env único da raiz, carregado à mão.
 *
 * O Next lê o .env da pasta do projeto (apps/web) e não sobe até a raiz. Sem
 * esta linha, INTERNAL_API_KEY chega como undefined e toda chamada à API
 * responde 401, sem nada na tela explicando por quê (lição do nossobuncker).
 * Variável já presente no processo — a do container, a da CI — vence o arquivo.
 */
loadDotenv({ path: "../../.env", quiet: true });

/**
 * Nome do host do túnel, para o servidor de desenvolvimento aceitar o celular.
 *
 * O Next 16 recusa pedidos de outra origem aos arquivos de desenvolvimento, e a
 * página aberta pelo túnel desenha mas nunca fica interativa. A entrada é NOME
 * DE HOST, sem https:// — com esquema ela nunca casa, e o sintoma é o mesmo de
 * não ter entrada. Lido de APP_URL (docs/14); o Next ignora a chave em produção.
 */
function tunnelHost(): string[] {
  try {
    const { hostname } = new URL(process.env.APP_URL ?? "");
    return hostname === "localhost" ? [] : [hostname];
  } catch {
    return [];
  }
}

/**
 * Cabeçalhos de segurança fixos (docs/adr/0014, seção 3). Ficam aqui, e não no
 * proxy reverso, para valerem igual com o Traefik da etapa 1 e o Apache da
 * etapa 2 (docs/adr/0020). A CSP não está aqui: ela muda a cada página, por
 * causa do nonce, e é montada no proxy.ts.
 *
 * HSTS sem `preload`: sair da lista embutida nos navegadores leva meses.
 */
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "X-Frame-Options", value: "DENY" },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: tunnelHost(),
  // O next dev criaria apps/web/AGENTS.md e CLAUDE.md. A fonte de verdade para
  // agentes é o AGENTS.md da raiz, que já traz o aviso sobre o Next 16.
  agentRules: false,
  // Sem "X-Powered-By: Next.js": não há motivo para anunciar o framework.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

/**
 * withSerwist compila o service worker de app/sw.ts durante o build. O guia do
 * Next diz que o Serwist exige webpack; está desatualizado — @serwist/turbopack
 * é o caminho, como no nossobuncker.
 */
export default withSerwist(nextConfig);
