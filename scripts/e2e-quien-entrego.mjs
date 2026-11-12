import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// Que la firma de la entrega se VEA en el detalle de venta, que es donde la ibas a
// buscar. Y que lo entregado de antes, que no tiene firma porque no se guardaba,
// lo diga en vez de aparecer en blanco como si nada faltara.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_FIRMA";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let clienteId, productoId, saleId;

try {
  await db.connect();

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',300,50,100) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8711234567') RETURNING id`,
    [ETIQUETA, "@prueba_firma"]);
  clienteId = c.rows[0].id;

  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at)
     VALUES ($1,900,900,0,'paid','efectivo',now() - interval '20 days') RETURNING id`, [clienteId]);
  saleId = v.rows[0].id;

  const conFirma = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,300,'pending') RETURNING id`, [saleId, productoId]);
  // Uno entregado "de antes": como los miles que ya tenías, sin fecha ni nombre.
  await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status,delivered_at,delivered_by_name)
     VALUES ($1,$2,1,300,'delivered',null,null)`, [saleId, productoId]);
  // Y uno todavía pendiente, para que el renglón de siempre no se haya roto.
  await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,300,'pending')`, [saleId, productoId]);
  ok("una venta con 3 productos: uno por entregar, uno entregado de antes y uno pendiente");

  // Lo entrega Gaby, por la vía normal
  const r = await fetch(`${BASE}/api/panel/chequeo`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("worker", "Gaby") },
    body: JSON.stringify({ accion: "entregado", itemIds: [conFirma.rows[0].id], clientId: clienteId }),
  });
  if (!r.ok) throw new Error("no se pudo entregar: " + (await r.text()).slice(0, 150));
  ok("Gaby marca entregado uno de ellos");

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Prueba Admin"));
  const page = await ctx.newPage();

  await page.goto(`${BASE}/panel/ventas/${saleId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByText("Detalle de Venta").first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(1200);
  const texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");

  if (/por Gaby/.test(texto)) ok("el detalle de venta dice quién lo entregó: por Gaby");
  else fail("no dice quién lo entregó: " + texto.slice(0, 400));

  const hoy = new Date();
  const mes = hoy.toLocaleString("es-MX", { month: "long" });
  if (new RegExp(`${hoy.getDate()} de ${mes} de ${hoy.getFullYear()}`, "i").test(texto))
    ok("y el día completo, no solo la fecha de la compra");
  else
    fail("no aparece la fecha de entrega de hoy");

  if (/\d{1,2}:\d{2}/.test(texto)) ok("con la hora");
  else fail("no aparece la hora");

  if (/Sin registro de cuándo ni quién/i.test(texto))
    ok("y lo entregado de antes lo dice claro, en vez de aparecer en blanco");
  else
    fail("lo entregado sin firma no avisa que no hay registro");

  if (/Pendiente de Entrega/i.test(texto)) ok("lo que sigue pendiente se ve igual que siempre");
  else fail("se rompió el renglón de los pendientes");

  await page.screenshot({ path: "scripts/quien-entrego.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (saleId) {
      await db.query("DELETE FROM sale_items WHERE sale_id=$1", [saleId]);
      await db.query("DELETE FROM sales WHERE id=$1", [saleId]);
    }
    if (clienteId) await db.query("DELETE FROM clients WHERE id=$1", [clienteId]);
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
