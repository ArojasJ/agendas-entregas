import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";

// Al armar el paquete, la tarjeta de la entrega tiene que quedar escrita sola: qué
// productos lleva y cuánto cobrar. Hasta hoy eso se tecleaba a mano, y por eso había
// tarjetas como la de Génesis Villalobos pidiendo cobrar $335 de unos aretes que ya
// estaban pagados.
//
// La deuda se cuenta por COMPRA y una sola vez, aunque del mismo ticket vayan dos
// productos. El envío lo pone quien prepara, porque no sale de ninguna venta.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_TARJETA";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const api = (url, opts) =>
  fetch(`${BASE}${url}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("worker", "Gaby"), ...(opts?.headers || {}) },
  });

let clienteId, prodA, prodB, bookingId;
const ventas = [];

try {
  await db.connect();

  const libre = await db.query(`
    with o as (
      select (regexp_matches(coalesce(box_1,'')||','||coalesce(box_2,''),'\\d+','g'))[1]::int n from clients
      union select caja::int from sales where ubicacion='caja' and caja is not null)
    select n from generate_series(1,120) n where n not in (select n from o where n is not null) order by n desc limit 1`);
  const caja = libre.rows[0].n;

  const a = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,99,40) RETURNING id`, ["ARETES " + ETIQUETA]);
  const b = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,99,40) RETURNING id`, ["COLLAR " + ETIQUETA]);
  prodA = a.rows[0].id; prodB = b.rows[0].id;

  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone,box_1) VALUES ($1,$2,'8711234567',$3) RETURNING id`,
    [ETIQUETA, "@prueba_tarjeta", String(caja)]);
  clienteId = c.rows[0].id;

  // Una compra LIQUIDADA con 2 productos y otra A CRÉDITO que debe $400.
  const v1 = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja)
     VALUES ($1,200,200,0,'paid','efectivo',now(),'caja',$2) RETURNING id`, [clienteId, caja]);
  const i1 = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,2,100,'pending') RETURNING id`, [v1.rows[0].id, prodA]);
  const i2 = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,100,'pending') RETURNING id`, [v1.rows[0].id, prodB]);
  ventas.push(v1.rows[0].id);

  const v2 = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja,due_date)
     VALUES ($1,500,100,0,'credit','efectivo',now(),'caja',$2,current_date+15) RETURNING id`, [clienteId, caja]);
  const i3 = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,500,'pending') RETURNING id`, [v2.rows[0].id, prodB]);
  ventas.push(v2.rows[0].id);

  const bk = await db.query(
    `INSERT INTO bookings (type,date,instagram,"fullName",phone,status,delivery_status,products,amount_due,sale_item_ids)
     VALUES ('domicilio','${isoDePrueba()}','@prueba_tarjeta',$1,'8711234567','confirmed','pendiente',
             'lo que la clienta tecleó', 335, '[]'::jsonb) RETURNING id`, [ETIQUETA]);
  bookingId = bk.rows[0].id;
  ok("clienta con una compra liquidada (2 renglones) y otra a crédito que debe $400");

  // ── Solo lo liquidado: los 2 renglones de la primera compra ──
  let r = await api("/api/panel/paquetes", {
    method: "POST",
    body: JSON.stringify({ accion: "simular", clientId: clienteId, itemIds: [i1.rows[0].id, i2.rows[0].id], envio: 0 }),
  });
  let d = await r.json();
  if (d.cobro?.debeMercancia === 0) ok("llevándose solo lo liquidado, no hay nada que cobrar de mercancía");
  else fail("cobra de más: " + JSON.stringify(d.cobro));
  if (d.cobro?.compras === 1) ok("y cuenta UNA compra, no dos, aunque sean 2 renglones del mismo ticket");
  else fail(`cuenta ${d.cobro?.compras} compras`);

  // ── Agregando el de crédito: la deuda aparece una sola vez ──
  r = await api("/api/panel/paquetes", {
    method: "POST",
    body: JSON.stringify({ accion: "simular", clientId: clienteId, itemIds: [i1.rows[0].id, i2.rows[0].id, i3.rows[0].id], envio: 120 }),
  });
  d = await r.json();
  if (d.cobro?.debeMercancia === 400) ok("al meter el producto de la compra a crédito, cobra sus $400");
  else fail("no cobra la deuda: " + JSON.stringify(d.cobro));
  if (d.cobro?.envio === 120 && d.cobro?.aCobrar === 520)
    ok("suma el envío aparte: $400 de mercancía + $120 de envío = $520");
  else fail("no suma bien el envío: " + JSON.stringify(d.cobro));

  // ── Armar: la tarjeta queda escrita sola ──
  r = await api("/api/panel/paquetes", {
    method: "POST",
    body: JSON.stringify({
      accion: "armar", bookingId, clientId: clienteId,
      itemIds: [i1.rows[0].id, i2.rows[0].id, i3.rows[0].id], envio: 120,
    }),
  });
  d = await r.json();
  if (!r.ok) fail("no se armó: " + JSON.stringify(d));

  const tarjeta = (await db.query(
    "select products, amount_due, sale_item_ids from bookings where id=$1", [bookingId])).rows[0];

  if (!/lo que la clienta tecleó/.test(tarjeta.products || ""))
    ok("la tarjeta ya no muestra lo que se tecleó a mano");
  else
    fail("sigue el texto viejo: " + tarjeta.products);

  if (/2x ARETES/.test(tarjeta.products) && /1x COLLAR/.test(tarjeta.products))
    ok("se rellenó sola con los productos de verdad y sus cantidades");
  else
    fail("no escribió bien los productos: " + JSON.stringify(tarjeta.products));

  if (Number(tarjeta.amount_due) === 520) ok("y con el monto correcto: $520, no los $335 inventados");
  else fail(`el monto quedó en $${tarjeta.amount_due}`);

  if ((tarjeta.sale_item_ids || []).length === 3) ok("con los 3 productos ligados");
  else fail("no ligó los productos: " + JSON.stringify(tarjeta.sale_item_ids));
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
    for (const p of [prodA, prodB]) {
      if (!p) continue;
      await db.query("DELETE FROM sale_items WHERE product_id=$1", [p]);
      await db.query("DELETE FROM products WHERE id=$1", [p]);
    }
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await db.end();
}
