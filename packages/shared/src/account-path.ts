/**
 * A conta ativa mora no endereço da página: `/c/<conta>/<seção>` (AGENTS.md,
 * regra 24).
 *
 * Esta é a **única** leitura desse endereço no projeto. O `proxy.ts` usa para
 * gravar o cookie da última conta, e o `useActiveAccount()` do Next usa para a
 * casca saber em que conta a pessoa está.
 *
 * ⚠️ Mora aqui, e não em cada um, porque as duas leituras precisam concordar
 * **sempre**. Se um dia uma ganhar normalização — minúsculas, `trim`, tirar o
 * `@` — e a outra não, o sistema passa a abrir numa conta e marcar outra como
 * ativa no seletor. Agir na conta errada é o erro mais caro que alguém comete
 * neste produto.
 */
export interface AccountPath {
  /** O `@` da conta quando a tela é de uma conta; `null` nas telas gerais. */
  readonly username: string | null;
  /** O que vem depois da conta, para trocar de conta sem sair da mesma tela. */
  readonly section: string;
}

/** A seção que vale quando o endereço não diz qual é. */
export const DEFAULT_SECTION = "calendario";

export function accountFromPath(pathname: string): AccountPath {
  /*
   * Fatia por posição, sem descartar os pedaços vazios. Descartá-los faria
   * `/c//calendario` virar conta chamada "calendario" — o endereço está
   * malformado, e promover a seção a nome de conta manda a pessoa para uma
   * conta que não existe em vez de para a lista.
   */
  const partes = pathname.replace(/^\//, "").split("/");
  if (partes[0] !== "c") return { username: null, section: DEFAULT_SECTION };

  return {
    username: decodeSafely(partes[1]),
    section: partes[2] === undefined || partes[2].length === 0 ? DEFAULT_SECTION : partes[2],
  };
}

/**
 * `decodeURIComponent` **lança** em percentual malformado, como `/c/%zz/x`.
 *
 * No proxy isso derruba a requisição; no componente de cliente, apagaria a
 * casca inteira durante o render. Endereço estranho vira "nenhuma conta", que é
 * o que o resto do sistema já sabe tratar — quem confere se a conta existe é o
 * layout da conta, e ele desvia para a lista.
 */
function decodeSafely(bruto: string | undefined): string | null {
  if (bruto === undefined || bruto.length === 0) return null;

  try {
    return decodeURIComponent(bruto) || null;
  } catch {
    return null;
  }
}
