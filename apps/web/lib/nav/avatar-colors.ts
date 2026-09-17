/**
 * As cores dos avatares de conta.
 *
 * Saem do artefato de identidade (docs/13, "Identidade visual"), artboard
 * `SeletorConta`: três pares fechados de fundo e texto, desenhados para ter
 * contraste suficiente com as iniciais em peso 800. **Não invente outras** —
 * cor gerada por matemática a partir do nome costuma cair em tons ilegíveis.
 *
 * A escolha vem do `@` da conta, não da posição na lista: a mesma conta fica com
 * a mesma cor em toda tela e depois de qualquer reordenação. É essa constância
 * que faz o avatar servir de reconhecimento rápido — e reconhecer a conta errada
 * é o erro mais caro que alguém comete aqui.
 */
export interface AvatarColor {
  readonly background: string;
  readonly foreground: string;
}

const PADRAO: AvatarColor = { background: "#262f9b", foreground: "#c6f432" };

const CORES: readonly AvatarColor[] = [
  PADRAO,
  { background: "#0b6b80", foreground: "#d3f5fb" },
  { background: "#171b47", foreground: "#a0b0ff" },
];

export function avatarColor(username: string): AvatarColor {
  let soma = 0;
  for (const caractere of username) soma = (soma * 31 + caractere.charCodeAt(0)) % 9973;
  return CORES[soma % CORES.length] ?? PADRAO;
}

/**
 * Duas letras: a inicial da primeira palavra e a da última. "Conta de testes"
 * vira CT, e não CD — o artigo no meio não diz nada.
 */
export function accountInitials(account: { readonly name: string | null; readonly username: string }): string {
  const base = account.name ?? account.username;
  const palavras = base.split(/[\s._-]+/).filter((palavra) => palavra.length > 0);
  const primeira = palavras.at(0) ?? base;
  const ultima = palavras.length > 1 ? (palavras.at(-1) ?? "") : "";

  return (primeira.slice(0, 1) + ultima.slice(0, 1)).toUpperCase();
}
