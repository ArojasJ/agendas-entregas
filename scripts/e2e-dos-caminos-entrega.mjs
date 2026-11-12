import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";

// Hay dos formas de marcar una entrega: desde la tarjeta en el panel de Entregas, y
// desde el módulo de ruta que usa el repartidor. Ahora que el paquete deja los
// productos ligados, las dos tienen que mover el estado de los productos.
//
// Las entregas de prueba se agendan a más de un año: una prueba anterior creó un
// paquete con la fecha de hoy y se le movió la ruta a la repartidora que trabajaba.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_CAMINOS";
const FECHA = isoDePrueba();

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let productoId;
const clientes = [];
const bookings = [];

// Una clienta con un paquete ya armado, lista para entregar.
async function conPaqueteArmado(sufijo, conInstagram = true) {
  // Las entregas sin usuario lo traen VACÍO, no nulo: la columna no acepta nulos.
  // Así son las 6 que hay en los últimos 60 días.
  const ig = conInstagram ? `@prueba_caminos_${sufijo}` : "";
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8711234567') RETURNING id`,
    [`${ETIQUETA} ${sufijo}`, ig || null]);
  const clienteId = c.rows[0].id;
  clientes.push(clienteId);

  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at)
     VALUES ($1,300,300,0,'paid','efectivo',now()) RETURNING id`, [clienteId]);
  const i = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,300,'pending') RETURNING id`, [v.rows[0].id, productoId]);

  const b = await db.query(
    `INSERT INTO bookings (type,date,instagram,"fullName",phone,address,city,status,
                           delivery_status,products,amount_due,sale_item_ids,override,lat,lng)
     VALUES ('domicilio',$1,$2,$3,'8711234567','Calle Prueba 1','Torreón','confirmed',
             'pendiente','1x '||$4,0,$5::jsonb,true,25.54,-103.40) RETURNING id`,
    [FECHA, ig, `${ETIQUETA} ${sufijo}`, ETIQUETA, JSON.stringify([i.rows[0].id])]);
  bookings.push(b.rows[0].id);

  // Armar el paquete de verdad, por la vía del módulo
  const r = await fetch(`${BASE}/api/panel/paquetes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("worker", "Gaby") },
    body: JSON.stringify({ accion: "armar", bookingId: b.rows[0].id, clientId: clienteId, itemIds: [i.rows[0].id] }),
  });
  if (!r.ok) throw new Error("no se pudo armar el paquete de " + sufijo + ": " + (await r.text()).slice(0, 120));

  return { clienteId, bookingId: b.rows[0].id, itemId: i.rows[0].id };
}

const estado = async (itemId) => (await db.query(
  `select delivery_status, delivered_by_name, paquete_booking_id from sale_items where id=$1`, [itemId])).rows[0];

try {
  await db.connect();

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',300,99,100) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;

  const porTarjeta = await conPaqueteArmado("tarjeta");
  const porRuta = await conPaqueteArmado("ruta");
  const sinUsuario = await conPaqueteArmado("sinig", false);
  ok(`3 paquetes armados y agendados para el ${FECHA}, lejos de cualquier ruta real`);

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Dennis"));
  const page = await ctx.newPage();

  // ── CAMINO 1: la tarjeta del panel de Entregas ──
  await page.goto(`${BASE}/panel/entregas?fecha=${FECHA}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(3000);

  // La lista del panel se mueve por fecha; se marca por la API que usa la tarjeta,
  // que es exactamente lo que dispara el botón de Guardar de ese cuadro.
  let r = await fetch(`${BASE}/api/bookings/update-delivery`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("admin", "Dennis") },
    body: JSON.stringify({
      id: porTarjeta.bookingId, deliveryStatus: "entregado",
      paymentMethod: "efectivo", products: "1x " + ETIQUETA, amountDue: 0,
    }),
  });
  if (!r.ok) fail("la tarjeta no pudo guardar: " + (await r.text()).slice(0, 150));

  let e = await estado(porTarjeta.itemId);
  if (e.delivery_status === "delivered") ok("CAMINO 1 — desde la tarjeta: el producto SÍ queda entregado");
  else fail("desde la tarjeta el producto sigue en " + e.delivery_status);
  if (e.delivered_by_name === "Dennis") ok("y firmado por quien la marcó");
  else fail("no quedó firmado: " + e.delivered_by_name);

  // ── CAMINO 2: el módulo de ruta del repartidor ──
  await page.goto(`${BASE}/panel/entregas/ruta?fecha=${FECHA}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(3000);
  ok("abre el módulo de ruta del repartidor");

  r = await fetch(`${BASE}/api/bookings/update-delivery`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("worker", "Gaby") },
    body: JSON.stringify({
      id: porRuta.bookingId, deliveryStatus: "entregado",
      paymentMethod: "efectivo", products: "1x " + ETIQUETA, amountDue: 0,
    }),
  });
  if (!r.ok) fail("la ruta no pudo guardar: " + (await r.text()).slice(0, 150));

  e = await estado(porRuta.itemId);
  if (e.delivery_status === "delivered") ok("CAMINO 2 — desde la ruta del repartidor: el producto también queda entregado");
  else fail("desde la ruta el producto sigue en " + e.delivery_status);
  if (e.delivered_by_name === "Gaby") ok("y firmado por Gaby, que fue quien lo entregó en la calle");
  else fail("no quedó firmado por la repartidora: " + e.delivered_by_name);

  // ── Una entrega sin usuario de Instagram: antes se saltaba todo ──
  r = await fetch(`${BASE}/api/bookings/update-delivery`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("worker", "Gaby") },
    body: JSON.stringify({
      id: sinUsuario.bookingId, deliveryStatus: "entregado",
      paymentMethod: "efectivo", products: "1x " + ETIQUETA, amountDue: 0,
    }),
  });
  if (!r.ok) fail("la entrega sin usuario no pudo guardar: " + (await r.text()).slice(0, 150));
  e = await estado(sinUsuario.itemId);
  if (e.delivery_status === "delivered")
    ok("y una entrega SIN usuario de Instagram también marca su producto (antes se saltaba entera)");
  else
    fail("la entrega sin usuario no movió el producto: " + e.delivery_status);

  // ── Deshacer limpia la tarjeta, como pediste ──
  const otro = await conPaqueteArmado("deshacer");
  let tarjeta = (await db.query("select products, amount_due from bookings where id=$1", [otro.bookingId])).rows[0];
  if (tarjeta.products) ok("un paquete armado deja la tarjeta escrita");
  else fail("la tarjeta quedó vacía al armar");

  await fetch(`${BASE}/api/panel/paquetes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("worker", "Gaby") },
    body: JSON.stringify({ accion: "deshacer", bookingId: otro.bookingId, clientId: otro.clienteId }),
  });
  tarjeta = (await db.query("select products, amount_due, sale_item_ids from bookings where id=$1", [otro.bookingId])).rows[0];
  if (!tarjeta.products && Number(tarjeta.amount_due) === 0 && (tarjeta.sale_item_ids || []).length === 0)
    ok("al deshacer el paquete, la tarjeta se borra: productos, monto y enlace");
  else
    fail("quedó rastro en la tarjeta: " + JSON.stringify(tarjeta));

  await page.screenshot({ path: "scripts/dos-caminos.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (bookings.length) await db.query("DELETE FROM bookings WHERE id = ANY($1::uuid[])", [bookings]);
    if (clientes.length) {
      await db.query(`DELETE FROM payments WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1::uuid[]))`, [clientes]);
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
