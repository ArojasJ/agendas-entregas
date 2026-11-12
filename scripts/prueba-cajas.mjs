import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const USER = process.env.ADMIN_USER;
const PASS = process.env.ADMIN_PASS;

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const ETIQUETA = "PRUEBA_CAJAS";
const IG = "pruebacajas";
let clienteId, productoId, token;

const cajasDe = async () =>
  (await c.query("SELECT box_1, box_2 FROM clients WHERE id=$1", [clienteId])).rows[0];

// Crea una venta con N productos y una reserva agendada para ella
async function crearVentaConEntrega({ cantidad, entregar }) {
  const v = await c.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method)
     VALUES ($1,100,100,0,'paid','efectivo') RETURNING id`, [clienteId]);
  const saleId = v.rows[0].id;
  const items = [];
  for (let i = 0; i < cantidad; i++) {
    const si = await c.query(
      `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
       VALUES ($1,$2,1,100,'pending') RETURNING id`, [saleId, productoId]);
    items.push(si.rows[0].id);
  }
  const b = await c.query(
    `INSERT INTO bookings (type,date,instagram,"fullName",phone,address,city,delivery_status,sale_item_ids,amount_due,override)
     VALUES ('domicilio','${isoDePrueba()}',$1,$2,'8711234567','Calle 1','Torreón','pendiente',$3,0,true)
     RETURNING id`, ["@" + IG, ETIQUETA, JSON.stringify(items)]);
  return { saleId, bookingId: b.rows[0].id, items };
}

const marcarEntregada = async (bookingId) =>
  (await fetch(`${BASE}/api/bookings/update-delivery`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": token },
    body: JSON.stringify({ id: bookingId, deliveryStatus: "entregado", paymentMethod: "efectivo" }),
  })).json();

try {
  await c.connect();
  token = tokenDePrueba();

  const p = await c.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,50,40) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const cl = await c.query(
    `INSERT INTO clients (name,instagram,phone,box_1) VALUES ($1,$2,'8711234567','5') RETURNING id`,
    [ETIQUETA, "@" + IG]);
  clienteId = cl.rows[0].id;

  // El caso de Antonio: cartera y perfume en la caja 5, gorra aparte
  const caja = await crearVentaConEntrega({ cantidad: 2 });   // lo de la caja 5
  const gorra = await crearVentaConEntrega({ cantidad: 1 });  // la gorra

  if ((await cajasDe()).box_1 === "5") ok("arranca con la caja 5 asignada");
  else fail("no quedó la caja 5 asignada");

  // Entrega SOLO la gorra
  await marcarEntregada(gorra.bookingId);
  const tras = await cajasDe();
  if (tras.box_1 === "5") ok("tras entregar la gorra, CONSERVA la caja 5");
  else fail(`tras entregar la gorra la caja quedó en "${tras.box_1}" — se perdió el rastro`);

  // Ahora sí entrega lo de la caja
  await marcarEntregada(caja.bookingId);
  const final = await cajasDe();
  if (final.box_1 === null) ok("al entregar lo último, libera la caja 5");
  else fail(`la caja quedó en "${final.box_1}" aunque ya no hay nada pendiente`);

  // Y que el lugar de la venta también se limpie
  const ub = await c.query(
    "SELECT COUNT(*) n FROM sales WHERE client_id=$1 AND ubicacion IS NOT NULL", [clienteId]);
  if (Number(ub.rows[0].n) === 0) ok("tampoco queda ubicación colgada en las ventas");
  else fail(`quedaron ${ub.rows[0].n} ventas con ubicación`);
} catch (e) {
  fail(e.message);
} finally {
  try {
    await c.query(`DELETE FROM bookings WHERE instagram=$1`, ["@" + IG]);
    await c.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id=$1)`, [clienteId]);
    await c.query("DELETE FROM sales WHERE client_id=$1", [clienteId]);
    await c.query("DELETE FROM clients WHERE id=$1", [clienteId]);
    await c.query("DELETE FROM products WHERE id=$1", [productoId]);
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await c.end();
}
