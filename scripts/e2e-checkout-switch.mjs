import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const USER = process.env.ADMIN_USER;
const PASS = process.env.ADMIN_PASS;

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
const page = await ctx.newPage();

const leerModo = async () => {
  const r = await page.request.get(`${BASE}/api/public/catalog-settings`);
  return (await r.json()).settings?.checkout_modo ?? "(sin definir)";
};

try {
  const r = await page.request.post(`${BASE}/api/login-panel`, { data: { username: USER, password: PASS } });
  const { token, role, displayName } = await r.json();
  await page.addInitScript(([t, ro, dn]) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", ro);
    localStorage.setItem("staffName", dn || "");
  }, [token, role, displayName]);

  await page.goto(`${BASE}/panel/categorias`, { waitUntil: "networkidle", timeout: 60000 });

  await page.getByText("Forma de compra").waitFor({ timeout: 10000 });
  ok("la sección aparece en Personalizar Catálogo");

  const inicial = await leerModo();

  // Cambiar el modo global
  await page.getByRole("button", { name: /Pago en línea/ }).first().click();
  await page.waitForTimeout(1200);
  const despues = await leerModo();
  if (despues === "tienda") ok(`el modo global cambió a "${despues}"`);
  else fail(`el modo global quedó en "${despues}"`);

  // Regresar a apartado
  await page.getByRole("button", { name: /Apartado/ }).first().click();
  await page.waitForTimeout(1200);
  const regreso = await leerModo();
  if (regreso === "apartado") ok("se puede revertir a apartado");
  else fail(`no revirtió, quedó en "${regreso}"`);

  // La vista previa NO debe tocar el ajuste global
  const antesPrev = await leerModo();
  await page.getByRole("switch", { name: "Probar el otro, solo en este navegador" }).click();
  await page.waitForTimeout(800);
  const desPrev = await leerModo();
  const guardado = await page.evaluate(() => localStorage.getItem("noreste_checkout_preview"));
  if (antesPrev === desPrev) ok(`la vista previa no tocó el ajuste global (sigue "${desPrev}")`);
  else fail("la vista previa alteró lo que ven las clientas");
  if (guardado) ok(`la vista previa quedó guardada en el navegador ("${guardado}")`);
  else fail("la vista previa no se guardó");

  await page.screenshot({ path: "scripts/e2e-switch.png", fullPage: false });

  // Y el catálogo debe respetarla
  await page.goto(`${BASE}/catalogo`, { waitUntil: "networkidle", timeout: 60000 });
  const sigueGuardado = await page.evaluate(() => localStorage.getItem("noreste_checkout_preview"));
  if (sigueGuardado === guardado) ok("el catálogo lee la vista previa del navegador");
  else fail("el catálogo no ve la vista previa");

  await page.evaluate(() => localStorage.removeItem("noreste_checkout_preview"));
} catch (e) {
  fail(e.message);
  await page.screenshot({ path: "scripts/e2e-fallo.png" }).catch(() => {});
} finally {
  console.log(out.join("\n"));
  await browser.close();
}
