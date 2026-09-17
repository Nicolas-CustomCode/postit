import type { ReactNode } from "react";
import type { AccountSummary } from "@repo/shared";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { accountInitials, avatarColor } from "@/lib/nav/avatar-colors";
import { cn } from "@/lib/utils";

/**
 * O avatar de uma conta do Instagram, do mesmo jeito em toda tela.
 *
 * A foto vem do nosso armazenamento (nunca do CDN da Meta, docs/adr/0012). Sem
 * foto, as iniciais sobre a cor fixa daquela conta.
 *
 * A cor entra por `style` porque não é uma cor do tema: é a cor daquela conta,
 * escolhida em tempo de execução. A CSP permite atributo `style`
 * (`style-src-attr`), e o valor sai de uma constante nossa — nada de usuário.
 */
export function AccountAvatar({
  account,
  className,
}: {
  readonly account: Pick<AccountSummary, "name" | "username" | "photoUrl">;
  readonly className?: string;
}): ReactNode {
  const cor = avatarColor(account.username);

  return (
    <Avatar className={cn("size-8 shrink-0", className)}>
      {account.photoUrl === null ? null : <AvatarImage src={account.photoUrl} alt="" />}
      <AvatarFallback
        className="text-xs font-extrabold"
        style={{ backgroundColor: cor.background, color: cor.foreground }}
      >
        {accountInitials(account)}
      </AvatarFallback>
    </Avatar>
  );
}
