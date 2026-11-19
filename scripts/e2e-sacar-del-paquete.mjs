import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";

// El caso de @fatima_chacon_glz, tal cual pasó: su paquete estaba armado con cinco
// productos, llegó a bodega, vio lo que debía y decidió llevarse solo los tres
// liquidados. Dejó dos.
//
// Antes no había forma de hacerlo: quitarlos de la lista los dejaba pegados al paquete
// igual —la tarjeta decía tres y el sistema seguía creyendo cinco—, así que marcar la
// entrega habría dado por entregados los cinco. La única salida era deshacer el
// paquete entero y rearmarlo.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_SACAR";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let clienteId, bookingId, caja;
const ventas = [];
const items = {};

// Una compra con un producto: liquidada o debiendo, como las de ella.
async function compra(nombre, total, pagado) {
  const pr = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',$2,5,10) RETURNING id`,
    [ETIQUETA + " " + nombre, total]);
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja)
     VALUES ($1,$2,$3,0,$4,'efectivo',now(),'caja',$5) RETURNING id`,
    [clienteId, total, pagado, pagado >= total ? "paid" : "credit", caja]);
  ventas.push(v.rows[0].id);
  const i = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,$3,'pending') RETURNING id`, [v.rows[0].id, pr.rows[0].id, total]);
  items[nombre] = i.rows[0].id;
  return i.rows[0].id;
}

const enElPaquete = async () => (await db.query(
  `select id from sale_items where paquete_booking_id = $1`, [bookingId])).rows.map((r) => r.id);

