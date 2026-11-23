import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";

// Una clienta con un solo producto guardado, y ese producto YA ESTÁ EN UN PAQUETE
// ARMADO esperando a que se lo entreguen. Le vendes una cosa más.
//
// El sistema le sugería quemarse una caja entera "porque tiene cosas en estante",
// cuando no tenía ninguna: lo empacado contaba como guardado. Y peor, al aceptar la
// sugerencia arrastraba la venta de lo YA EMPACADO a la caja nueva, moviéndole el
// lugar a mercancía que ya ni estaba ahí.
//
// Lo empacado salió de su caja y está por salir de la bodega: no es algo con lo que
// haya que juntar nada.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_NO_CUENTA";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const token = tokenDePrueba("admin", "Antonio");
let clienteId, productoId, bookingId, caja;
const ventas = [];

const proponer = async (cuantos) => {
  const r = await fetch(`${BASE}/api/panel/ubicacion?clientId=${clienteId}&productos=${cuantos}`,
    { headers: { "x-panel-token": token } });
  if (!r.ok) throw new Error("la propuesta respondió " + r.status);
  return r.json();
};

async function ventaConProducto(ubicacion, cajaN) {
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja)
     VALUES ($1,100,100,0,'paid','efectivo',now(),$2,$3) RETURNING id`, [clienteId, ubicacion, cajaN]);
  ventas.push(v.rows[0].id);
  const i = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,100,'pending') RETURNING id`, [v.rows[0].id, productoId]);
  return { ventaId: v.rows[0].id, itemId: i.rows[0].id };
}

try {
  await db.connect();
  const libre = await db.query(`
    with o as (
      select (regexp_matches(coalesce(box_1,'')||','||coalesce(box_2,''),'\\d+','g'))[1]::int n from clients
      union select caja::int from sales where ubicacion='caja' and caja is not null)
    select n from generate_series(1,120) n where n not in (select n from o where n is not null) order by n desc limit 1`);
  caja = libre.rows[0].n;

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,9,40) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,'@prueba_no_cuenta','8710006666') RETURNING id`, [ETIQUETA]);
  clienteId = c.rows[0].id;

  // Su único producto, guardado en una caja y luego empacado
  const uno = await ventaConProducto("caja", caja);
  const b = await db.query(
    `INSERT INTO bookings (type,date,instagram,"fullName",phone,status,delivery_status,products,sale_item_ids)
     VALUES ('bodega',$1,'@prueba_no_cuenta',$2,'8710006666','confirmed','pendiente','x','[]'::jsonb) RETURNING id`,
    [isoDePrueba(), ETIQUETA]);
  bookingId = b.rows[0].id;
  await db.query(`update sale_items set paquete_booking_id=$1 where id=$2`, [bookingId, uno.itemId]);
  ok(`su único producto está en un paquete armado, salido de la caja ${caja}`);

  // ── Le vendes UN producto más ──
  const d = await proponer(1);

  if (d.tipo === "estante")
    ok("le sugiere el estante, que es lo correcto para un solo producto");
  else
    fail(`le sugiere ${d.tipo}${d.caja ? " " + d.caja : ""}: "${d.motivo}"`);

  if (!/estante/i.test(d.motivo || "") || d.tipo === "estante")
    ok("y ya no dice 'tiene cosas en estante' cuando no tiene ninguna");
  else
    fail("sigue diciendo: " + d.motivo);

  if (!(d.aMover || []).includes(uno.ventaId))
    ok("y NO arrastra la venta de lo ya empacado: esa mercancía ya salió de su caja");
  else
    fail("quiere mover lo que ya está en un paquete");

  if ((d.guardado || []).some((g) => g.ubicacion === "paquete"))
    ok("aunque la pantalla sí lo sigue enseñando: saber que tiene un paquete armado sirve");
  else
    fail("dejó de enseñar el paquete armado en la ficha");

  // ── Con varios productos sí vale una caja ──
  const varios = await proponer(3);
  if (varios.tipo === "caja") ok("con 3 productos sí le propone caja, como siempre");
  else fail("con 3 productos propuso " + varios.tipo);

  // ── Y lo que SÍ está suelto en estante sigue contando ──
  const suelto = await ventaConProducto("estante", null);
  const conEstante = await proponer(1);
  if (conEstante.tipo === "caja" && (conEstante.aMover || []).includes(suelto.ventaId))
    ok("si de verdad tiene algo en estante, sí propone juntarlo en una caja");
  else
    fail("dejó de juntar lo del estante: " + JSON.stringify({ tipo: conEstante.tipo, aMover: conEstante.aMover }));

  if (!(conEstante.aMover || []).includes(uno.ventaId))
    ok("y aun así no se lleva lo empacado");
  else
    fail("arrastró lo empacado junto con lo del estante");

  // ── Y si ya tiene una caja, se reutiliza sin tocar el paquete ──
  await db.query(`update sales set ubicacion='caja', caja=$2 where id=$1`, [suelto.ventaId, caja]);
  const conCaja = await proponer(1);
  if (conCaja.tipo === "juntar" && Number(conCaja.caja) === caja)
    ok(`teniendo la caja ${caja} se reutiliza, no se le abre otra`);
  else
    fail("no reutilizó su caja: " + JSON.stringify({ tipo: conCaja.tipo, caja: conCaja.caja }));
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
    if (productoId) {
      await db.query("DELETE FROM sale_items WHERE product_id=$1", [productoId]);
      await db.query("DELETE FROM products WHERE id=$1", [productoId]);
    }
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await db.end();
}
