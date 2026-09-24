import * as webpush from "web-push";
import type { PushConfig } from "./push.config";
import { WebPushSender } from "./push-sender";

/*
 * O `sendNotification` é trocado por um espião; o resto da biblioteca — o
 * `WebPushError`, principalmente — continua o de verdade.
 */
jest.mock("web-push", () => ({ ...jest.requireActual("web-push"), sendNotification: jest.fn() }));
const envio = webpush.sendNotification as jest.MockedFunction<typeof webpush.sendNotification>;

/**
 * O adaptador do `web-push`, sem rede: o que se confere é o que o PostIt entrega à
 * biblioteca e como traduz a resposta.
 *
 * A cifra e a assinatura são da biblioteca, e a entrega de verdade fica no
 * roteiro manual — um serviço de push só aceita https, e gerar certificado no
 * teste dependeria do openssl da máquina.
 */
describe("envio pelo web-push", () => {
  const config: PushConfig = {
    vapid: { publicKey: "chave-publica", privateKey: "chave-privada", subject: "mailto:teste@exemplo.com" },
    sweepMs: 10_000,
    idleDays: 7,
  };
  const alvo = { endpoint: "https://push.exemplo.com/segredo", p256dhKey: "p256dh", authKey: "auth" };
  const payload = { title: "Uma publicação falhou", url: "/notificacoes/abc" };

  afterEach(() => envio.mockReset());

  it("entrega exatamente título e link, com as chaves da inscrição e o prazo de uma hora", async () => {
    envio.mockResolvedValue({ statusCode: 201, body: "", headers: {} });

    const resultado = await new WebPushSender(config).send(alvo, { ...payload, extra: "não vai" } as never);

    expect(resultado).toBe("ok");
    const [inscricao, corpo, opcoes] = envio.mock.calls[0]!;
    expect(inscricao).toEqual({ endpoint: alvo.endpoint, keys: { p256dh: "p256dh", auth: "auth" } });
    expect(JSON.parse(corpo as string)).toEqual(payload);
    expect(opcoes).toMatchObject({
      TTL: 3600,
      urgency: "high",
      vapidDetails: { subject: "mailto:teste@exemplo.com", publicKey: "chave-publica", privateKey: "chave-privada" },
    });
  });

  it.each([
    [404, "gone"],
    [410, "gone"],
    [500, "failed"],
    [429, "failed"],
  ])("recusa %i vira %s", async (status, esperado) => {
    envio.mockRejectedValue(new webpush.WebPushError("recusado", status, {}, "", alvo.endpoint));

    expect(await new WebPushSender(config).send(alvo, payload)).toBe(esperado);
  });

  it("erro de rede é falha, não inscrição morta", async () => {
    envio.mockRejectedValue(new Error("ECONNRESET"));
    expect(await new WebPushSender(config).send(alvo, payload)).toBe("failed");
  });

  it("sem chaves, não tenta enviar", async () => {
    expect(await new WebPushSender({ ...config, vapid: null }).send(alvo, payload)).toBe("failed");
    expect(envio).not.toHaveBeenCalled();
  });
});
