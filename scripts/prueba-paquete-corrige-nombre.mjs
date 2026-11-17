import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";

// Una clienta agenda y escribe mal su usuario. En Preparación se le liga su ficha
// buena, pero la entrega se quedaba con lo que ella tecleó: en el papelito del paquete
// iba el nombre correcto y en la ruta del repartidor otro, así que tenía que adivinar.
//
// Y no era solo el nombre: la ruta busca el saldo a favor por el usuario. Con el
// usuario mal escrito no lo encuentra y le cobra de más.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_NOMBRE";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let clienteId, productoId, ventaId, bookingId;

const entrega = async () => (await db.query(
  `select instagram, "fullName", phone, products, amount_due, sale_item_ids
   from bookings where id = $1`, [bookingId])).rows[0];

try {
  await db.connect();

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',300,5,120) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;

  // Su ficha, con el usuario BIEN escrito y saldo a favor
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone,saldo_favor)
     VALUES ('Marisol Jauregui','@marisol.jauregui','8716665544',150) RETURNING id`);
  clienteId = c.rows[0].id;

  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja)
     VALUES ($1,300,300,0,'paid','efectivo',now(),'estante',null) RETURNING id`, [clienteId]);
  ventaId = v.rows[0].id;
  const item = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,300,'pending') RETURNING id`, [ventaId, productoId]);

  // La entrega, como la agendó ella: usuario mal escrito y nombre a medias
  const b = await db.query(
    `INSERT INTO bookings (type,date,instagram,"fullName",phone,status,delivery_status,products,sale_item_ids)
     VALUES ('domicilio','${isoDePrueba()}','@marisoljauregi','Mari','8716665544','confirmed','pendiente',
             'lo que ella escribio','[]'::jsonb) RETURNING id`);
  bookingId = b.rows[0].id;
  ok("entrega agendada con el usuario mal escrito: @marisoljauregi en vez de @marisol.jauregui");

  // Armar el paquete ligándola a su ficha buena, como lo hace la pantalla
  const r = await fetch(`${BASE}/api/panel/paquetes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("worker", "Gaby") },
    body: JSON.stringify({
      accion: "armar",
      bookingId,
      clientId: clienteId,
      itemIds: [item.rows[0].id],
      envio: 45,
    }),
  });
  if (!r.ok) throw new Error("no se pudo armar: " + (await r.text()).slice(0, 200));

  const e = await entrega();

  if (e.instagram === "@marisol.jauregui")
    ok("al armar el paquete, la entrega adopta el usuario bueno de la ficha");
  else
    fail("la entrega conservó el usuario mal escrito: " + e.instagram);

  if (e.fullName === "Marisol Jauregui")
    ok("y el nombre completo, el mismo que va en el papelito del paquete");
  else
    fail("el nombre no se corrigió: " + e.fullName);

  // El saldo a favor: la ruta lo busca por el usuario sin @ y en minúsculas
  const ig = (e.instagram || "").replace(/^@/, "").toLowerCase();
  const { rows: saldo } = await db.query(
    `select saldo_favor from clients where lower(replace(instagram,'@','')) = $1`, [ig]);
  if (saldo.length === 1 && Number(saldo[0].saldo_favor) === 150)
    ok("y con el usuario bueno la ruta sí encuentra sus $150 de saldo a favor");
  else
    fail("la ruta no encontraría su saldo: " + JSON.stringify(saldo));

  if (e.phone === "8716665544") ok("el teléfono de la entrega no se toca: es el que ella dio para este envío");
  else fail("le cambió el teléfono: " + e.phone);

  if ((e.sale_item_ids || []).length === 1 && Number(e.amount_due) > 0)
    ok("y el paquete quedó armado igual que siempre, con su producto y su cobro");
  else
    fail("se rompió el armado: " + JSON.stringify({ ids: e.sale_item_ids, cobro: e.amount_due }));

  // Una ficha sin usuario no debe borrar el que traía la entrega
  await db.query(`update clients set instagram = null where id = $1`, [clienteId]);
  await db.query(`update bookings set instagram = '@algo.que.traia' where id = $1`, [bookingId]);
  const r2 = await fetch(`${BASE}/api/panel/paquetes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("worker", "Gaby") },
    body: JSON.stringify({ accion: "armar", bookingId, clientId: clienteId, itemIds: [item.rows[0].id], envio: 45 }),
  });
  if (!r2.ok) throw new Error("no se pudo rearmar: " + (await r2.text()).slice(0, 200));
  const e2 = await entrega();
  if (e2.instagram === "@algo.que.traia")
    ok("si la ficha no tiene usuario, no le borra el que la entrega ya traía");
  else
    fail("borró el usuario con una ficha vacía: " + e2.instagram);
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (bookingId) {
      await db.query(`update sale_items set paquete_booking_id = null where paquete_booking_id = $1`, [bookingId]);
      await db.query("DELETE FROM bookings WHERE id=$1", [bookingId]);
    }
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
  await db.end();
}
