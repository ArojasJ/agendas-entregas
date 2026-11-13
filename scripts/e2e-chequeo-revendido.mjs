import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// Los dos botones nuevos en Chequeo, picados como los va a picar la empleada.
// Chequeo solo lista lo que lleva más de 10 días sin lugar y de clientas sin cajas,
// así que el producto de prueba se fecha atrás para que aparezca.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_BOTONES";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let productoId;
const clientes = [];

async function clientaConPendiente(sufijo) {
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8711234567') RETURNING id`,
    [`${ETIQUETA} ${sufijo}`, `@prueba_botones_${sufijo}`]);
  clientes.push(c.rows[0].id);
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at)
     VALUES ($1,500,500,0,'paid','efectivo',now() - interval '40 days') RETURNING id`, [c.rows[0].id]);
  const i = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,500,'pending') RETURNING id`, [v.rows[0].id, productoId]);
  return { clienteId: c.rows[0].id, itemId: i.rows[0].id };
}

const estado = async (itemId) => (await db.query(
  `select delivery_status, resolucion, delivered_by_name from sale_items where id=$1`, [itemId])).rows[0];

try {
  await db.connect();
  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',500,7,200) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;

  const rev = await clientaConPendiente("rev");
  const per = await clientaConPendiente("per");
  ok("dos clientas con un producto pendiente cada una, de hace 40 días");

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("worker", "Gaby"));
  const page = await ctx.newPage();

  const abrir = async () => {
    await page.goto(`${BASE}/panel/chequeo`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.getByRole("heading", { name: "Chequeo" }).waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(3000);
  };
  const tarjetaDe = (sufijo) =>
    page.locator("div").filter({ hasText: `@prueba_botones_${sufijo}` })
      .filter({ has: page.getByRole("button", { name: /Ya entregado/ }) }).last();

  await abrir();
  const t = tarjetaDe("rev");
  if (await t.count() === 0) throw new Error("la clienta de prueba no aparece en Chequeo");

  const texto = (await t.innerText()).replace(/\s+/g, " ");
  if (/Revendido/i.test(texto) && /Perdido/i.test(texto))
    ok("Chequeo ofrece las cuatro salidas: entregado, estante, revendido y perdido");
  else
    fail("faltan los botones nuevos: " + texto.slice(0, 250));

  // ── Revendido ──
  await t.getByRole("button", { name: /Revendido/ }).first().click();
  await page.waitForTimeout(2500);
  let e = await estado(rev.itemId);
  if (e.resolucion === "revendido" && e.delivery_status === "delivered")
    ok("al picar Revendido el producto queda resuelto y con su motivo");
  else
    fail("no se marcó revendido: " + JSON.stringify(e));
  if (e.delivered_by_name === "Gaby") ok("y firmado por quien lo marcó");
  else fail("no quedó firmado: " + e.delivered_by_name);

  let enPantalla = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (!/@prueba_botones_rev/.test(enPantalla)) ok("y sale de la lista al momento, sin recargar");
  else fail("sigue en la lista después de marcarlo");

  // ── Perdido ──
  const t2 = tarjetaDe("per");
  await t2.getByRole("button", { name: /Perdido/ }).first().click();
  await page.waitForTimeout(2500);
  e = await estado(per.itemId);
  if (e.resolucion === "perdido") ok("y Perdido funciona igual");
  else fail("no se marcó perdido: " + JSON.stringify(e));

  // ── El inventario no se movió ──
  const stock = (await db.query(`select stock from products where id=$1`, [productoId])).rows[0].stock;
  if (stock === 7) ok("el inventario sigue intacto después de los dos: stock en 7");
  else fail(`el inventario cambió a ${stock}`);

  await page.screenshot({ path: "scripts/chequeo-revendido.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (clientes.length) {
      await db.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1::uuid[]))`, [clientes]);
      await db.query(`DELETE FROM sales WHERE client_id = ANY($1::uuid[])`, [clientes]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [clientes]);
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
