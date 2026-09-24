"use client";

import { Bell, BellOff, Share, Smartphone } from "lucide-react";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { PUSH_TYPE_LABELS, type PushPreference } from "@repo/shared";
import { Button } from "@/components/ui/button";
import {
  removePushSubscriptionAction,
  requestPushTestAction,
  savePushSubscriptionAction,
  setPushPreferenceAction,
} from "@/lib/actions/notifications";
import { isAndroid, isIos, isStandalone, pushSupported, subscriptionInput, vapidKeyBytes } from "@/lib/pwa/device";
import { cn } from "@/lib/utils";

/**
 * As notificações do Perfil (RF-J02, RF-J04; docs/04, 11.1).
 *
 * Duas partes, que respondem a perguntas diferentes:
 * - **este aparelho** recebe push? — diz o estado antes de oferecer o botão;
 * - **que tipos** vão por push? — vale para todos os aparelhos da pessoa.
 *
 * O pedido de permissão **só sai do botão** (RF-J02): nunca ao abrir o sistema.
 * Ativar já pede um push de teste, para a pessoa ver chegar e saber que funcionou.
 */
type Aparelho =
  | { readonly estado: "carregando" | "sem-suporte" | "iphone-sem-instalar" | "sem-chave" | "negado" | "desligado" }
  | { readonly estado: "ativo"; readonly endpoint: string };

