import type { ReactNode } from "react";
import type { PostHistoryEntry } from "@repo/shared";
import { AccountDateTime } from "@/components/account-time";
import { ComposeSection } from "@/components/posts/compose-section";

const ETAPAS: Record<PostHistoryEntry["step"], string> = {
  DISPATCH: "Entregue para publicar",
  CREATE_CONTAINER: "Enviada ao Instagram",
  CHECK_STATUS: "Preparo conferido",
  PUBLISH: "Publicação pedida",
  RECONCILE: "Conferido se saiu",
  GIVE_UP: "Tentativas encerradas",
  COLLECT_METRICS: "Métricas coletadas",
};

const RESULTADOS: Record<PostHistoryEntry["result"], string> = {
  SUCCESS: "deu certo",
  RECOVERABLE_ERROR: "falhou — nova tentativa",
  FATAL_ERROR: "falhou",
};

/**
 * O que o motor fez, tentativa a tentativa (RF-F09) — o histórico técnico da
 * postagem que falhou.
 *
 * A linha do tempo da Revisão já conta "não saiu, e por quê"; isto é para quem
 * investiga, e por isso vem recolhido. O detalhe — a resposta da Meta, já sem token
 * (regra 3) — fica mais um nível abaixo, em cada linha.
 */
export function PublishHistory({
  history,
  timeZone,
}: {
  readonly history: readonly PostHistoryEntry[];
  readonly timeZone: string;
}): ReactNode {
  if (history.length === 0) return null;

  return (
    <ComposeSection title="Histórico da publicação">
      <details className="group">
        <summary className="cursor-pointer text-[13px] font-semibold text-primary">
          Ver o que o sistema tentou, passo a passo
        </summary>
        <ol className="mt-3 flex flex-col gap-3">
          {history.map((entrada, indice) => (
            <li key={indice} className="flex flex-col gap-1">
              <p className="text-sm">
                <span className="text-muted-foreground">
                  <AccountDateTime iso={entrada.at} timeZone={timeZone} />
                </span>{" "}
                {ETAPAS[entrada.step]}:{" "}
                <span className={entrada.result === "SUCCESS" ? "" : "text-destructive"}>
                  {RESULTADOS[entrada.result]}
                </span>
              </p>
              {entrada.detail !== null && entrada.detail !== undefined && (
                <details className="text-[13px] text-muted-foreground">
                  <summary className="cursor-pointer">detalhe técnico</summary>
                  <pre className="mt-1 overflow-x-auto rounded-lg bg-muted p-2 text-xs">
                    {JSON.stringify(entrada.detail, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      </details>
    </ComposeSection>
  );
}
