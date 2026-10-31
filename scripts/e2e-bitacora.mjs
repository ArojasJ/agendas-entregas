import { chromium } from "playwright";
import { Client } from "pg";
import crypto from "crypto";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const SECRET = process.env.PANEL_TOKEN_SECRET || "agenda_super_secreta_123";
const firmar = (p) => {
  const body = Buffer.from(JSON.stringify(p)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", SECRET).update(body).digest("base64url")}`;
};

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();

const ETIQUETA = "PRUEBA_E2E_BITACORA";
const IG = "prueba_e2e_bitacora";
let clienteId, productoId, estadoOriginal;

const sesion = (page, token, role, nombre) =>
  page.addInitScript(([t, r, n]) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", r);
    localStorage.setItem("staffName", n);
  }, [token, role, nombre]);

try {
  await db.connect();
  const r0 = await (await fetch(`${BASE}/api/settings`)).json();
  estadoOriginal = r0.settings?.en_bodega ?? "true";

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',150,20,60) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const cl = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8711234567') RETURNING id`,
    [ETIQUETA, "@" + IG]);
  clienteId = cl.rows[0].id;

  const tokenAdmin = firmar({ role: "admin", username: "prueba_admin", displayName: "Prueba Admin" });
  const tokenGaby = firmar({ role: "worker", username: "prueba_gaby", displayName: "Prueba Gaby" });

  // ── El interruptor, desde la pantalla ──
  const ctx = await browser.newContext({ viewport: { width: 1250, height: 1000 } });
  const page = await ctx.newPage();
  await sesion(page, tokenAdmin, "admin", "Prueba Admin");

  // Partimos de "en bodega" para que el clic lo apague
  await fetch(`${BASE}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenAdmin },
    body: JSON.stringify({ key: "en_bodega", value: "true" }),
  });

  await page.goto(`${BASE}/panel`, { waitUntil: "networkidle" });
  const boton = page.locator("aside button", { hasText: /En bodega|Fuera de bodega/ });
  if (await boton.count() === 1) ok("el interruptor aparece debajo de la corona");
  else fail(`el interruptor no aparece (${await boton.count()} coincidencias)`);

  if ((await boton.innerText()).includes("En bodega")) ok("arranca diciendo En bodega");
  else fail(`arranca diciendo "${await boton.innerText()}"`);

  await boton.click();
  await page.waitForFunction(
    () => !!document.querySelector("aside")?.innerText.includes("Fuera de bodega"),
    { timeout: 5000 }
  );
  ok("al dar clic cambia a Fuera de bodega");

  const guardado = (await (await fetch(`${BASE}/api/settings`)).json()).settings?.en_bodega;
  if (guardado === "false") ok("y queda guardado en el negocio, no en el navegador");
  else fail(`en la base quedó "${guardado}"`);

  // ── Vender estando fuera ──
  const prop = await (await fetch(`${BASE}/api/panel/ubicacion?clientId=${clienteId}&productos=2`, {
    headers: { "x-panel-token": tokenAdmin },
  })).json();
  const ubic = prop.tipo === "estante" ? { tipo: "estante" } : { tipo: "caja", caja: prop.caja, aMover: prop.aMover || [] };
  await fetch(`${BASE}/api/sales`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenAdmin },
    body: JSON.stringify({
      client_id: clienteId, total: 300, discount: 0, payment_method: "efectivo", status: "paid",
      down_payment: 300, ubicacion: ubic,
      items: [
        { product_id: productoId, variant_id: null, quantity: 1, unit_price: 150 },
        { product_id: productoId, variant_id: null, quantity: 1, unit_price: 150 },
      ],
    }),
  });

  // ── La bitácora, en pantalla ──
  await page.goto(`${BASE}/panel/bitacora`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  const texto = await page.locator("body").innerText();
  if (texto.includes("@" + IG)) ok("la tarea se ve en la bitácora con el usuario de Instagram");
  else fail("no se ve el usuario de la clienta en la pantalla");

  if (texto.includes(ETIQUETA)) ok("y dice qué productos guardar");
  else fail("no dice qué productos guardar");

  if (/Caja \d+/i.test(texto) || /Estante/i.test(texto)) ok(`y dónde: ${(texto.match(/Caja \d+|Estante/i) || [])[0]}`);
  else fail("no dice dónde guardarlo");

  await page.screenshot({ path: "scripts/bitacora.png", fullPage: true });

  // ── Palomear desde la pantalla ──
  const fila = page.locator("div").filter({ hasText: "@" + IG });
  const check = page.locator("button.w-5.h-5").first();
  await check.click();
  await page.waitForTimeout(1200);

  const despues = await page.locator("body").innerText();
  if (!despues.includes("@" + IG)) ok("al palomear desaparece de la lista");
  else fail("sigue en la lista después de palomear");

  if (/Todo al corriente/i.test(despues) || !despues.includes("@" + IG)) ok("queda la pantalla limpia");

  await page.screenshot({ path: "scripts/bitacora-hecha.png", fullPage: true });

  // ── La trabajadora sí la trabaja, pero no mueve el interruptor ──
  const ctx2 = await browser.newContext({ viewport: { width: 1250, height: 1000 } });
  const page2 = await ctx2.newPage();
  await sesion(page2, tokenGaby, "worker", "Prueba Gaby");
  await page2.goto(`${BASE}/panel`, { waitUntil: "networkidle" });

  const lateral = await page2.locator("aside").innerText();
  if (/Bitácora/i.test(lateral)) ok("a la trabajadora sí le aparece Bitácora en el menú");
  else fail("la trabajadora no ve Bitácora en el menú");

  if (!/En bodega|Fuera de bodega/.test(lateral)) ok("pero no el interruptor de bodega, que es solo tuyo");
  else fail("la trabajadora ve el interruptor de bodega");

  await page2.goto(`${BASE}/panel/bitacora`, { waitUntil: "networkidle" });
  await page2.waitForTimeout(900);
  if (page2.url().includes("/bitacora")) ok("entra a la bitácora sin que la saque");
  else fail(`a la trabajadora la sacaron a ${page2.url()}`);

  const loQueVe = await page2.locator("body").innerText();
  if (/Bitácora/i.test(loQueVe)) ok("y ve la lista para hacerla temprano");
  else fail("la trabajadora no ve la lista");

  // ── El repartidor no ──
  const ctx3 = await browser.newContext({ viewport: { width: 1250, height: 1000 } });
  const page3 = await ctx3.newPage();
  const tokenRepa = firmar({ role: "driver", username: "prueba_repa", displayName: "Prueba Repartidor" });
  await sesion(page3, tokenRepa, "driver", "Prueba Repartidor");
  await page3.goto(`${BASE}/panel/bitacora`, { waitUntil: "networkidle" });
  await page3.waitForTimeout(1200);
  if (!page3.url().includes("/bitacora")) ok("al repartidor lo saca si entra a la liga a mano");
  else fail(`el repartidor se quedó en ${page3.url()}`);
} catch (e) {
  fail(e.message);
} finally {
  try {
    const tokenAdmin = firmar({ role: "admin", username: "prueba_admin", displayName: "Prueba Admin" });
    await fetch(`${BASE}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-panel-token": tokenAdmin },
      body: JSON.stringify({ key: "en_bodega", value: estadoOriginal }),
    });
    if (clienteId) {
      await db.query(`DELETE FROM bitacora_tareas WHERE sale_id IN (SELECT id FROM sales WHERE client_id=$1)`, [clienteId]);
      await db.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id=$1)`, [clienteId]);
      await db.query("DELETE FROM sales WHERE client_id=$1", [clienteId]);
      await db.query("DELETE FROM clients WHERE id=$1", [clienteId]);
    }
    if (productoId) {
      await db.query("DELETE FROM sale_items WHERE product_id=$1", [productoId]);
      await db.query("DELETE FROM products WHERE id=$1", [productoId]);
    }
    out.push(`  --    limpio · interruptor devuelto a "${estadoOriginal}"`);
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
