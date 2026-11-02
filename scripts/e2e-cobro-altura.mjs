import { chromium, devices } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const ETIQUETA = "PRUEBA_ALTURA";
const token = tokenDePrueba("admin", "Prueba Admin");
let browser, productoId, clienteId;

const sesion = (page) =>
  page.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, token);

// La laptop de la tienda (1366x768) deja como 625px de alto útiles una vez que
// el navegador se queda con sus pestañas y Windows con la barra de tareas.
const PANTALLAS = [
  { nombre: "laptop de la tienda", ctx: { viewport: { width: 1366, height: 625 } } },
  { nombre: "laptop chica", ctx: { viewport: { width: 1280, height: 560 } } },
  { nombre: "celular", ctx: { ...devices["iPhone 13"] } },
];

async function prepararCobro(page) {
  await page.goto(`${BASE}/panel/pos`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  await page.locator("input[placeholder*='Buscar por nombre']").fill(ETIQUETA);
  await page.waitForTimeout(900);
  await page.locator("button:not([disabled])", { hasText: /Stock:/ }).first().click();
  await page.waitForTimeout(500);

  const campo = page.locator("input[placeholder*='instagram']");
  await campo.scrollIntoViewIfNeeded();
  await campo.click();
  await page.waitForTimeout(500);
  await campo.fill("prueba_altura");
  await page.waitForTimeout(700);
  await page.locator("div.absolute button", { hasText: "@prueba_altura" }).first().click();
  await page.waitForTimeout(700);

  await page.getByRole("button", { name: /Siguiente/ }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: /Siguiente/ }).click();
  await page.waitForTimeout(900);
}

try {
  await c.connect();
  browser = await chromium.launch();

  const p = await c.query(
    "INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',390,30,150) RETURNING id", [ETIQUETA]);
  productoId = p.rows[0].id;
  // Con saldo a favor, que es lo que hacía más alto el cuadro en la foto
  const cl = await c.query(
    "INSERT INTO clients (name,instagram,phone,saldo_favor) VALUES ($1,$2,'8711234567',2175) RETURNING id",
    [ETIQUETA, "@prueba_altura"]);
  clienteId = cl.rows[0].id;

  for (const pantalla of PANTALLAS) {
    const ctx = await browser.newContext(pantalla.ctx);
    const page = await ctx.newPage();
    await sesion(page);
    await prepararCobro(page);

    const alto = await page.evaluate(() => window.innerHeight);
    const titulo = page.getByText("Método de Pago");
    if (await titulo.isVisible()) ok(`${pantalla.nombre}: abre el cuadro de Método de Pago (${alto}px de alto)`);
    else { fail(`${pantalla.nombre}: no abrió el cuadro de cobro`); await ctx.close(); continue; }

    // A crédito es la versión más alta: suma enganche, plazo y los totales
    await page.getByRole("button", { name: /A Crédito/ }).click();
    await page.waitForTimeout(700);

    const tarjeta = page.locator('div[class*="max-h-[92vh]"]').first();
    const cajaTarjeta = await tarjeta.boundingBox();
    if (cajaTarjeta && cajaTarjeta.y >= -1 && cajaTarjeta.y + cajaTarjeta.height <= alto + 1)
      ok(`${pantalla.nombre}: el cuadro cabe en la pantalla (${Math.round(cajaTarjeta.height)} de ${alto}px)`);
    else fail(`${pantalla.nombre}: el cuadro se sale de la pantalla: ${JSON.stringify(cajaTarjeta)}`);

    const aprobar = page.getByRole("button", { name: /Aprobar Crédito/ });
    const cajaBoton = await aprobar.boundingBox();
    if (cajaBoton && cajaBoton.y >= 0 && cajaBoton.y + cajaBoton.height <= alto + 1)
      ok(`${pantalla.nombre}: el botón de Aprobar Crédito se alcanza sin hacer zoom`);
    else fail(`${pantalla.nombre}: el botón queda fuera: ${JSON.stringify(cajaBoton)}`);

    // Y lo de en medio tiene que poder recorrerse
    const cuerpo = page.locator("div[class*='min-h-0'][class*='overflow-y-auto']").first();
    const medidas = await cuerpo.evaluate((e) => ({ scroll: e.scrollHeight, visible: e.clientHeight }));
    if (medidas.scroll > medidas.visible) {
      await cuerpo.evaluate((e) => { e.scrollTop = e.scrollHeight; });
      await page.waitForTimeout(400);
      const llego = await cuerpo.evaluate((e) => e.scrollTop > 0);
      if (llego) ok(`${pantalla.nombre}: el contenido se desliza para ver lo de hasta abajo`);
      else fail(`${pantalla.nombre}: el contenido no se deja deslizar`);
    } else {
      ok(`${pantalla.nombre}: el contenido cabe completo, no hace falta deslizar`);
    }

    // Lo que la trabajadora necesitaba ver y tocar
    for (const texto of [/DÍAS DE PLAZO/i, /MONTO DE APARTADO/i, /Restante a crédito/i]) {
      if ((await page.getByText(texto).count()) > 0) continue;
      fail(`${pantalla.nombre}: no aparece ${texto}`);
    }
    ok(`${pantalla.nombre}: se alcanzan enganche, días de plazo y el restante`);

    await page.screenshot({ path: `scripts/cobro-${pantalla.nombre.replace(/ /g, "-")}.png` });
    await ctx.close();
  }
} catch (e) {
  fail(e.message);
} finally {
  try {
    await c.query("DELETE FROM sale_items WHERE product_id=$1", [productoId]);
    await c.query("DELETE FROM sales WHERE client_id=$1", [clienteId]);
    await c.query("DELETE FROM clients WHERE id=$1", [clienteId]);
    await c.query("DELETE FROM products WHERE id=$1", [productoId]);
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  if (browser) await browser.close();
  await c.end();
}
