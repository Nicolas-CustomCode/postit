import { Injectable } from "@nestjs/common";

/** Chamadas por autorização, por minuto (ADR 0029, decisão 6). */
export const MCP_CALLS_PER_MINUTE = 60;
const WINDOW_MS = 60 * 1000;

/**
 * Teto de chamadas ao `/mcp` por autorização, em janela fixa de um minuto.
 *
 * Em memória, e basta: o processo HTTP é um só nas duas etapas da infraestrutura.
 * Reiniciar zera a contagem, o que no pior caso deixa passar um minuto a mais — o
 * teto existe contra assistente em laço, não contra ataque (quem tem o token já
 * pode compor rascunhos).
 */
@Injectable()
export class McpRateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  /** `true` se a chamada pode seguir; conta a chamada. */
  take(grantId: string, now: Date): boolean {
    const at = now.getTime();
    const window = this.windows.get(grantId);
    if (window === undefined || at - window.start >= WINDOW_MS) {
      this.sweep(at);
      this.windows.set(grantId, { start: at, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= MCP_CALLS_PER_MINUTE;
  }

  /** Janelas vencidas saem, para o mapa não crescer com autorizações que já pararam. */
  private sweep(at: number): void {
    for (const [grantId, window] of this.windows) {
      if (at - window.start >= WINDOW_MS) this.windows.delete(grantId);
    }
  }
}
