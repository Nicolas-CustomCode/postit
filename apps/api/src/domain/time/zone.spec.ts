import { civilFieldsIn, possibleInstants, zoneOffsetMs } from "./zone";

/**
 * A conversão entre relógio e instante (ADR 0006; docs/09, "Fuso horário").
 *
 * ⚠️ **São Paulo não serve para testar transição.** O Brasil não tem horário de
 * verão desde 2019: um teste escrito com `America/Sao_Paulo` numa data futura
 * passa sem exercitar nada, porque o deslocamento é fixo em −3 e os três
 * desfechos viram um só. Os casos-limite usam Lisboa, Nova York e Santiago; São
 * Paulo entra no caminho normal e na comparação entre fusos, que é o papel dele.
 */
describe("relógio e instante", () => {
  /*
   * Os quatro casos obrigatórios do docs/09 estão aqui: depois de uma
   * transição, dentro da hora que não existe, dentro da hora repetida, e duas
   * contas em fusos diferentes com o mesmo relógio.
   */
  describe("o relógio que não existe — o dia em que a hora pula", () => {
    it.each([
      ["Europe/Lisbon", "2026-03-29", "01:30"],
      ["America/New_York", "2026-03-08", "02:30"],
      // Santiago muda o relógio à MEIA-NOITE: o dia 6 começa às 01:00.
      ["America/Santiago", "2026-09-06", "00:30"],
      // E o Brasil fazia o mesmo, até 2019.
      ["America/Sao_Paulo", "2018-11-04", "00:30"],
    ])("%s %s %s não acontece", (tz, dia, hora) => {
      expect(possibleInstants(dia, hora, tz).instants).toEqual([]);
    });

    it("mesmo sem acontecer, diz quando o relógio volta a andar", () => {
      // Em Santiago, o dia 6 de setembro de 2026 começa às 01:00 local.
      const { afterGap } = possibleInstants("2026-09-06", "00:00", "America/Santiago");
      expect(afterGap.toISOString()).toBe("2026-09-06T04:00:00.000Z");
    });
  });

  describe("o relógio que acontece duas vezes — o dia em que a hora volta", () => {
    it.each([
      ["Europe/Lisbon", "2026-10-25", "01:30", "2026-10-25T00:30:00.000Z"],
      ["America/New_York", "2026-11-01", "01:30", "2026-11-01T05:30:00.000Z"],
      ["America/Sao_Paulo", "2019-02-16", "23:30", "2019-02-17T01:30:00.000Z"],
    ])("%s %s %s fica com a primeira ocorrência", (tz, dia, hora, esperado) => {
      const { instants } = possibleInstants(dia, hora, tz);

      // Duas de verdade: é o que a forma ingênua não consegue nem perceber.
      expect(instants).toHaveLength(2);
      expect(instants[0]?.toISOString()).toBe(esperado);
      // E a primeira é mesmo a menor — a ordenação É a regra do ADR 0006.
      expect(instants[0]?.getTime()).toBeLessThan(instants[1]?.getTime() ?? 0);
    });
  });

  describe("o caminho normal", () => {
    it.each([
      ["America/Sao_Paulo", "2026-10-15", "10:00", "2026-10-15T13:00:00.000Z"],
      ["Europe/Lisbon", "2026-06-15", "10:00", "2026-06-15T09:00:00.000Z"],
      ["Europe/Lisbon", "2026-01-15", "10:00", "2026-01-15T10:00:00.000Z"],
      ["Asia/Tokyo", "2026-12-25", "23:59", "2026-12-25T14:59:00.000Z"],
      ["UTC", "2026-05-01", "00:00", "2026-05-01T00:00:00.000Z"],
    ])("%s %s %s", (tz, dia, hora, esperado) => {
      const { instants } = possibleInstants(dia, hora, tz);

      expect(instants).toHaveLength(1);
      expect(instants[0]?.toISOString()).toBe(esperado);
    });

    /*
     * O caso do docs/09: agendar para depois de uma transição precisa usar as
     * regras da DATA ALVO, não as de hoje. Em Lisboa, o mesmo relógio dá
     * instantes diferentes em janeiro e em junho — e é isso que o identificador
     * IANA carrega e o deslocamento fixo não carregaria.
     */
    it("o mesmo relógio em estações diferentes dá instantes diferentes", () => {
      const inverno = possibleInstants("2026-01-15", "10:00", "Europe/Lisbon").instants[0];
      const verao = possibleInstants("2026-06-15", "10:00", "Europe/Lisbon").instants[0];

      expect(inverno?.getUTCHours()).toBe(10);
      expect(verao?.getUTCHours()).toBe(9);
    });

    it("duas contas em fusos diferentes, mesmo relógio, instantes diferentes", () => {
      const saoPaulo = possibleInstants("2026-07-10", "18:00", "America/Sao_Paulo").instants[0];
      const lisboa = possibleInstants("2026-07-10", "18:00", "Europe/Lisbon").instants[0];

      expect(saoPaulo?.toISOString()).toBe("2026-07-10T21:00:00.000Z");
      expect(lisboa?.toISOString()).toBe("2026-07-10T17:00:00.000Z");
      expect(saoPaulo?.getTime()).not.toBe(lisboa?.getTime());
    });
  });

  /*
   * A ida e a volta precisam fechar, senão reabrir uma postagem agendada e
   * salvar sem mexer moveria o horário.
   */
  describe("ida e volta", () => {
    it.each([
      ["America/Sao_Paulo", "2026-10-15", "10:00"],
      ["Europe/Lisbon", "2026-06-15", "23:45"],
      ["Asia/Tokyo", "2026-01-01", "00:00"],
      // Inclusive no caso ambíguo: a primeira ocorrência volta ao mesmo relógio.
      ["Europe/Lisbon", "2026-10-25", "01:30"],
    ])("%s %s %s volta igual", (tz, dia, hora) => {
      const instante = possibleInstants(dia, hora, tz).instants[0];
      expect(civilFieldsIn(instante as Date, tz)).toEqual({ day: dia, time: hora });
    });
  });

  describe("rótulos inválidos", () => {
    it("recusa dia que não existe no calendário", () => {
      // Date.UTC normalizaria para 3 de março, em silêncio.
      expect(() => possibleInstants("2026-02-31", "10:00", "UTC")).toThrow(/não existe no calendário/);
      expect(() => possibleInstants("2026-13-01", "10:00", "UTC")).toThrow(/não existe no calendário/);
    });

    it("recusa formato fora do esperado", () => {
      expect(() => possibleInstants("15/10/2026", "10:00", "UTC")).toThrow(/formato inesperado/);
      expect(() => possibleInstants("2026-10-15", "25:00", "UTC")).toThrow(/formato inesperado/);
      expect(() => possibleInstants("2026-10-15", "10:00:00", "UTC")).toThrow(/formato inesperado/);
    });
  });

  describe("zoneOffsetMs", () => {
    it("mede o deslocamento do fuso naquele instante", () => {
      const HORA = 3_600_000;
      expect(zoneOffsetMs(new Date("2026-07-10T12:00:00Z"), "America/Sao_Paulo")).toBe(-3 * HORA);
      expect(zoneOffsetMs(new Date("2026-07-10T12:00:00Z"), "Asia/Tokyo")).toBe(9 * HORA);
      // Lisboa muda com a estação: é o motivo de guardar IANA, não deslocamento.
      expect(zoneOffsetMs(new Date("2026-01-10T12:00:00Z"), "Europe/Lisbon")).toBe(0);
      expect(zoneOffsetMs(new Date("2026-07-10T12:00:00Z"), "Europe/Lisbon")).toBe(HORA);
    });
  });
});
