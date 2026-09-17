/**
 * O nome legível de um aparelho, a partir do user-agent (RF-H07).
 *
 * A tela de Perfil existe para alguém reconhecer um acesso que não é seu. Um
 * `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 …` não ajuda
 * ninguém a reconhecer nada; "Chrome no Windows" ajuda.
 *
 * ⚠️ **Isto é cosmético, e de propósito é raso.** User-agent mente por desenho:
 * todo navegador se diz "Mozilla", o Edge se diz Chrome, o Chrome no iPhone se
 * diz Safari por baixo. Nenhuma decisão de segurança pode sair daqui — quem
 * decide o que é sessão válida é o banco. Serve para a pessoa olhar a lista e
 * dizer "esse aí não sou eu".
 *
 * A ordem dos testes importa: os que se disfarçam vêm antes de quem eles imitam.
 */

/** Navegadores, do mais disfarçado para o menos. */
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\b(?:OPR|Opera)\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(?:CriOS|Chrome)\//, "Chrome"],
  [/\b(?:FxiOS|Firefox)\//, "Firefox"],
  [/\bSafari\//, "Safari"],
];

/** Sistemas. iPadOS ainda se anuncia como iPad, então vem antes do iPhone. */
const PLATFORMS: readonly (readonly [RegExp, string])[] = [
  [/\biPad\b/, "iPad"],
  [/\biPhone\b/, "iPhone"],
  [/\bAndroid\b/, "Android"],
  [/\bWindows\b/, "Windows"],
  [/\b(?:Macintosh|Mac OS X)\b/, "Mac"],
  [/\b(?:CrOS)\b/, "ChromeOS"],
  [/\bLinux\b/, "Linux"],
];

export interface DeviceName {
  readonly browser: string | null;
  readonly platform: string | null;
  /** O que a tela mostra: "Chrome no Windows", "Safari", ou "Aparelho desconhecido". */
  readonly label: string;
}

/** `true` quando o aparelho é de bolso — decide o ícone da lista. */
export function isHandheld(userAgent: string | null): boolean {
  if (userAgent === null) return false;
  return /\b(?:iPhone|iPad|Android|Mobile)\b/.test(userAgent);
}

export function describeDevice(userAgent: string | null): DeviceName {
  const browser = firstMatch(BROWSERS, userAgent);
  const platform = firstMatch(PLATFORMS, userAgent);

  return { browser, platform, label: labelFor(browser, platform) };
}

function firstMatch(table: readonly (readonly [RegExp, string])[], userAgent: string | null): string | null {
  if (userAgent === null || userAgent.trim().length === 0) return null;
  return table.find(([padrao]) => padrao.test(userAgent))?.[1] ?? null;
}

function labelFor(browser: string | null, platform: string | null): string {
  if (browser !== null && platform !== null) return `${browser} no ${platform}`;
  if (browser !== null) return browser;
  if (platform !== null) return platform;
  return "Aparelho desconhecido";
}
