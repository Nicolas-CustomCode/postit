import { expect, test, type Page } from "@playwright/test";

/**
 * Cenário 10 do docs/15: toda página tem CSP com nonce (RNF-14), mais os
 * cabeçalhos fixos do next.config (docs/adr/0014).
 */

const PAGES = ["/", "/~offline", "/pagina-que-nao-existe"];

/** Mensagens do navegador sobre algo bloqueado pela CSP. Página bloqueada desenha, mas não funciona. */
function collectCspViolations(page: Page): string[] {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) violations.push(message.text());
  });
  return violations;
}

for (const path of PAGES) {
  test(`${path} tem CSP com nonce e nada bloqueado`, async ({ page }) => {
    const violations = collectCspViolations(page);
    const response = await page.goto(path);
    expect(response).not.toBeNull();

    const csp = response!.headers()["content-security-policy"] ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce, "a CSP precisa trazer um nonce").toBeTruthy();
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toContain("frame-ancestors 'none'");

    // Os scripts do Next saem marcados com o nonce desta resposta.
    const scriptNonces = await page.locator("script[nonce]").evaluateAll((scripts) =>
      scripts.map((script) => (script as HTMLScriptElement).nonce),
    );
    expect(scriptNonces.length).toBeGreaterThan(0);
    expect(new Set(scriptNonces)).toEqual(new Set([nonce]));

    await page.waitForLoadState("networkidle");
    expect(violations).toEqual([]);
  });
}

test("o nonce muda a cada carregamento", async ({ request }) => {
  const nonceOf = async () => {
    const response = await request.get("/");
    return /'nonce-([^']+)'/.exec(response.headers()["content-security-policy"] ?? "")?.[1];
  };
  const [first, second] = [await nonceOf(), await nonceOf()];
  expect(first).toBeTruthy();
  expect(first).not.toBe(second);
});

test("envia os cabeçalhos de segurança fixos", async ({ request }) => {
  const headers = (await request.get("/")).headers();
  expect(headers["strict-transport-security"]).toBe("max-age=31536000; includeSubDomains");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["permissions-policy"]).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["x-powered-by"]).toBeUndefined();
});
