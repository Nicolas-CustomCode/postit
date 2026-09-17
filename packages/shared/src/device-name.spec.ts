import { describeDevice, isHandheld } from "./device-name";

/**
 * Os user-agents abaixo são reais, copiados de aparelhos de verdade. Inventá-los
 * derrotaria o teste: o que quebra um leitor de user-agent é exatamente o que
 * ninguém imagina — o Edge dizendo que é Chrome, o Chrome no iPhone dizendo que
 * é Safari.
 */
describe("describeDevice", () => {
  const casos: readonly [string, string, string][] = [
    [
      "Chrome no Windows",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
      "Chrome no Windows",
    ],
    [
      "Edge se diz Chrome, e vence",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
      "Edge no Windows",
    ],
    [
      "Safari no iPhone",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      "Safari no iPhone",
    ],
    [
      "Chrome no iPhone se anuncia como CriOS",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1",
      "Chrome no iPhone",
    ],
    [
      "Firefox no Mac",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0",
      "Firefox no Mac",
    ],
    [
      "Chrome no Android",
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
      "Chrome no Android",
    ],
    [
      "Samsung Internet vem antes do Chrome que ele imita",
      "Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
      "Samsung Internet no Android",
    ],
    [
      "iPad ganha do Mac que ele também alega",
      "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1",
      "Safari no iPad",
    ],
    ["curl não tem navegador nem sistema conhecidos", "curl/8.7.1", "Aparelho desconhecido"],
  ];

  it.each(casos)("%s", (_nome, userAgent, esperado) => {
    expect(describeDevice(userAgent).label).toBe(esperado);
  });

  it("sem user-agent, não inventa nome", () => {
    expect(describeDevice(null)).toEqual({ browser: null, platform: null, label: "Aparelho desconhecido" });
    expect(describeDevice("   ").label).toBe("Aparelho desconhecido");
  });

  it("com só o sistema reconhecido, mostra o sistema", () => {
    expect(describeDevice("Mozilla/5.0 (Windows NT 10.0) AlgumRobo/1.0").label).toBe("Windows");
  });
});

describe("isHandheld", () => {
  it("reconhece celular e tablet", () => {
    expect(isHandheld("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)")).toBe(true);
    expect(isHandheld("Mozilla/5.0 (Linux; Android 14; Pixel 7) Mobile Safari/537.36")).toBe(true);
    expect(isHandheld("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)")).toBe(true);
  });

  it("computador não é de bolso, e sem user-agent assume computador", () => {
    expect(isHandheld("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/129.0.0.0")).toBe(false);
    expect(isHandheld(null)).toBe(false);
  });
});
