"use client";

import { Loader2, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { POST_FORMAT_LABELS } from "@repo/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { createPostAction } from "@/lib/actions/posts";

/**
 * Começar uma postagem (RF-C01).
 *
 * Só o começo: a postagem nasce em rascunho e a tela de composição assume dali.
 * A legenda aqui é opcional e existe para a tela ter propósito — sem ela seria
 * um botão sozinho, e um clique a mais entre a pessoa e o trabalho.
 *
 * **O formato não é escolha nesta fase.** Imagem de feed é o único que o sistema
 * publica; carrossel, vídeo, Reels e Stories chegam na Fase 2, e é aí que este
 * campo vira um seletor.
 */
export function NewPostForm({ username }: { readonly username: string }): ReactNode {
  const router = useRouter();
  const [caption, setCaption] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar(): Promise<void> {
    setOcupado(true);
    setErro(null);

    const resultado = await createPostAction(username, { caption: caption === "" ? null : caption });

    if (!resultado.ok) {
      setErro(resultado.message);
      setOcupado(false);
      return;
    }

    // Sem desligar o `ocupado`: a navegação já está a caminho, e reabilitar o
    // botão convidaria a um segundo rascunho vazio.
    router.push(`/c/${username}/postagens/${resultado.data.id}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label>Formato</Label>
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {POST_FORMAT_LABELS.FEED_IMAGE}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="legenda">Legenda</Label>
        <textarea
          id="legenda"
          value={caption}
          disabled={ocupado}
          onChange={(evento) => setCaption(evento.target.value)}
          rows={6}
          className="w-full rounded-lg border bg-transparent p-3 text-sm"
          placeholder="Pode começar por aqui, ou deixar para depois"
        />
        <p className="text-xs text-muted-foreground">A imagem e os contadores vêm na tela seguinte.</p>
      </div>

      {erro !== null && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{erro}</AlertDescription>
        </Alert>
      )}

      <Button type="button" className="h-11 self-start md:h-10" disabled={ocupado} onClick={() => void criar()}>
        {ocupado ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
        Criar rascunho
      </Button>
    </div>
  );
}
