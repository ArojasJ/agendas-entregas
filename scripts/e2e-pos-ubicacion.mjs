import { chromium } from "playwright";
import { Client } from "pg";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1250, height: 1050 } });
const page = await ctx.newPage();

const ETIQUETA = "PRUEBA_POS_UBIC";
let productoId, clienteId;

try {
  await db.connect();
  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost,barcode)
     VALUES ($1,'PRUEBA',150,99,60,'9990001') RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const cl = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8711234567') RETURNING id`,
    [ETIQUETA, "@prueba_pos_ubic"]);
  clienteId = cl.rows[0].id;

  const r = await page.request.post(`${BASE}/api/login-panel`, {
    data: { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS },
  });
  const { token, role, displayName } = await r.json();
  await page.addInitScript(([t, ro, dn]) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", ro);
    localStorage.setItem("staffName", dn || "");
  }, [token, role, displayName]);

  await page.goto(`${BASE}/panel/pos`, { waitUntil: "networkidle", timeout: 90000 });
  ok("abre el punto de venta");

  // Buscar el producto y agregarlo dos veces (para que proponga caja, no estante)
  const buscador = page.getByPlaceholder(/Buscar|escanea|código/i).first();
  await buscador.fill(ETIQUETA);
  await page.waitForTimeout(1200);
  const tarjeta = page.getByText(ETIQUETA, { exact: false }).first();
  await tarjeta.click();
  await page.waitForTimeout(600);
  await tarjeta.click().catch(() => {});
  await page.waitForTimeout(600);

  // Asignar la clienta
  const buscaCliente = page.getByPlaceholder(/Buscar cliente/i);
  await buscaCliente.fill("prueba_pos_ubic");
  await page.waitForTimeout(1400);
  await page.getByText("@prueba_pos_ubic", { exact: false }).first().click();
  await page.waitForTimeout(800);
  ok("asigna la clienta");

  // Abrir el cobro
  await page.getByRole("button", { name: /Siguiente/i }).first().click();
  await page.waitForTimeout(2000);

  const texto = (await page.locator("body").innerText()).toUpperCase();
  if (texto.includes("DÓNDE SE GUARDA")) ok("aparece el panel de dónde se guarda");
  else fail("no apareció el panel de ubicación");

  const contador = texto.match(/\d+\/120 CAJAS OCUPADAS/);
  if (contador) ok(`muestra la ocupación: ${contador[0].toLowerCase()}`);
  else fail("no muestra el contador de cajas");

  const sugerido = texto.includes("SUGERIDO");
  if (sugerido) ok("marca una opción como sugerida");
  else fail("ninguna opción sale como sugerida");

  if (texto.includes("PONER EN ESTANTE")) ok("ofrece el estante como alternativa");
  else fail("no ofrece el estante");

  if (texto.includes("O ELIGE OTRA CAJA")) ok("deja elegir otra caja libre");
  else fail("no ofrece otras cajas");

  await page.screenshot({ path: "scripts/pos-ubicacion.png" });

  // Cobrar y verificar que la ubicación quedó guardada
  await page.getByRole("button", { name: /Confirmar|Completar|Finalizar/i }).first().click();
  await page.waitForTimeout(3000);

  const venta = await db.query(
    "SELECT ubicacion, caja FROM sales WHERE client_id=$1 ORDER BY created_at DESC LIMIT 1", [clienteId]);
  if (venta.rows[0]?.ubicacion) ok(`la venta quedó guardada en: ${venta.rows[0].ubicacion}${venta.rows[0].caja ? " " + venta.rows[0].caja : ""}`);
  else fail("la venta se creó sin ubicación");

  const ficha = await db.query("SELECT box_1 FROM clients WHERE id=$1", [clienteId]);
  if (venta.rows[0]?.ubicacion === "caja") {
    if (Number(ficha.rows[0].box_1) === Number(venta.rows[0].caja)) ok("la ficha de la clienta refleja la caja");
    else fail(`la ficha quedó con box_1="${ficha.rows[0].box_1}"`);
  }
} catch (e) {
  fail(e.message);
  await page.screenshot({ path: "scripts/pos-fallo.png" }).catch(() => {});
} finally {
  try {
    if (clienteId) {
      await db.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id=$1)`, [clienteId]);
      await db.query("DELETE FROM sales WHERE client_id=$1", [clienteId]);
      await db.query("DELETE FROM clients WHERE id=$1", [clienteId]);
    }
    if (productoId) {
      await db.query("DELETE FROM sale_items WHERE product_id=$1", [productoId]);
      await db.query("DELETE FROM products WHERE id=$1", [productoId]);
    }
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
