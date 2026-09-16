import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSession } from "@/lib/auth/session";

/**
 * A raiz não desenha nada: decide para onde a pessoa vai.
 *
 * É o endereço gravado no aparelho quando o app é instalado (`start_url` do
 * manifesto), então ele precisa servir tanto a quem está logado quanto a quem
 * não está. Com o Bloco C, quem entra passa a cair na conta ativa.
 */
export default async function HomePage(): Promise<ReactNode> {
  redirect((await getSession()) === null ? "/entrar" : "/perfil");
}
