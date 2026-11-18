import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";

// El caso de @magda.favela. Se le armó un paquete el 12-nov para una entrega de bodega
// que al final no salió. Después se le agendó otra entrega, y al intentar armarla el
// sistema tronaba: sus productos seguían apartados por el paquete muerto, así que no
// quedaba nada que empacar. Decía "ninguno de esos productos se puede empacar", sin
// explicar por qué, y la entrega se quedaba para siempre en la lista de por armar.
//
// Ahora se pueden mover. Salvo que el paquete viejo YA SE ENTREGÓ: eso sería decir que
// algo que la clienta ya tiene en su casa va a salir otra vez.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_MUERTO";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let clienteId, productoId, ventaId, viejoId, nuevoId, salidoId;
let itemA, itemB;

const armar = (bookingId, itemIds) => fetch(`${BASE}/api/panel/paquetes`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("worker", "Gaby") },
  body: JSON.stringify({ accion: "armar", bookingId, clientId: clienteId, itemIds, envio: 0 }),
});

const nuevaEntrega = async (tipo, estado) => (await db.query(
  `INSERT INTO bookings (type,date,instagram,"fullName",phone,status,delivery_status,products,sale_item_ids)
   VALUES ($1,'${isoDePrueba()}','@prueba_muerto',$2,'8710005555','confirmed',$3,'x','[]'::jsonb) RETURNING id`,
  [tipo, ETIQUETA, estado])).rows[0].id;

try {
  await db.connect();
  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,9,40) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,'@prueba_muerto','8710005555') RETURNING id`, [ETIQUETA]);
  clienteId = c.rows[0].id;
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja)
     VALUES ($1,200,200,0,'paid','efectivo',now(),'caja',1) RETURNING id`, [clienteId]);
  ventaId = v.rows[0].id;
  const ids = [];
  for (let i = 0; i < 2; i++) {
    const r = await db.query(
      `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
       VALUES ($1,$2,1,100,'pending') RETURNING id`, [ventaId, productoId]);
    ids.push(r.rows[0].id);
  }
  [itemA, itemB] = ids;

  // El paquete muerto: armado, pero su entrega no salió
  viejoId = await nuevaEntrega("bodega", "no_entregado");
  const r0 = await armar(viejoId, ids);
  if (!r0.ok) throw new Error("no se pudo armar el paquete viejo: " + (await r0.text()).slice(0, 200));
  ok("paquete armado para una entrega de bodega que después no salió");

  // Hoy se le agenda otra entrega
  nuevoId = await nuevaEntrega("domicilio", "pendiente");
  const r1 = await armar(nuevoId, ids);
  const d1 = await r1.json();
  if (!r1.ok) { fail("sigue sin poder armarse: " + d1.message); throw new Error("se detiene aquí"); }
  ok("la entrega nueva SÍ se puede armar: antes tronaba sin decir por qué");

  if (d1.movidos === 2) ok("y avisa que movió los 2 productos del paquete que no salió");
  else fail("no dice cuántos movió: " + JSON.stringify(d1));

  const donde = (await db.query(
    `select paquete_booking_id from sale_items where id = ANY($1::uuid[])`, [ids])).rows;
  if (donde.every((x) => x.paquete_booking_id === nuevoId))
    ok("los productos quedan en el paquete nuevo");
  else
    fail("no se movieron: " + JSON.stringify(donde));

  // El paquete viejo no puede quedarse mintiendo
  const viejo = (await db.query(
    `select sale_item_ids, preparado_at from bookings where id=$1`, [viejoId])).rows[0];
  if ((viejo.sale_item_ids || []).length === 0)
    ok("y el paquete viejo deja de decir que lleva unos productos que ya no tiene");
  else
    fail("la tarjeta vieja sigue mintiendo: " + JSON.stringify(viejo.sale_item_ids));
  if (viejo.preparado_at === null)
    ok("y al quedarse vacío deja de contar como armado, para no salir listo con nada adentro");
  else
    fail("sigue marcado como armado estando vacío");

  // ── Lo que NO se permite: robarle a un paquete que ya se entregó ──
  salidoId = await nuevaEntrega("domicilio", "entregado");
  await db.query(`update sale_items set paquete_booking_id=$1 where id=$2`, [salidoId, itemA]);
  const r2 = await armar(nuevoId, [itemA]);
  const d2 = await r2.json();
  if (!r2.ok && /ya salieron/i.test(d2.message || ""))
    ok("pero no deja sacar algo de una entrega YA ENTREGADA: eso ya está en su casa");
  else
    fail("dejó re-empacar mercancía ya entregada: " + JSON.stringify(d2));
} catch (e) {
  if (e.message !== "se detiene aquí") fail(e.message);
} finally {
  try {
    for (const b of [viejoId, nuevoId, salidoId]) {
      if (b) {
        await db.query(`update sale_items set paquete_booking_id=null where paquete_booking_id=$1`, [b]);
        await db.query("DELETE FROM bookings WHERE id=$1", [b]);
      }
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
