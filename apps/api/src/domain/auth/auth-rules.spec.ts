import { refuseRemoval } from "../admin/super-admin";
import { isLinkUsable, linkExpiry } from "./access-link";
import { challengeExpiry, challengeState } from "./challenge";
import { activeBlock, decideBlock, repeatWindowStart, windowStart, type LockoutConfig } from "./lockout";
import { isRecentlyConfirmed } from "./recent-confirmation";
import { sessionExpiry, sessionState, shouldTouch } from "./session-validity";
import { isReplay, stepFor } from "./totp-window";

const AGORA = new Date("2026-09-16T12:00:00.000Z");
const minutos = (n: number) => n * 60 * 1000;
const dias = (n: number) => n * 24 * 60 * minutos(1);

describe("sessão", () => {
  const base = { expiresAt: new Date(AGORA.getTime() + dias(20)), lastUsedAt: AGORA, revokedAt: null };

  it("o teto sai da criação e não se mexe mais", () => {
    expect(sessionExpiry(AGORA, 30)).toEqual(new Date(AGORA.getTime() + dias(30)));
  });

  it("vale enquanto não foi revogada, não passou do teto e teve uso recente", () => {
    expect(sessionState(base, AGORA, 7)).toBe("ACTIVE");
  });

  it("revogada perde a validade mesmo dentro dos dois prazos", () => {
    expect(sessionState({ ...base, revokedAt: AGORA }, AGORA, 7)).toBe("REVOKED");
  });

  it("morre por inatividade exatamente aos 7 dias, e vale um segundo antes", () => {
    const umSegundoAntes = new Date(AGORA.getTime() - dias(7) + 1000);
    const exatamente = new Date(AGORA.getTime() - dias(7));
    expect(sessionState({ ...base, lastUsedAt: umSegundoAntes }, AGORA, 7)).toBe("ACTIVE");
    expect(sessionState({ ...base, lastUsedAt: exatamente }, AGORA, 7)).toBe("IDLE_EXPIRED");
  });

  it("morre pelo teto mesmo com uso agora mesmo — é o ponto do teto", () => {
    const vencida = { ...base, expiresAt: new Date(AGORA.getTime() - 1000), lastUsedAt: AGORA };
    expect(sessionState(vencida, AGORA, 7)).toBe("MAX_EXPIRED");
  });

  it("o último uso é reescrito no máximo uma vez por hora", () => {
    expect(shouldTouch(new Date(AGORA.getTime() - minutos(59)), AGORA)).toBe(false);
    expect(shouldTouch(new Date(AGORA.getTime() - minutos(61)), AGORA)).toBe(true);
  });
});

describe("bloqueio por tentativas", () => {
  const config: LockoutConfig = {
    windowMinutes: 30,
    accountAttempts: 10,
    accountMinutes: 15,
    ipAttempts: 20,
    ipMinutes: 30,
    repeatMinutes: 60,
    repeatWindowHours: 24,
  };
  const decide = (extra: Partial<Parameters<typeof decideBlock>[0]>) =>
    decideBlock({ type: "ACCOUNT", failuresInWindow: 0, blockedRecently: false, now: AGORA, config, ...extra });

  it("nove falhas não bloqueiam; a décima bloqueia por 15 minutos", () => {
    expect(decide({ failuresInWindow: 9 })).toBeNull();
    expect(decide({ failuresInWindow: 10 })).toEqual({ level: 1, until: new Date(AGORA.getTime() + minutos(15)) });
  });

  it("reincidir dentro de 24 horas dobra para 60 minutos e sobe o nível", () => {
    const decisao = decide({ failuresInWindow: 10, blockedRecently: true });
    expect(decisao).toEqual({ level: 2, until: new Date(AGORA.getTime() + minutos(60)) });
  });

  it("o IP tem limite próprio, mais alto, e bloqueio de 30 minutos", () => {
    expect(decide({ type: "IP", failuresInWindow: 19 })).toBeNull();
    expect(decide({ type: "IP", failuresInWindow: 20 })).toEqual({
      level: 1,
      until: new Date(AGORA.getTime() + minutos(30)),
    });
  });

  it("a janela de contagem é de 30 minutos e a de reincidência, de 24 horas", () => {
    expect(windowStart(AGORA, config)).toEqual(new Date(AGORA.getTime() - minutos(30)));
    expect(repeatWindowStart(AGORA, config)).toEqual(new Date(AGORA.getTime() - minutos(60 * 24)));
  });

  it("entre bloqueios ativos vale o que termina mais tarde", () => {
    const curto = { until: new Date(AGORA.getTime() + minutos(5)), releasedAt: null };
    const longo = { until: new Date(AGORA.getTime() + minutos(45)), releasedAt: null };
    expect(activeBlock([curto, longo], AGORA)).toBe(longo);
  });

  it("bloqueio vencido ou liberado à mão não vale mais", () => {
    const vencido = { until: new Date(AGORA.getTime() - 1000), releasedAt: null };
    const liberado = { until: new Date(AGORA.getTime() + minutos(45)), releasedAt: AGORA };
    expect(activeBlock([vencido, liberado], AGORA)).toBeNull();
  });
});

