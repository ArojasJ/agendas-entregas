import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// En Detalle de Venta no había forma de saber dónde está guardada la mercancía: había
// que salirse a la pantalla de Clientes. Ahora se ve el lugar de ESA compra y, como
// pista, las cajas de la clienta — que es lo único que hay cuando la compra no trae
// lugar anotado, que es el caso más común.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_DONDE";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let clienteId, productoId, caja;
const ventas = {};

async function venta(ubicacion, cajaN) {
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja)
     VALUES ($1,100,0,0,'credit','efectivo',now(),$2,$3) RETURNING id`, [clienteId, ubicacion, cajaN]);
  await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,100,'pending')`, [v.rows[0].id, productoId]);
  return v.rows[0].id;
}

try {
  await db.connect();

  const libre = await db.query(`
    with ocupadas as (
      select (regexp_matches(coalesce(box_1,'')||','||coalesce(box_2,''), '\\d+', 'g'))[1]::int n from clients
      union select caja::int from sales where ubicacion='caja' and caja is not null)
    select n from generate_series(1,120) n
    where n not in (select n from ocupadas where n is not null) order by n desc limit 1`);
  caja = libre.rows[0].n;

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,50,40) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;

  const cl = await db.query(
    `INSERT INTO clients (name,instagram,phone,box_1) VALUES ($1,$2,'8711234567',$3) RETURNING id`,
    [ETIQUETA, "@prueba_donde", String(caja)]);
  clienteId = cl.rows[0].id;

  ventas.caja = await venta("caja", caja);
  ventas.estante = await venta("estante", null);
  ventas.sinLugar = await venta(null, null);
  ok(`clienta con la caja ${caja} y 3 compras: en caja, en estante y sin lugar`);

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Prueba Admin"));
  const page = await ctx.newPage();

  const abrir = async (id) => {
    // networkidle no llega nunca en esta pantalla: se espera al título
    await page.goto(`${BASE}/panel/ventas/${id}`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.getByText("Detalle de Venta").first().waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(600);
    return (await page.locator("body").innerText()).replace(/\s+/g, " ");
  };

  // ── En caja ──
  let t = await abrir(ventas.caja);
  if (/DÓNDE ESTÁ/i.test(t)) ok("la venta en caja muestra el bloque de dónde está");
  else fail("no aparece el bloque de ubicación");
  if (new RegExp(`Caja ${caja}`).test(t)) ok(`dice que está en la caja ${caja}, sin salir de la pantalla`);
  else fail(`no dice la caja ${caja}`);
  // Si esa es su única caja, no tiene caso repetirla como "también tiene"
  if (!/También tiene/i.test(t)) ok("y no repite esa misma caja como si fuera otra");
  else fail("repite la caja de la compra como si la clienta tuviera otra");

  // ── En estante ──
  t = await abrir(ventas.estante);
  if (/Estante/i.test(t)) ok("la venta en estante dice Estante");
  else fail("la venta en estante no lo indica");
  if (new RegExp(`caja ${caja}`, "i").test(t)) ok("y de todos modos recuerda qué cajas tiene la clienta");
  else fail("no muestra las cajas de la clienta");

  // ── Sin lugar anotado: el caso más común ──
  t = await abrir(ventas.sinLugar);
  if (/Sin lugar anotado/i.test(t)) ok("la venta sin ubicar lo dice en vez de inventar un lugar");
  else fail("la venta sin ubicar no avisa que no tiene lugar");
  if (/Búscalo en sus cajas/i.test(t) && new RegExp(`caja ${caja}`, "i").test(t))
    ok(`y manda a buscar en su caja ${caja}, que es la pista que había`);
  else
    fail("no da la pista de las cajas de la clienta");

  // ── Venta de mostrador: no debe inventar nada ──
  const mostrador = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at)
     VALUES (NULL,100,100,0,'paid','efectivo',now()) RETURNING id`);
  ventas.mostrador = mostrador.rows[0].id;
  t = await abrir(ventas.mostrador);
  if (!/DÓNDE ESTÁ/i.test(t)) ok("una venta sin cliente no muestra el bloque");
  else fail("una venta de mostrador muestra ubicación");

  await abrir(ventas.caja);
  await page.getByText("Dónde está").first().waitFor({ state: "visible", timeout: 20000 });
  await page.screenshot({ path: "scripts/venta-donde-esta.png" });

  // ── Y el expediente del cliente también ──
  await page.goto(`${BASE}/panel/clientes?openId=${clienteId}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);
  // Acotado al expediente: buscando en toda la página, los renglones de la lista que
  // quedan atrás ya traen la caja y la revisión pasaba sin probar nada.
  const expediente = page.locator("div.fixed.inset-0").filter({ hasText: "@prueba_donde" }).last();
  if (await expediente.count() === 0) {
    fail("no se abrió el expediente del cliente");
  } else {
    const exp = (await expediente.innerText()).replace(/\s+/g, " ");
    if (new RegExp(`Caja ${caja}`).test(exp)) ok(`el expediente del cliente también muestra la caja ${caja}`);
    else fail("el expediente del cliente sigue sin mostrar sus cajas");
  }
} catch (e) {
  fail(e.message);
} finally {
  try {
    const ids = Object.values(ventas).filter(Boolean);
    if (ids.length) {
      await db.query("DELETE FROM sale_items WHERE sale_id = ANY($1::uuid[])", [ids]);
      await db.query("DELETE FROM sales WHERE id = ANY($1::uuid[])", [ids]);
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
