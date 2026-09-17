import { LogOut } from "lucide-react";
import type { ReactNode } from "react";
import type { SessionUser } from "@repo/shared";
import { logoutAction } from "@/lib/actions/auth";
import { cn } from "@/lib/utils";

/**
 * O cartão de quem está usando: iniciais, nome, papel e a saída.
 *
 * Fica no rodapé da barra lateral no computador e no fim da folha "Mais" no
 * celular (artboard `ComposicaoDesktop`). Um componente só porque os dois
 * mostram a mesma coisa — e porque "Sair" em dois lugares diferentes é como
 * alguém sai sem querer de um lado e não acha do outro.
 */
export function UserCard({ user, className }: { readonly user: SessionUser; readonly className?: string }): ReactNode {
  return (
    <div className={cn("flex items-center gap-2.5 rounded-xl border p-2.5", className)}>
      <span className="flex size-8.5 shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-primary">
        {userInitials(user.name)}
      </span>

      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-semibold">{user.name}</span>
        <span className="truncate text-xs text-muted-foreground">{user.superAdmin ? "Super admin" : "Equipe"}</span>
      </span>

      <form action={logoutAction} className="ml-auto">
        <button
          type="submit"
          aria-label="Sair"
          title="Sair"
          className="flex size-11 items-center justify-center rounded-[10px] text-muted-foreground hover:bg-muted hover:text-foreground md:size-9"
        >
          <LogOut className="size-4.5" strokeWidth={2} aria-hidden />
        </button>
      </form>
    </div>
  );
}

/** As iniciais de quem está usando — "Marina Costa" vira MC. */
function userInitials(nome: string): string {
  const palavras = nome.split(/\s+/).filter((palavra) => palavra.length > 0);
  const primeira = palavras.at(0) ?? nome;
  const ultima = palavras.length > 1 ? (palavras.at(-1) ?? "") : "";

  return (primeira.slice(0, 1) + ultima.slice(0, 1)).toUpperCase();
}
