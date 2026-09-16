/**
 * Confirmação recente (ADR 0015, RF-I08).
 *
 * Toda ação administrativa exige um código do aplicativo digitado há pouco. Não
 * basta ter sessão: sessão dura dias, e um computador desbloqueado por alguns
 * minutos não pode virar mudança de permissão.
 *
 * O carimbo é `verificadoEm` da sessão, escrito no login e a cada confirmação.
 */
export function isRecentlyConfirmed(verifiedAt: Date, now: Date, minutes: number): boolean {
  return now.getTime() - verifiedAt.getTime() < minutes * 60 * 1000;
}
