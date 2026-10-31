import { chromium, devices } from "playwright";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const browser = await chromium.launch();
let estadoOriginal;

const sesion = (page, token, role, nombre) =>
  page.addInitScript(([t, r, n]) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", r);
    localStorage.setItem("staffName", n);
  }, [token, role, nombre]);

const ponerBodega = (token, valor) =>
  fetch(`${BASE}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": token },
    body: JSON.stringify({ key: "en_bodega", value: String(valor) }),
  });

try {
  const tokenAdmin = tokenDePrueba("admin", "Prueba Admin");
  const tokenGaby = tokenDePrueba("worker", "Prueba Gaby");
  estadoOriginal = (await (await fetch(`${BASE}/api/settings`)).json()).settings?.en_bodega ?? "true";
  await ponerBodega(tokenAdmin, true);

  // iPhone de verdad: la vista móvil es otra rama del layout, no la lateral encogida
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await sesion(page, tokenAdmin, "admin", "Prueba Admin");
  await page.goto(`${BASE}/panel`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  if (await page.locator("nav a", { hasText: "INICIO" }).count() > 0
      || (await page.locator("body").innerText()).includes("MENÚ"))
    ok("está en la vista de celular, no en la de escritorio");
  else fail("no se cargó la vista de celular");

  const boton = page.locator("header button", { hasText: /Bodega|Fuera/ });
  if (await boton.count() === 1) ok("el interruptor aparece en el encabezado, junto a Salir");
  else fail(`el interruptor no aparece en celular (${await boton.count()} coincidencias)`);

  if ((await boton.innerText()).includes("Bodega")) ok("dice Bodega cuando están dentro");
  else fail(`dice "${await boton.innerText()}"`);

  const caja = await boton.boundingBox();
  if (caja && caja.height >= 28) ok(`se puede picar con el dedo (${Math.round(caja.width)}x${Math.round(caja.height)} px)`);
  else fail(`queda muy chico para el dedo: ${JSON.stringify(caja)}`);

  await page.screenshot({ path: "scripts/movil-en-bodega.png" });

  await boton.click();
  await page.waitForFunction(
    () => !!document.querySelector("header")?.innerText.match(/Fuera/),
    { timeout: 5000 }
  );
  ok("al picarlo cambia a Fuera");

  const guardado = (await (await fetch(`${BASE}/api/settings`)).json()).settings?.en_bodega;
  if (guardado === "false") ok("y queda guardado para todos, no solo en el celular");
  else fail(`en la base quedó "${guardado}"`);

  await page.screenshot({ path: "scripts/movil-fuera.png" });

  // Al recargar debe seguir en Fuera: es estado del negocio
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  if ((await page.locator("header").innerText()).includes("Fuera"))
    ok("al recargar sigue en Fuera, no se le olvida");
  else fail("al recargar se le olvidó que estaban fuera");

  // La bitácora, desde el celular
  await page.goto(`${BASE}/panel/bitacora`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  if ((await page.locator("body").innerText()).includes("Bitácora"))
    ok("la bitácora abre bien en celular");
  else fail("la bitácora no abre en celular");

  const anchoDoc = await page.evaluate(() => document.documentElement.scrollWidth);
  const anchoVista = await page.evaluate(() => window.innerWidth);
  if (anchoDoc <= anchoVista + 2) ok(`no se sale de la pantalla (${anchoDoc} ≤ ${anchoVista})`);
  else fail(`se desborda a lo ancho: ${anchoDoc} > ${anchoVista}`);

  // Y está en el menú completo
  await page.goto(`${BASE}/panel`, { waitUntil: "networkidle" });
  await page.locator("nav", { hasText: "MENÚ" }).locator("button, a").last().click();
  await page.waitForTimeout(600);
  const menu = await page.locator("body").innerText();
  if (/Bitácora/i.test(menu)) ok("aparece en el Menú completo del celular");
  else fail("no aparece en el Menú completo");

  await page.screenshot({ path: "scripts/movil-menu.png" });

  // ── Gaby, en su celular ──
  const ctx2 = await browser.newContext({ ...devices["iPhone 13"] });
  const page2 = await ctx2.newPage();
  await sesion(page2, tokenGaby, "worker", "Prueba Gaby");
  await page2.goto(`${BASE}/panel/pos`, { waitUntil: "networkidle" });
  await page2.waitForTimeout(700);

  if (await page2.locator("header button", { hasText: /Bodega|Fuera/ }).count() === 0)
    ok("a la trabajadora no le sale el interruptor en su celular");
  else fail("la trabajadora ve el interruptor en celular");

  await page2.goto(`${BASE}/panel/bitacora`, { waitUntil: "networkidle" });
  await page2.waitForTimeout(900);
  if (page2.url().includes("/bitacora")) ok("pero sí puede abrir la bitácora desde su celular");
  else fail(`a la trabajadora la sacaron a ${page2.url()}`);
} catch (e) {
  fail(e.message);
} finally {
  try {
    await ponerBodega(tokenDePrueba("admin", "Prueba Admin"), estadoOriginal === "true");
    out.push(`  --    interruptor devuelto a "${estadoOriginal}"`);
  } catch (e) { out.push("  AVISO no se pudo devolver el interruptor: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
}