try {
  await db.connect();

  const libre = await db.query(`
    with o as (
      select (regexp_matches(coalesce(box_1,'')||','||coalesce(box_2,''),'\\d+','g'))[1]::int n from clients
      union select caja::int from sales where ubicacion='caja' and caja is not null)
    select n from generate_series(1,120) n where n not in (select n from o where n is not null) order by n desc limit 1`);
  caja = libre.rows[0].n;

  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,'@prueba_sacar','8710004444') RETURNING id`, [ETIQUETA]);
  clienteId = c.rows[0].id;

  // Tres liquidados y dos debiendo, como ella
  await compra("liquidado1", 100, 100);
  await compra("liquidado2", 200, 200);
  await compra("liquidado3", 300, 300);
  await compra("debe1", 340, 60);
  await compra("debe2", 390, 60);
  ok(`clienta con 5 productos en la caja ${caja}: 3 liquidados y 2 debiendo`);

  const b = await db.query(
    `INSERT INTO bookings (type,date,instagram,"fullName",phone,status,delivery_status,products,sale_item_ids)
     VALUES ('bodega',$1,'@prueba_sacar',$2,'8710004444','confirmed','pendiente','x','[]'::jsonb) RETURNING id`,
    [isoDePrueba(), ETIQUETA]);
  bookingId = b.rows[0].id;

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Antonio");
  }, tokenDePrueba("worker", "Gaby"));
  const page = await ctx.newPage();

  const abrir = async () => {
    await page.goto(`${BASE}/panel/entregas/preparacion?tipo=bodega&fecha=${isoDePrueba()}`,
      { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.getByRole("heading", { name: "Preparación de paquetes" }).waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.getByText(ETIQUETA, { exact: false }).first().click();
    await page.waitForTimeout(2500);
  };

  // ── Armar los 5, como se armó el suyo ──
  await abrir();
  await page.getByText("productos esperando", { exact: false }).first().click();
  await page.waitForTimeout(2500);
  // Al ligar la clienta los productos salen sin palomear: hay que elegir qué se lleva.
  const renglon = (n) => page.locator(`button:has-text("${ETIQUETA} ${n}")`).first();
  for (const n of ["liquidado1", "liquidado2", "liquidado3", "debe1", "debe2"]) {
    await renglon(n).click();
    await page.waitForTimeout(900);
  }
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: /Armar paquete \(5\)/ }).click();
  await page.waitForTimeout(3500);
  if ((await enElPaquete()).length === 5) ok("paquete armado con los 5, como estaba el suyo");
  else fail("no se armaron los 5: " + (await enElPaquete()).length);

  // ── Llega, ve lo que debe y se lleva solo lo liquidado ──
  await abrir();
  // El modal tarda en traer el detalle y en reconocer a la clienta ya ligada.
  await page.getByText("¿Qué se lleva?", { exact: false }).first()
    .waitFor({ state: "visible", timeout: 20000 })
    .catch(async () => {
      await page.screenshot({ path: "scripts/sacar-diagnostico.png" });
      throw new Error("no abrió el paquete ya armado — ver scripts/sacar-diagnostico.png");
    });
  await page.waitForTimeout(1500);
  const texto0 = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/\(5 de 5\)/i.test(texto0)) ok("al reabrirlo, los 5 salen palomeados");
  else fail("no salen palomeados: " + (texto0.match(/\(\d+ de \d+\)/i) || ["?"])[0]);

  for (const n of ["debe1", "debe2"]) {
    await renglon(n).click();
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(2000);

  const texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/No se lleva 2 productos/i.test(texto)) ok("avisa que no se lleva 2 productos");
  else fail("no avisa de los que se quedan: " + (texto.match(/No se lleva[^|]{0,60}|¿Qué se lleva\?[^|]{0,30}/i) || [texto.slice(-300)])[0]);

  if (new RegExp(`De vuelta a la caja ${caja}`, "i").test(texto))
    ok(`y pregunta dónde se quedan, proponiendo su caja ${caja}`);
  else
    fail("no pregunta dónde se quedan");

  if (/Al estante/i.test(texto)) ok("con la opción de dejarlos en el estante");
  else fail("no ofrece el estante");

  // Esta vez se quedan en el estante
  await page.getByRole("button", { name: /Al estante/ }).click();
  await page.waitForTimeout(1500);

  await page.getByRole("button", { name: /Armar paquete \(3\)/ }).click();
  await page.waitForTimeout(4000);

  // ── Lo que de verdad importa ──
  const dentro = await enElPaquete();
  if (dentro.length === 3) ok("el paquete queda con 3: los que se quitaron SALIERON de verdad");
  else fail(`el paquete quedó con ${dentro.length}: los quitados siguen pegados`);

  if (!dentro.includes(items.debe1) && !dentro.includes(items.debe2))
    ok("y los dos que debe ya no están adentro");
  else
    fail("alguno de los que debe sigue en el paquete");

  const lugares = (await db.query(
    `select i.id, i.ubicacion, i.caja from sale_items i where i.id = ANY($1::uuid[])`,
    [[items.debe1, items.debe2]])).rows;
  if (lugares.every((l) => l.ubicacion === "estante"))
    ok("quedaron en el estante, que fue lo que se eligió");
  else
    fail("no se guardaron donde se dijo: " + JSON.stringify(lugares));

  const bk = (await db.query(
    `select sale_item_ids, amount_due, products from bookings where id=$1`, [bookingId])).rows[0];
  if ((bk.sale_item_ids || []).length === 3) ok("la tarjeta dice 3 productos, no 5");
  else fail("la tarjeta quedó mal: " + JSON.stringify(bk.sale_item_ids));

  if (Number(bk.amount_due) === 0)
    ok("y a cobrar $0: lo que se llevó ya estaba liquidado");
  else
    fail("quiere cobrarle " + bk.amount_due + " por cosas liquidadas");

  // ── Marcar la entrega NO debe tocar los dos que dejó ──
  const r = await fetch(`${BASE}/api/bookings/update-delivery`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("worker", "Gaby") },
    body: JSON.stringify({ id: bookingId, deliveryStatus: "entregado", paymentMethod: "efectivo",
                           products: bk.products || "", amountDue: 0 }),
  });
  if (!r.ok) throw new Error("no se pudo marcar entregada: " + (await r.text()).slice(0, 200));
  await new Promise((s) => setTimeout(s, 1500));

  const estados = (await db.query(
    `select id, delivery_status from sale_items where id = ANY($1::uuid[])`,
    [Object.values(items)])).rows;
  const entregados = estados.filter((e) => e.delivery_status === "delivered").map((e) => e.id);
  if (entregados.length === 3) ok("al marcar la entrega se entregan 3, no los 5");
  else fail(`se marcaron ${entregados.length} entregados`);

  if (!entregados.includes(items.debe1) && !entregados.includes(items.debe2))
    ok("los dos que te dejó siguen pendientes, esperándola en el estante");
  else
    fail("marcó entregado algo que la clienta dejó ahí");

  await page.screenshot({ path: "scripts/sacar-del-paquete.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (bookingId) {
      await db.query(`update sale_items set paquete_booking_id=null where paquete_booking_id=$1`, [bookingId]);
      await db.query("DELETE FROM bookings WHERE id=$1", [bookingId]);
    }
    if (ventas.length) {
      await db.query("DELETE FROM sale_items WHERE sale_id = ANY($1::uuid[])", [ventas]);
      await db.query("DELETE FROM sales WHERE id = ANY($1::uuid[])", [ventas]);
    }
    if (clienteId) await db.query("DELETE FROM clients WHERE id=$1", [clienteId]);
    await db.query(`DELETE FROM products WHERE name LIKE $1`, [ETIQUETA + "%"]);
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
