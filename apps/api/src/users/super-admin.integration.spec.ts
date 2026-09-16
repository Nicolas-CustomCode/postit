import { createTestUser } from "../common/testing/factories";
import { bootTestApp, type TestApp } from "../common/testing/test-app";
import { UsersService } from "./users.service";

/**
 * Invariante I-10: nunca zero super admin ativo (RF-I09).
 *
 * Um sistema sem super admin só se recupera por comando no servidor. Por isso a
 * checagem é dentro da transação, e por isso o último caso deste arquivo dispara
 * duas desativações ao mesmo tempo.
 */
describe("último super admin", () => {
  let api: TestApp;
  let users: UsersService;

  beforeAll(async () => {
    api = await bootTestApp();
    users = api.app.get(UsersService);
  });
  beforeEach(() => api.reset());
  afterAll(() => api.close());

  const superAdmin = () => createTestUser(api.db, api.config.encryptionKey, { superAdmin: true });

  it("recusa desativar o último super admin ativo", async () => {
    const ator = await createTestUser(api.db, api.config.encryptionKey);
    const unico = await superAdmin();

    await expect(users.deactivate(ator.id, unico.id, new Date())).rejects.toMatchObject({ code: "LAST_SUPER_ADMIN" });
    expect((await api.db.user.findUniqueOrThrow({ where: { id: unico.id } })).deactivatedAt).toBeNull();
  });

  it("deixa desativar quando sobra outro super admin ativo", async () => {
    const ator = await superAdmin();
    const alvo = await superAdmin();

    await users.deactivate(ator.id, alvo.id, new Date());

    const depois = await api.db.user.findUniqueOrThrow({ where: { id: alvo.id } });
    expect(depois.deactivatedAt).not.toBeNull();
    expect(depois.deactivatedById).toBe(ator.id);
  });

  it("ninguém desativa a si mesmo", async () => {
    const pessoa = await superAdmin();
    await superAdmin();

    await expect(users.deactivate(pessoa.id, pessoa.id, new Date())).rejects.toMatchObject({
      code: "SELF_DEACTIVATION",
    });
  });

  it("super admin já desativado não conta para a invariante", async () => {
    const ator = await createTestUser(api.db, api.config.encryptionKey);
    const ativo = await superAdmin();
    const desativado = await superAdmin();
    await users.deactivate(ator.id, desativado.id, new Date());

    // Sobrou um só ativo: desativá-lo é recusado.
    await expect(users.deactivate(ator.id, ativo.id, new Date())).rejects.toMatchObject({ code: "LAST_SUPER_ADMIN" });
  });

  it("duas desativações ao mesmo tempo não zeram os super admins", async () => {
    const ator = await createTestUser(api.db, api.config.encryptionKey);
    const um = await superAdmin();
    const outro = await superAdmin();
    const agora = new Date();

    // Cada transação, sozinha, veria dois super admins ativos e passaria. É
    // exatamente o caso que o nível Serializable existe para impedir.
    const resultados = await Promise.allSettled([
      users.deactivate(ator.id, um.id, agora),
      users.deactivate(ator.id, outro.id, agora),
    ]);

    const sucessos = resultados.filter((resultado) => resultado.status === "fulfilled");
    expect(sucessos).toHaveLength(1);
    expect(await api.db.user.count({ where: { superAdmin: true, deactivatedAt: null } })).toBe(1);
  });
});
