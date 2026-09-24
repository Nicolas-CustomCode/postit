import {
  PUSH_NOTIFICATION_TYPES,
  PUSH_TEST_PAYLOAD,
  pushPayloadFor,
  pushPreferenceSchema,
  pushSubscriptionSchema,
} from "./push";

/**
 * O push não carrega dado sensível (AGENTS.md, regra 22; RF-J02). O que se prova
 * aqui é o formato, que é o único lugar onde um dado poderia escapar.
 */
describe("push", () => {
  const ID = "0190a0b1-0000-7000-8000-000000000000";

  it.each(PUSH_NOTIFICATION_TYPES)("%s: só título e link do próprio aviso", (type) => {
    const payload = pushPayloadFor(type, ID);

    expect(Object.keys(payload).sort()).toEqual(["title", "url"]);
    expect(payload.url).toBe(`/notificacoes/${ID}`);
    // Título fixo: sem arroba de conta, sem aspas de legenda, sem lugar para variável.
    expect(payload.title).not.toMatch(/[@"“{}$]/);
    expect(payload.title.length).toBeLessThanOrEqual(60);
  });

  it("o teste leva ao Perfil, também só com título e link", () => {
    expect(Object.keys(PUSH_TEST_PAYLOAD).sort()).toEqual(["title", "url"]);
    expect(PUSH_TEST_PAYLOAD.url).toBe("/perfil");
  });

  describe("inscrição", () => {
    const valida = {
      endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
      keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) },
    };

    it("aceita a do navegador", () => {
      expect(pushSubscriptionSchema.safeParse(valida).success).toBe(true);
    });

    it("recusa endereço sem https", () => {
      expect(pushSubscriptionSchema.safeParse({ ...valida, endpoint: "http://exemplo.com/push" }).success).toBe(false);
    });

    it("recusa chave fora do tamanho ou do alfabeto", () => {
      expect(pushSubscriptionSchema.safeParse({ ...valida, keys: { ...valida.keys, auth: "a".repeat(65) } }).success).toBe(
        false,
      );
      expect(
        pushSubscriptionSchema.safeParse({ ...valida, keys: { ...valida.keys, p256dh: "não é base64" } }).success,
      ).toBe(false);
    });
  });

  it("preferência só dos tipos que o sino gera", () => {
    expect(pushPreferenceSchema.safeParse({ type: "PUBLISH_FAILED", push: false }).success).toBe(true);
    expect(pushPreferenceSchema.safeParse({ type: "ACCOUNT_LOCKED", push: false }).success).toBe(false);
  });
});
