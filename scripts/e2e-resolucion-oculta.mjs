import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// La etiqueta de REVENDIDO o PERDIDO es para el panel, no para la clienta: decirle
// "entregado" de algo que nunca recibió sería mentirle, y el motivo se habla en
// persona. Aquí se comprueba que el panel sí la vea y que a ella no le llegue —ni
// pintada ni escondida en los datos.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_OCULTA";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let clienteId, productoId, ventaId;

try {
  await db.connect();

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',500,7,200) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8719998877') RETURNING id`,
    [ETIQUETA, "@prueba_oculta"]);
  clienteId = c.rows[0].id;

  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at)
     VALUES ($1,500,500,0,'paid','efectivo',now()) RETURNING id`, [clienteId]);
  ventaId = v.rows[0].id;
  const item = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status,resolucion,delivered_by_name)
     VALUES ($1,$2,1,500,'delivered','perdido','Gaby') RETURNING id`, [ventaId, productoId]);
  ok("una compra con un producto marcado como PERDIDO");

  const ctx = await browser.newContext({ viewport: { width: 1300, height: 950 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Prueba Admin"));
  const page = await ctx.newPage();

  // ── El panel SÍ la ve ──
  await page.goto(`${BASE}/panel/ventas/${ventaId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByText("Detalle de Venta").first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(1500);
  const panel = (await page.locator("body").innerText()).replace(/\s+/g, " ");

  if (/Perdido/i.test(panel)) ok("el Detalle de Venta muestra la etiqueta PERDIDO");
  else fail("el panel no muestra la etiqueta: " + panel.slice(0, 350));
  if (!/✓ Entregado/.test(panel)) ok("y ya no dice 'Entregado', que sería falso");
  else fail("sigue diciendo Entregado de algo que se perdió");

  // ── A la clienta NO le llega ──
  // El tablero de la clienta va tras una sesión de Supabase; fabricar una aquí sería
  // crear un usuario real en producción. La limpieza vive en su propia función justo
  // para poder probarla de verdad en vez de fingir el inicio de sesión.
  const { ocultarResolucion } = await import("../lib/vistaCliente.js");

  const comoLoTraeLaBase = [{
    id: "v1",
    sale_items: [
      { id: "a", delivery_status: "delivered", resolucion: "perdido" },
      { id: "b", delivery_status: "delivered", resolucion: "revendido" },
      { id: "c", delivery_status: "delivered", resolucion: null },
      { id: "d", delivery_status: "pending", resolucion: null },
    ],
  }];
  const paraLaClienta = ocultarResolucion(JSON.parse(JSON.stringify(comoLoTraeLaBase)));
  const comoQueda = JSON.stringify(paraLaClienta);

  if (!/resolucion/.test(comoQueda)) ok("el motivo ni siquiera viaja: se borra antes de responder");
  else fail("el motivo sigue en la respuesta: " + comoQueda);
  if (!/perdido|revendido/.test(comoQueda)) ok("ni la palabra perdido o revendido aparece en sus datos");
  else fail("las palabras llegan a la clienta: " + comoQueda);

  const items = paraLaClienta[0].sale_items;
  if (items[0].delivery_status === null && items[1].delivery_status === null)
    ok("lo perdido y lo revendido le llegan sin estado: no se le dice que lo recibió");
  else
    fail("le llega con estado: " + JSON.stringify(items.slice(0, 2)));
  if (items[2].delivery_status === "delivered" && items[3].delivery_status === "pending")
    ok("y lo entregado de verdad y lo pendiente le siguen llegando igual que siempre");
  else
    fail("se alteró lo que sí debe ver: " + JSON.stringify(items.slice(2)));

  await page.screenshot({ path: "scripts/resolucion-panel.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (ventaId) {
      await db.query("DELETE FROM sale_items WHERE sale_id=$1", [ventaId]);
      await db.query("DELETE FROM sales WHERE id=$1", [ventaId]);
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