export function NotificationsCard({
  vapidPublicKey,
  preferences,
}: {
  /** A chave pública do push, ou `null` quando o envio não está configurado no servidor. */
  readonly vapidPublicKey: string | null;
  readonly preferences: readonly PushPreference[];
}): ReactNode {
  const [aparelho, setAparelho] = useState<Aparelho>({ estado: "carregando" });
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [ocupado, iniciar] = useTransition();

  useEffect(() => {
    void descobrirEstado(vapidPublicKey).then(setAparelho);
  }, [vapidPublicKey]);

  function ativar(): void {
    if (vapidPublicKey === null) return;
    setAviso(null);
    iniciar(async () => {
      const permissao = await Notification.requestPermission();
      if (permissao === "denied") return setAparelho({ estado: "negado" });
      if (permissao !== "granted") return;

      try {
        const registro = await navigator.serviceWorker.ready;
        const inscricao = await registro.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidKeyBytes(vapidPublicKey),
        });
        const dados = subscriptionInput(inscricao);
        const salvo = dados === null ? null : await savePushSubscriptionAction(dados);

        if (dados === null || salvo === null || !salvo.ok) {
          // Sem a API saber da inscrição, ela não serve: desfaz no navegador também.
          await inscricao.unsubscribe();
          return setAviso({ tipo: "erro", texto: salvo?.ok === false ? salvo.message : "Não consegui ativar." });
        }

        await requestPushTestAction(dados.endpoint);
        setAparelho({ estado: "ativo", endpoint: dados.endpoint });
        setAviso({ tipo: "ok", texto: "Pronto. Uma notificação de teste chega a este aparelho em alguns segundos." });
      } catch {
        setAviso({ tipo: "erro", texto: "O navegador não conseguiu ativar as notificações. Tente de novo." });
      }
    });
  }

  function testar(endpoint: string): void {
    setAviso(null);
    iniciar(async () => {
      const resultado = await requestPushTestAction(endpoint);
      setAviso(
        resultado.ok
          ? { tipo: "ok", texto: "Notificação de teste a caminho. Chega em alguns segundos." }
          : { tipo: "erro", texto: resultado.message },
      );
    });
  }

  function desativar(endpoint: string): void {
    setAviso(null);
    iniciar(async () => {
      const registro = await navigator.serviceWorker.getRegistration();
      await (await registro?.pushManager.getSubscription())?.unsubscribe();
      await removePushSubscriptionAction(endpoint);
      setAparelho({ estado: "desligado" });
      setAviso({ tipo: "ok", texto: "Este aparelho não recebe mais notificações. O sino continua recebendo tudo." });
    });
  }

  return (
    <section className="flex flex-col rounded-2xl border bg-card p-4 md:p-5" aria-labelledby="notificacoes-titulo">
      <h2 id="notificacoes-titulo" className="pb-2.5 font-heading text-[17px] font-bold md:pb-3.5 md:text-lg">
        Notificações
      </h2>

      <div className="flex flex-col gap-2.5 py-3 md:flex-row md:items-center md:gap-3">
        {aparelho.estado === "ativo" ? (
          <Bell className="size-5 shrink-0" strokeWidth={2} aria-hidden />
        ) : (
          <BellOff className="size-5 shrink-0" strokeWidth={2} aria-hidden />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm font-bold">Neste aparelho</p>
          <div className="text-[13px] leading-normal text-muted-foreground">{estadoDoAparelho(aparelho)}</div>
        </div>

        {aparelho.estado === "desligado" && (
          <Button onClick={ativar} disabled={ocupado} className="h-11 w-full md:h-10 md:w-auto">
            {ocupado ? "Ativando…" : "Ativar notificações neste aparelho"}
          </Button>
        )}
      </div>

      {/*
        Duas ações não cabem ao lado do texto: espremiam o estado numa coluna de uma
        palavra por linha. Descem para baixo dele, alinhadas ao texto e não ao ícone,
        como os formulários do cartão de segurança.
      */}
      {aparelho.estado === "ativo" && (
        <div className="flex flex-col gap-2 pb-3 md:flex-row md:pl-8">
          <Button
            variant="secondary"
            onClick={() => testar(aparelho.endpoint)}
            disabled={ocupado}
            className="h-11 w-full md:h-10 md:w-auto"
          >
            Enviar notificação de teste
          </Button>
          <Button
            variant="ghost"
            onClick={() => desativar(aparelho.endpoint)}
            disabled={ocupado}
            className="h-11 w-full md:h-10 md:w-auto"
          >
            Desativar neste aparelho
          </Button>
        </div>
      )}

      {aviso !== null && (
        <p
          role={aviso.tipo === "erro" ? "alert" : "status"}
          className={cn("pb-3 text-[13px] md:pl-8", aviso.tipo === "erro" ? "text-destructive" : "text-muted-foreground")}
        >
          {aviso.texto}
        </p>
      )}

      <div className="h-px bg-border" />

      <PreferenceList preferences={preferences} />
    </section>
  );
}

/** A frase que diz o estado — antes de qualquer botão (docs/13, Perfil). */
function estadoDoAparelho(aparelho: Aparelho): ReactNode {
  switch (aparelho.estado) {
    case "carregando":
      return "Conferindo este aparelho…";
    case "ativo":
      return "Notificações ativas neste aparelho. Os avisos chegam mesmo com o PostIt fechado.";
    case "desligado":
      return "Desligadas. Ative para receber os avisos mesmo com o PostIt fechado.";
    case "negado":
      return (
        <>
          As notificações foram bloqueadas neste navegador, e ele não pergunta de novo sozinho. Para liberar, abra as
          permissões do site (o cadeado ao lado do endereço, ou as configurações do aparelho), permita as notificações e
          volte aqui.
        </>
      );
    case "sem-chave":
      return "O envio de notificações ainda não está configurado neste servidor. O sino continua recebendo tudo.";
    case "iphone-sem-instalar":
      return (
        <>
          No iPhone, as notificações só funcionam com o PostIt instalado na tela inicial. Veja como instalar logo abaixo,
          abra o PostIt pelo ícone e volte aqui.
        </>
      );
    case "sem-suporte":
      return "Este navegador não recebe notificações. O sino continua recebendo tudo.";
  }
}

async function descobrirEstado(vapidPublicKey: string | null): Promise<Aparelho> {
  if (!pushSupported()) {
    return { estado: isIos() && !isStandalone() ? "iphone-sem-instalar" : "sem-suporte" };
  }
  if (vapidPublicKey === null) return { estado: "sem-chave" };
  if (Notification.permission === "denied") return { estado: "negado" };

  const registro = await navigator.serviceWorker.getRegistration();
  const inscricao = await registro?.pushManager.getSubscription();
  if (inscricao === null || inscricao === undefined || Notification.permission !== "granted") {
    return { estado: "desligado" };
  }
  return { estado: "ativo", endpoint: inscricao.endpoint };
}

/**
 * Um interruptor por tipo (RF-J04), salvo na hora. Vale para todos os aparelhos,
 * e o sino recebe todos de qualquer jeito — o texto diz as duas coisas.
 */
function PreferenceList({ preferences }: { readonly preferences: readonly PushPreference[] }): ReactNode {
  const [valores, setValores] = useState(preferences);
  const [erro, setErro] = useState<string | null>(null);
  const [, iniciar] = useTransition();

  function alternar(preferencia: PushPreference): void {
    setErro(null);
    const nova = { type: preferencia.type, push: !preferencia.push };
    // Otimista: o interruptor responde no toque; se a API recusar, volta.
    setValores((atuais) => atuais.map((item) => (item.type === nova.type ? nova : item)));
    iniciar(async () => {
      const resultado = await setPushPreferenceAction(nova);
      if (resultado.ok) setValores(resultado.data);
      else {
        setValores((atuais) => atuais.map((item) => (item.type === nova.type ? preferencia : item)));
        setErro(resultado.message);
      }
    });
  }

  return (
    <div className="flex flex-col gap-1 pt-3.5">
      <p className="text-sm font-bold">O que chega por push</p>
      <p className="text-[13px] text-muted-foreground">
        Vale para todos os seus aparelhos. O sino recebe todos os avisos, com ou sem push.
      </p>

      <ul className="flex flex-col pt-1.5">
        {valores.map((preferencia) => (
          <li key={preferencia.type} className="flex min-h-11 items-center justify-between gap-3">
            <span className="text-sm" id={`push-${preferencia.type}`}>
              {PUSH_TYPE_LABELS[preferencia.type]}
            </span>
            <Switch
              checked={preferencia.push}
              labelledBy={`push-${preferencia.type}`}
              onToggle={() => alternar(preferencia)}
            />
          </li>
        ))}
      </ul>

      {erro !== null && (
        <p role="alert" className="text-[13px] text-destructive">
          {erro}
        </p>
      )}
    </div>
  );
}

/** Um interruptor acessível: `role="switch"`, estado no `aria-checked`, e a cor não é o único sinal. */
function Switch({
  checked,
  labelledBy,
  onToggle,
}: {
  readonly checked: boolean;
  readonly labelledBy: string;
  readonly onToggle: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      onClick={onToggle}
      className="flex h-11 shrink-0 items-center gap-2 text-[13px] font-medium text-muted-foreground focus-visible:outline-none [&:focus-visible>span:last-child]:ring-[3px] [&:focus-visible>span:last-child]:ring-ring/50"
    >
      <span aria-hidden>{checked ? "Ligado" : "Desligado"}</span>
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-6 w-10 items-center rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "absolute size-5 rounded-full bg-card shadow-sm transition-transform motion-reduce:transition-none",
            checked ? "translate-x-4.5" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

/**
 * Instalar o PostIt como app (RF-J05; docs/13, "Instalação e notificações"). Diz se
 * já está instalado e, se não, o caminho do sistema de quem está lendo.
 */
export function InstallCard(): ReactNode {
  const [sistema, setSistema] = useState<"carregando" | "instalado" | "iphone" | "android" | "computador">(
    "carregando",
  );

  useEffect(() => {
    // Só no navegador: o servidor não sabe se a página abriu como app.
    queueMicrotask(() =>
      setSistema(isStandalone() ? "instalado" : isIos() ? "iphone" : isAndroid() ? "android" : "computador"),
    );
  }, []);

  return (
    <section className="flex flex-col rounded-2xl border bg-card p-4 md:p-5" aria-labelledby="instalar-titulo">
      <h2 id="instalar-titulo" className="pb-2.5 font-heading text-[17px] font-bold md:pb-3.5 md:text-lg">
        Instalar o PostIt
      </h2>
      <div className="flex gap-3 py-1">
        {sistema === "iphone" ? (
          <Share className="mt-0.5 size-5 shrink-0" strokeWidth={2} aria-hidden />
        ) : (
          <Smartphone className="mt-0.5 size-5 shrink-0" strokeWidth={2} aria-hidden />
        )}
        <p className="text-[13px] leading-normal text-muted-foreground">
          {sistema === "carregando" && "Conferindo este aparelho…"}
          {sistema === "instalado" && "Instalado neste aparelho: o PostIt abre em tela própria, sem a barra do navegador."}
          {sistema === "iphone" &&
            "No Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”. Abra o PostIt pelo ícone novo."}
          {sistema === "android" &&
            "No Chrome, abra o menu (os três pontos) e toque em “Instalar app” ou “Adicionar à tela inicial”."}
          {sistema === "computador" &&
            "No Chrome ou no Edge, clique no ícone de instalar, à direita da barra de endereço, e confirme."}
        </p>
      </div>
    </section>
  );
}
