import { Check, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { Permission, SessionUser } from "@repo/shared";
import { cn } from "@/lib/utils";

/**
 * Quem é a pessoa e o que ela pode fazer (artboard `PerfilDesktop`).
 *
 * As permissões nunca tinham sido mostradas em lugar nenhum. É esta lista que
 * responde "por que eu não vejo o botão de aprovar?" sem ninguém precisar
 * perguntar — e **não é proteção**: quem decide é a API (AGENTS.md, regra 17).
 */
const ROTULOS: Record<Permission, string> = {
  POST_EDIT: "Editar postagens",
  POST_APPROVE: "Aprovar",
  POST_APPROVE_OWN: "Aprovar as próprias",
  POST_SCHEDULE: "Agendar",
  ACCOUNT_MANAGE: "Gerenciar contas",
};

export function IdentityCard({
  user,
  memberSince,
}: {
  readonly user: SessionUser;
  readonly memberSince: ReactNode;
}): ReactNode {
  return (
    <section className="flex flex-col gap-3.5 rounded-2xl border bg-card p-5">
      <div className="flex flex-col items-center gap-3 text-center md:flex-row md:items-center md:gap-4 md:text-left">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-accent text-[23px] font-extrabold text-primary md:size-[72px] md:text-[26px]">
          {userInitials(user.name)}
        </span>

        <div className="flex min-w-0 flex-col items-center gap-1 md:items-start">
          <p className="font-heading text-[19px] font-bold tracking-[-0.01em] md:text-xl">{user.name}</p>
          <p className="max-w-full truncate text-sm text-muted-foreground">{user.email}</p>
          <span
            className={cn(
              "flex h-6 items-center rounded-full px-2.5 text-xs font-bold",
              user.superAdmin ? "bg-accent text-primary" : "bg-muted text-foreground",
            )}
          >
            {user.superAdmin ? "Super admin" : "Equipe"}
          </span>
        </div>
      </div>

      <div className="h-px bg-border" />
      <p className="text-center text-[13px] text-muted-foreground md:text-left">No PostIt desde {memberSince}</p>
    </section>
  );
}

export function PermissionsCard({ user }: { readonly user: SessionUser }): ReactNode {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border bg-card p-4 md:p-5">
      <h2 className="font-heading text-[17px] font-bold md:text-lg">O que você pode fazer</h2>

      {user.superAdmin ? (
        <div className="flex items-start gap-2.5 rounded-xl bg-accent p-3">
          <ShieldCheck className="mt-px size-5 shrink-0 text-primary" strokeWidth={2} aria-hidden />
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-bold text-primary">Super admin</p>
            <p className="text-[13px] leading-normal text-muted-foreground">
              Todas as permissões, em todas as contas. Administrar pessoas exige o código do aplicativo de novo.
            </p>
          </div>
        </div>
      ) : user.permissions.length === 0 ? (
        <p className="text-[13px] leading-normal text-muted-foreground">
          Você ainda não tem permissão para agir — dá para ver o que está agendado, mas não para criar nem aprovar.
          Peça a um super admin.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {user.permissions.map((permissao) => (
            <li
              key={permissao}
              className="flex h-7 items-center gap-1.5 rounded-full bg-accent px-2.5 text-[13px] font-semibold text-primary"
            >
              <Check className="size-3.5" strokeWidth={2.6} aria-hidden />
              {ROTULOS[permissao]}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs leading-normal text-muted-foreground">Quem dá e tira permissão é um super admin.</p>
    </section>
  );
}

/** "Marina Costa" vira MC — o mesmo critério do cartão da barra lateral. */
function userInitials(nome: string): string {
  const palavras = nome.split(/\s+/).filter((palavra) => palavra.length > 0);
  const primeira = palavras.at(0) ?? nome;
  const ultima = palavras.length > 1 ? (palavras.at(-1) ?? "") : "";

  return (primeira.slice(0, 1) + ultima.slice(0, 1)).toUpperCase();
}
