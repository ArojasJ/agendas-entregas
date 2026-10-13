import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const out = [];
const ok = (m) => { out.push("  ok   " + m); };
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });

const creadas = [];
page.on("response", async (r) => {
  if (r.url().includes("/api/bookings") && r.request().method() === "POST") {
    creadas.push(r.status());
  }
});

try {
  await page.goto(`${BASE}/agendar`, { waitUntil: "networkidle", timeout: 60000 });

  const tab = page.getByRole("button", { name: /Florería/i });
  if (await tab.count() === 0) throw new Error("No aparece la pestaña Florería");
  await tab.click();
  ok("la pestaña Florería abre");

  await page.getByPlaceholder("@tuusuario").fill("@pruebae2e");
  await page.getByPlaceholder("Nombre y apellidos").fill("Prueba E2E");
  await page.getByPlaceholder("871...").fill("8711234567");
  ok("se llenan los datos del cliente");

  const tarjetas = page.locator("button").filter({ hasText: /de oct|de nov|de dic/ });
  const n = await tarjetas.count();
  if (n === 0) throw new Error("No se pintaron tarjetas de fecha");
  ok(`se pintan ${n} fechas`);

  await tarjetas.first().click();

  // Lo que la clienta debe ver: el modal de confirmación
  const modal = page.getByText("¡Todo listo!");
  try {
    await modal.waitFor({ state: "visible", timeout: 10000 });
    ok("APARECE el modal de confirmación");
  } catch {
    fail("NO aparece el modal — la clienta cree que se trabó");
    await page.screenshot({ path: "scripts/e2e-fallo.png", fullPage: true });
  }

  // Con el modal encima no debe poder seguir generando reservas
  const antes = creadas.length;
  for (let i = 1; i < Math.min(4, n); i++) {
    await tarjetas.nth(i).click({ timeout: 2000, force: true }).catch(() => {});
  }
  await page.waitForTimeout(1500);
  if (creadas.length === antes) ok(`3 clics extra no generaron reservas (total: ${creadas.length})`);
  else fail(`los clics extra crearon ${creadas.length - antes} reservas de más`);

  await page.screenshot({ path: "scripts/e2e-floreria.png", fullPage: true });
} catch (e) {
  fail(e.message);
  await page.screenshot({ path: "scripts/e2e-fallo.png", fullPage: true }).catch(() => {});
} finally {
  console.log(out.join("\n"));
  console.log(`\n  POSTs a /api/bookings: ${creadas.length} ${JSON.stringify(creadas)}`);
  await browser.close();
}
