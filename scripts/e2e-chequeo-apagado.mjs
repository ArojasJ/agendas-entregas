import { chromium, devices } from "playwright";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// Chequeo se apagó del menú, pero NO se borró: la pantalla y su API siguen enteras y
// /panel/chequeo abre si se escribe la dirección. Esta prueba comprueba las dos mitades
// —que no salga y que siga funcionando—, porque apagar algo a medias es lo que deja un
// botón muerto o una pantalla rota.

const BASE = process.env.BASE_URL || "http://localhost:3000";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const browser = await chromium.launch();

const sesion = (ctx, rol, nombre) =>
  ctx.addInitScript(({ t, r, n }) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", r);
    localStorage.setItem("staffName", n);
  }, { t: tokenDePrueba(rol, nombre), r: rol, n: nombre });

try {
  // ── No sale en el menú, ni para admin ni para empleada ──
  for (const rol of ["admin", "worker"]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    await sesion(ctx, rol, rol === "admin" ? "Antonio" : "Gaby");
    const page = await ctx.newPage();
    await page.goto(`${BASE}/panel/entregas`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(2500);
    const menu = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    if (!/Chequeo/i.test(menu)) ok(`no sale en el menú de ${rol}`);
    else fail(`sigue saliendo en el menú de ${rol}`);
    await ctx.close();
  }

  // ── En el menú del celular tampoco ──
  const cel = await browser.newContext({ ...devices["iPhone 13"], viewport: { width: 390, height: 844 } });
  await sesion(cel, "worker", "Gaby");
  const movil = await cel.newPage();
  await movil.goto(`${BASE}/panel/entregas`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await movil.waitForTimeout(2000);
  const botonMenu = movil.getByRole("button", { name: /Menú/i }).first();
  if (await botonMenu.count() > 0) {
    await botonMenu.click();
    await movil.waitForTimeout(1200);
  }
  const menuCel = (await movil.locator("body").innerText()).replace(/\s+/g, " ");
  if (!/Chequeo/i.test(menuCel)) ok("ni en el menú del celular");
  else fail("sale en el menú del celular");
  await cel.close();

  // ── Pero la pantalla NO se borró ──
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await sesion(ctx2, "admin", "Antonio");
  const page2 = await ctx2.newPage();
  const res = await page2.goto(`${BASE}/panel/chequeo`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page2.waitForTimeout(3000);

  if (res && res.status() < 400) ok("escribiendo la dirección, la pantalla sigue abriendo");
  else fail("la pantalla ya no abre: " + res?.status());

  const texto = (await page2.locator("body").innerText()).replace(/\s+/g, " ");
  if (/Chequeo/i.test(texto)) ok("y es la pantalla de Chequeo, no un error");
  else fail("abrió otra cosa: " + texto.slice(0, 200));

  // ── Y su API sigue viva ──
  const api = await fetch(`${BASE}/api/panel/chequeo?periodo=todo`, {
    headers: { "x-panel-token": tokenDePrueba("admin", "Antonio") },
  });
  if (api.ok) {
    const d = await api.json();
    ok(`su API sigue respondiendo: ${d.totalProductos} productos pendientes de ubicar`);
    if (d.totalProductos === 0) ok("y en cero, que es la razón por la que se apagó");
    else out.push(`  --    ojo: volvieron a aparecer ${d.totalProductos} sin ubicar`);
  } else {
    fail("la API dejó de responder: " + api.status);
  }
} catch (e) {
  fail(e.message);
} finally {
  console.log(out.join("\n"));
  await browser.close();
}
