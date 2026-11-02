import { chromium, devices } from "playwright";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const browser = await chromium.launch();

try {
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Prueba Admin"));

  const leerConteo = async () => {
    await page.waitForFunction(
      () => /\d+\s+PRODUCTOS/i.test(document.body.innerText),
      { timeout: 30000 }
    );
    const t = await page.locator("body").innerText();
    const m = /(\d+)\s+PRODUCTOS\s*·\s*(\d+)\s+CLIENTAS/i.exec(t);
    return m ? { productos: Number(m[1]), clientas: Number(m[2]) } : null;
  };

  const t0 = Date.now();
  await page.goto(`${BASE}/panel/chequeo`, { waitUntil: "networkidle" });
  const inicial = await leerConteo();
  if (inicial) ok(`abre en 3 meses con ${inicial.productos} productos · ${inicial.clientas} clientas`);
  else fail("no se pudo leer el conteo inicial");

  const medidas = {};
  for (const [etiqueta, boton] of [["90", "Últimos 3 meses"], ["180", "Últimos 6 meses"], ["todo", "Todo"]]) {
    const antes = Date.now();
    await page.getByRole("button", { name: boton, exact: true }).click();
    const c = await leerConteo();
    const tardo = Date.now() - antes;
    if (!c) { fail(`no se pudo leer el conteo de ${boton}`); continue; }
    medidas[etiqueta] = c;
    ok(`${boton}: ${c.productos} productos · ${c.clientas} clientas (${(tardo / 1000).toFixed(1)}s)`);
  }

  if (medidas["todo"] && medidas["180"] && medidas["90"]) {
    if (medidas["todo"].productos > medidas["180"].productos &&
        medidas["180"].productos > medidas["90"].productos)
      ok(`en pantalla van de menos a más: ${medidas["90"].productos} < ${medidas["180"].productos} < ${medidas["todo"].productos}`);
    else
      fail(`en pantalla no van de menos a más: ${JSON.stringify(medidas)}`);
  }

  // Con "Todo" pintado, que el celular siga respondiendo
  const anchos = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (anchos[0] <= anchos[1] + 2) ok(`con todo el rezago no se desborda a lo ancho (${anchos[0]} <= ${anchos[1]})`);
  else fail(`se desborda: ${anchos[0]} > ${anchos[1]}`);

  const buscar = page.getByPlaceholder(/Buscar clienta/i);
  const antesBusca = Date.now();
  await buscar.fill("simo");
  await page.waitForTimeout(800);
  const tardoBusca = Date.now() - antesBusca;
  const texto = await page.locator("body").innerText();
  if (/@simo/i.test(texto)) ok(`el buscador responde con todo cargado (${(tardoBusca / 1000).toFixed(1)}s)`);
  else fail("el buscador no encontró a la clienta con todo cargado");

  await page.screenshot({ path: "scripts/chequeo-todo.png" });
  out.push(`  --    la pantalla completa tardó ${((Date.now() - t0) / 1000).toFixed(1)}s en total`);
} catch (e) {
  fail(e.message);
} finally {
  console.log(out.join("\n"));
  await browser.close();
}
