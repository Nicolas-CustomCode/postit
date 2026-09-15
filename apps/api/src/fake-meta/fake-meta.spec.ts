import { createFakeMeta, FAKE_META_ACCOUNT, FAKE_META_TOKEN } from "./fake-meta";

describe("Meta falsa", () => {
  it.each(["development", "production", undefined])("recusa subir com NODE_ENV=%s", (nodeEnv) => {
    expect(() => createFakeMeta(nodeEnv)).toThrow("só sobe com NODE_ENV=test");
  });

  it("devolve a conta de testes com o token dela", async () => {
    const app = createFakeMeta("test");
    const response = await app.inject({ method: "GET", url: `/v26.0/me?access_token=${FAKE_META_TOKEN}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject(FAKE_META_ACCOUNT);
    await app.close();
  });

  it("responde token inválido no formato de erro da Graph API", async () => {
    const app = createFakeMeta("test");
    const response = await app.inject({ method: "GET", url: "/v26.0/me?access_token=outro" });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { type: "OAuthException", code: 190 } });
    await app.close();
  });
});
