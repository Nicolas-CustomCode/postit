import { expect, test } from "@playwright/test";

/** App instalável (RF-J05, docs/adr/0017): manifesto, ícones e service worker. */

test("o manifesto traz os ícones que o Chrome exige, e todos existem", async ({ request }) => {
  const response = await request.get("/manifest.webmanifest");
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as { icons: { src: string; sizes: string; purpose: string }[] };

  for (const size of ["192x192", "512x512"]) {
    for (const purpose of ["any", "maskable"]) {
      expect(manifest.icons).toContainEqual(expect.objectContaining({ sizes: size, purpose }));
    }
  }

  for (const icon of manifest.icons) {
    const image = await request.get(icon.src);
    expect(image.ok(), icon.src).toBe(true);
    expect(image.headers()["content-type"]).toBe("image/png");
  }
});

test("o service worker registra e fica ativo", async ({ page }) => {
  await page.goto("/");
  const scriptUrl = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.scriptURL ?? null;
  });
  expect(scriptUrl).toMatch(/\/serwist\/sw\.js$/);
});

test("o service worker não guarda página no aparelho", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Com o service worker no controle, as páginas passam por ele.
  await page.reload();
  await page.goto("/pagina-que-nao-existe");
  await page.waitForLoadState("networkidle");

  const cachedPaths = await page.evaluate(async () => {
    const paths: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) paths.push(new URL(request.url).pathname);
    }
    return paths;
  });

  // Só arquivos do build e a página "sem conexão", que não tem dado de ninguém.
  const unexpected = cachedPaths.filter((path) => !path.startsWith("/_next/static/") && path !== "/~offline");
  expect(unexpected).toEqual([]);
});
