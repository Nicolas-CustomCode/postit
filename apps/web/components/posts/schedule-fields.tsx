import type { ReactNode } from "react";
import { accountZoneName, todayIn } from "@/components/account-time";

/**
 * Data e hora de publicação, no fuso **da conta** (RF-D01; ADR 0006).
 *
 * Os campos mandam dia e hora civis; quem converte em instante é a API, com o
 * fuso da conta — converter aqui deixaria o fuso do aparelho entrar por engano.
 * Por isso o nome do fuso fica escrito embaixo, sempre: quem edita do Brasil uma
 * conta de Lisboa precisa saber que está escolhendo o horário de Lisboa.
 */
export function ScheduleFields({
  idPrefix,
  day,
  time,
  timeZone,
  disabled,
  onDayChange,
  onTimeChange,
}: {
  /** Os `id` dos campos precisam ser únicos na página: o rótulo aponta para eles. */
  readonly idPrefix: string;
  readonly day: string;
  readonly time: string;
  readonly timeZone: string;
  readonly disabled: boolean;
  readonly onDayChange: (day: string) => void;
  readonly onTimeChange: (time: string) => void;
}): ReactNode {
  const campo =
    "h-11 w-full rounded-[10px] border bg-card px-3 text-sm tabular-nums focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-accent focus-visible:outline-none disabled:opacity-50 md:h-10";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${idPrefix}-dia`} className="text-[13px] font-semibold">
            Data
          </label>
          <input
            id={`${idPrefix}-dia`}
            type="date"
            value={day}
            min={todayIn(timeZone)}
            disabled={disabled}
            onChange={(evento) => onDayChange(evento.target.value)}
            className={campo}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${idPrefix}-hora`} className="text-[13px] font-semibold">
            Hora
          </label>
          <input
            id={`${idPrefix}-hora`}
            type="time"
            value={time}
            disabled={disabled}
            onChange={(evento) => onTimeChange(evento.target.value)}
            className={campo}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{accountZoneName(timeZone)} — o fuso da conta</p>
    </div>
  );
}
