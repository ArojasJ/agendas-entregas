import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";

// Un producto metido en un paquete armado ya no está en su caja ni en el estante.
// Las pantallas de Clientes y del punto de venta pintaban "Caja N" si era caja y
// "Estante" para todo lo demás, así que lo empacado se veía como si estuviera en el
// estante: mandaba a la empleada a buscarlo al lugar equivocado.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_SEVE";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let clienteId, productoId, bookingId, caja;
const ventas = [];

try {
  await db.connect();

  const libre = await db.query(`
    with o as (
      select (regexp_matches(coalesce(box_1,'')||','||coalesce(box_2,''),'\\d+','g'))[1]::int n from clients
      union select caja::int from sales where ubicacion='caja' and caja is not null)
    select n from generate_series(1,120) n where n not in (select n from o where n is not null) order by n desc limit 1`);
  caja = libre.rows[0].n;

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,99,40) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8711234567') RETURNING id`,
    [ETIQUETA, "@prueba_seve"]);
  clienteId = c.rows[0].id;

  // Dos compras: una se va al paquete, la otra se queda en su caja.
  const mk = async (ubic, cajaN) => {
    const v = await db.query(
      `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja)
       VALUES ($1,100,100,0,'paid','efectivo',now(),$2,$3) RETURNING id`, [clienteId, ubic, cajaN]);
    const i = await db.query(
      `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
       VALUES ($1,$2,1,100,'pending') RETURNING id`, [v.rows[0].id, productoId]);
    ventas.push(v.rows[0].id);
    return i.rows[0].id;
  };
  const alPaquete = await mk("estante", null);   // se empaca
  await mk("caja", caja);                         // se queda en la caja

  const b = await db.query(
    `INSERT INTO bookings (type,date,instagram,"fullName",phone,status,delivery_status,products,sale_item_ids)
     VALUES ('domicilio','${isoDePrueba()}','@prueba_seve',$1,'8711234567','confirmed','pendiente','x','[]'::jsonb)
     RETURNING id`, [ETIQUETA]);
  bookingId = b.rows[0].id;

  const r = await fetch(`${BASE}/api/panel/paquetes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("admin", "Gaby") },
    body: JSON.stringify({ accion: "armar", bookingId, clientId: clienteId, itemIds: [alPaquete] }),
  });
  if (!r.ok) throw new Error("no se pudo armar: " + (await r.text()).slice(0, 150));
  ok(`clienta con un producto empacado y otro guardado en la caja ${caja}`);

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Prueba Admin"));
  const page = await ctx.newPage();

  // ── El cuadro de editar cliente, que es donde se lista lo que tiene guardado ──
  await page.goto(`${BASE}/panel/clientes`, { waitUntil: "networkidle", timeout: 90000 });
  await page.getByPlaceholder(/Buscar/i).first().fill(ETIQUETA);
  await page.waitForTimeout(1500);
  const renglon = page.locator("div").filter({ hasText: ETIQUETA })
    .filter({ has: page.getByRole("button", { name: "✏️" }) }).last();
  await renglon.getByRole("button", { name: "✏️" }).first().click();
  await page.waitForTimeout(2500);

  const cuadro = page.locator("div").filter({ hasText: "Guardado" })
    .filter({ has: page.getByRole("button", { name: /^Guardar$/ }) }).last();
  if (await cuadro.count() === 0) throw new Error("no se abrió el cuadro de editar cliente");
  const t = (await cuadro.innerText()).replace(/\s+/g, " ");

  if (/Paquete armado/i.test(t)) ok("en el expediente, lo empacado dice PAQUETE ARMADO");
  else fail("el expediente no muestra el estado nuevo: " + t.slice(0, 300));
  if (new RegExp(`Caja ${caja}`, "i").test(t)) ok(`y lo que sigue guardado sigue diciendo Caja ${caja}`);
  else fail("se perdió la caja del otro producto");
  if (!/Estante/i.test(t)) ok("y ya no dice Estante por lo empacado, que era lo engañoso");
  else fail("sigue diciendo Estante: " + t.slice(0, 300));
  if (/listo para salir/i.test(t)) ok("no ofrece moverlo: su lugar lo manda la entrega");
  else fail("sigue ofreciendo mover algo que ya está en un paquete");

  await page.screenshot({ path: "scripts/paquete-se-ve.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (bookingId) await db.query("DELETE FROM bookings WHERE id=$1", [bookingId]);
    if (ventas.length) {
      await db.query("DELETE FROM sale_items WHERE sale_id = ANY($1::uuid[])", [ventas]);
      await db.query("DELETE FROM sales WHERE id = ANY($1::uuid[])", [ventas]);
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
