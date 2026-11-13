import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// Un pedido web se paga solo, por el aviso de MercadoPago, sin que nadie decida dónde
// se guarda la mercancía. Por eso entraba sin lugar: 67 ventas pagadas en un mes
// acabaron así, y de ahí salió el body mist de Cinthia.
//
// Ahora los pedidos pagados sin ubicar salen en la pantalla de Pedidos Web con las
// mismas opciones del punto de venta.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_WEB";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let clienteId, productoId, ventaId, caja;

try {
  await db.connect();

  const libre = await db.query(`
    with o as (
      select (regexp_matches(coalesce(box_1,'')||','||coalesce(box_2,''),'\\d+','g'))[1]::int n from clients
      union select caja::int from sales where ubicacion='caja' and caja is not null)
    select n from generate_series(1,120) n where n not in (select n from o where n is not null) order by n desc limit 1`);
  caja = libre.rows[0].n;

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',140,50,60) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8711234567') RETURNING id`,
    [ETIQUETA, "@prueba_web"]);
  clienteId = c.rows[0].id;

  // Un pedido web ya pagado, como lo deja el aviso de MercadoPago: sin lugar.
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at)
     VALUES ($1,140,140,0,'paid','Pedido Web',now()) RETURNING id`, [clienteId]);
  ventaId = v.rows[0].id;
  await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,140,'pending')`, [ventaId, productoId]);
  ok("un pedido web pagado entra sin lugar anotado, como lo deja el cobro en línea");

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Prueba Admin"));
  const page = await ctx.newPage();

  await page.goto(`${BASE}/panel/catalogo`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByRole("heading", { name: "Pedidos Web" }).waitFor({ state: "visible", timeout: 30000 });
  // Primero a que aparezca la sección —la lista de pedidos tarda en llegar— y
  // después a que ninguna tarjeta siga consultando: cada una pregunta por las cajas
  // libres y ese cálculo recorre toda la base.
  await page.getByText("Falta decir dónde se guardan").waitFor({ state: "visible", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll(".animate-spin").length === 0,
    null, { timeout: 60000 });
  await page.waitForTimeout(500);

  let texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/Falta decir dónde se guardan/i.test(texto)) ok("la pantalla de Pedidos Web lo reclama");
  else fail("no aparece la sección de pedidos sin ubicar: " + texto.slice(0, 300));

  const tarjeta = page.locator("div").filter({ hasText: ETIQUETA })
    .filter({ has: page.getByRole("button", { name: /Guardar dónde quedó/ }) }).last();
  if (await tarjeta.count() === 0) throw new Error("no aparece la tarjeta del pedido de prueba");

  const t = (await tarjeta.innerText()).replace(/\s+/g, " ");
  if (/Poner en estante/i.test(t)) ok("ofrece las mismas opciones del punto de venta: estante");
  else fail("no ofrece estante: " + t.slice(0, 250));
  if (/O elige otra caja/i.test(t)) ok("y las cajas libres para elegir otra");
  else fail("no ofrece cajas");
  if (/Sugerido/i.test(t)) ok("con una sugerida ya marcada, para que sea un solo toque");
  else fail("no sugiere ninguna");

  // Elegir una caja concreta y guardar. Se toma una de las que ofrece la pantalla:
  // el selector enseña las ocho más bajas, no cualquiera libre.
  const ofrecidas = tarjeta.locator("p", { hasText: /^O elige otra caja$/ }).locator("..").locator("button");
  if (await ofrecidas.count() === 0) throw new Error("no ofrece ninguna caja");
  caja = Number((await ofrecidas.first().innerText()).trim());
  await ofrecidas.first().click();
  await page.waitForTimeout(600);
  await tarjeta.getByRole("button", { name: /Guardar dónde quedó/ }).click();
  await page.waitForTimeout(3000);

  const fin = await db.query(`select ubicacion, caja from sales where id=$1`, [ventaId]);
  if (fin.rows[0].ubicacion === "caja" && Number(fin.rows[0].caja) === caja)
    ok(`al guardar, el pedido queda en la caja ${caja}`);
  else
    fail("no se guardó el lugar: " + JSON.stringify(fin.rows[0]));

  const ficha = await db.query(`select box_1 from clients where id=$1`, [clienteId]);
  if (String(ficha.rows[0].box_1 || "").includes(String(caja)))
    ok("y la ficha de la clienta se sincroniza sola");
  else
    fail("la ficha no se actualizó: " + ficha.rows[0].box_1);

  texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (!new RegExp(ETIQUETA).test(texto)) ok("y el pedido sale de la lista de pendientes por ubicar");
  else fail("sigue apareciendo como pendiente de ubicar");

  await page.screenshot({ path: "scripts/pedido-web-ubicacion.png" });
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