describe("desafio de login", () => {
  const base = { expiresAt: new Date(AGORA.getTime() + minutos(4)), attempts: 0, completedAt: null };

  it("vale por 5 minutos a partir da senha certa", () => {
    expect(challengeExpiry(AGORA, 5)).toEqual(new Date(AGORA.getTime() + minutos(5)));
  });

  it("serve enquanto não venceu, não esgotou e não foi usado", () => {
    expect(challengeState(base, AGORA, 5)).toBe("USABLE");
    expect(challengeState({ ...base, attempts: 4 }, AGORA, 5)).toBe("USABLE");
  });

  it("esgota na quinta tentativa errada", () => {
    expect(challengeState({ ...base, attempts: 5 }, AGORA, 5)).toBe("EXHAUSTED");
  });

  it("vencido e já concluído não voltam a valer", () => {
    expect(challengeState({ ...base, expiresAt: AGORA }, AGORA, 5)).toBe("EXPIRED");
    expect(challengeState({ ...base, completedAt: AGORA }, AGORA, 5)).toBe("COMPLETED");
  });
});

describe("links de acesso", () => {
  const ttl = { signupDays: 7, passwordResetHours: 24 };

  it("cadastro vale 7 dias e redefinição vale 24 horas", () => {
    expect(linkExpiry(AGORA, "SIGNUP", ttl)).toEqual(new Date(AGORA.getTime() + dias(7)));
    expect(linkExpiry(AGORA, "PASSWORD_RESET", ttl)).toEqual(new Date(AGORA.getTime() + minutos(60 * 24)));
  });

  it("um link de redefinição não serve como link de cadastro", () => {
    const link = { purpose: "PASSWORD_RESET" as const, expiresAt: new Date(AGORA.getTime() + minutos(10)), usedAt: null };
    expect(isLinkUsable(link, "PASSWORD_RESET", AGORA)).toBe(true);
    expect(isLinkUsable(link, "SIGNUP", AGORA)).toBe(false);
  });

  it("usado e vencido deixam de valer", () => {
    const base = { purpose: "SIGNUP" as const, expiresAt: new Date(AGORA.getTime() + minutos(10)), usedAt: null };
    expect(isLinkUsable({ ...base, usedAt: AGORA }, "SIGNUP", AGORA)).toBe(false);
    expect(isLinkUsable({ ...base, expiresAt: AGORA }, "SIGNUP", AGORA)).toBe(false);
  });
});

describe("janela do código de 6 dígitos", () => {
  it("o passo muda a cada 30 segundos", () => {
    expect(stepFor(new Date("2026-09-16T12:00:29.999Z"))).toBe(stepFor(new Date("2026-09-16T12:00:00.000Z")));
    expect(stepFor(new Date("2026-09-16T12:00:30.000Z"))).toBe(stepFor(AGORA) + 1);
  });

  it("recusa o mesmo passo e qualquer passo anterior", () => {
    const passo = stepFor(AGORA);
    expect(isReplay(passo, passo)).toBe(true);
    expect(isReplay(passo, passo - 1)).toBe(true);
    expect(isReplay(passo, passo + 1)).toBe(false);
  });

  it("o primeiro código da vida do usuário não é reuso", () => {
    expect(isReplay(null, stepFor(AGORA))).toBe(false);
  });
});

describe("confirmação recente", () => {
  it("vale por 15 minutos", () => {
    expect(isRecentlyConfirmed(new Date(AGORA.getTime() - minutos(14)), AGORA, 15)).toBe(true);
    expect(isRecentlyConfirmed(new Date(AGORA.getTime() - minutos(16)), AGORA, 15)).toBe(false);
  });
});

describe("invariante do último super admin", () => {
  const base = { actorId: "quem-faz", targetId: "alvo", targetIsSuperAdmin: true, activeSuperAdmins: 2 };

  it("deixa remover quando sobra outro super admin ativo", () => {
    expect(refuseRemoval(base)).toBeNull();
  });

  it("recusa quando o alvo é o último", () => {
    expect(refuseRemoval({ ...base, activeSuperAdmins: 1 })).toBe("LAST_SUPER_ADMIN");
  });

  it("ninguém desativa a si mesmo, nem havendo outros", () => {
    expect(refuseRemoval({ ...base, targetId: "quem-faz", activeSuperAdmins: 5 })).toBe("SELF");
  });

  it("quem não é super admin não é barrado pela contagem", () => {
    expect(refuseRemoval({ ...base, targetIsSuperAdmin: false, activeSuperAdmins: 1 })).toBeNull();
  });
});
