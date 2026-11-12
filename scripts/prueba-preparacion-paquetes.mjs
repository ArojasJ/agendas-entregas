import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";

// PREPARACIÓN DE PAQUETES.
//
// Dos problemas viejos en uno: las entregas casi nunca traían ligados los productos
// (307 de 310), así que marcarlas entregadas no movía nada; y la caja se liberaba
// hasta la entrega, cuando físicamente queda libre desde que se arma el paquete.
// Por eso había 12 cajas vacías que el sistema creía ocupadas.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_PAQUETE";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const api = (url, opts, quien = "Gaby") =>
  fetch(`${BASE}${url}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("worker", quien), ...(opts?.headers || {}) },
  });

let clienteId, productoId, bookingId;
const ventas = [];
let cajaA, cajaB;

async function ventaEnCaja(caja, nProductos, { total = 500, enganche = 500 } = {}) {
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja)
     VALUES ($1,$2,$3,0,$4,'efectivo',now(),'caja',$5) RETURNING id`,
    [clienteId, total, enganche, enganche >= total ? "paid" : "credit", caja]);
  const ids = [];
  for (let i = 0; i < nProductos; i++) {
    const r = await db.query(
      `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
       VALUES ($1,$2,1,100,'pending') RETURNING id`, [v.rows[0].id, productoId]);
    ids.push(r.rows[0].id);
  }
  ventas.push(v.rows[0].id);
  return { saleId: v.rows[0].id, itemIds: ids };
}

const cajaOcupada = async (n) => (await db.query(`
  select exists (
    select 1 from sales s
    where s.ubicacion='caja' and s.caja::int=$1
      and s.status not in ('cancelled','pending_payment')
      and exists (select 1 from sale_items i
                  where i.sale_id=s.id and i.delivery_status<>'delivered'
                    and i.paquete_booking_id is null)) ocupada`, [n])).rows[0].ocupada;

const libresSegunElSistema = async () => {
  const r = await api("/api/panel/paquetes?fecha=1900-01-01", {});
  void r;
  return null;
};

try {
  await db.connect();

  // Dos cajas libres de verdad para la prueba
  const libres = await db.query(`
    with o as (
      select (regexp_matches(coalesce(box_1,'')||','||coalesce(box_2,''),'\\d+','g'))[1]::int n from clients
      union select caja::int from sales where ubicacion='caja' and caja is not null)
    select n from generate_series(1,120) n where n not in (select n from o where n is not null) order by n desc limit 2`);
  cajaA = libres.rows[0].n; cajaB = libres.rows[1].n;

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,99,40) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone,box_1) VALUES ($1,$2,'8711234567',$3) RETURNING id`,
    [ETIQUETA, "@prueba_paquete", `${cajaA}, ${cajaB}`]);
  clienteId = c.rows[0].id;

  // Caja A: 2 productos liquidados. Caja B: 1 producto de una compra que aún debe.
  const enA = await ventaEnCaja(cajaA, 2);
  const enB = await ventaEnCaja(cajaB, 1, { total: 500, enganche: 100 });

  // La entrega: agendada SIN productos ligados, como las 9 de mañana.
  const b = await db.query(
    `INSERT INTO bookings (type,date,instagram,"fullName",phone,status,delivery_status,products,sale_item_ids)
     VALUES ('domicilio','${isoDePrueba()}','@prueba_paquete',$1,'8711234567','confirmed','pendiente',
             '1x lo que sea','[]'::jsonb) RETURNING id`, [ETIQUETA]);
  bookingId = b.rows[0].id;
  ok(`clienta con la caja ${cajaA} (2 productos) y la ${cajaB} (1 producto), y una entrega sin ligar`);

  if (await cajaOcupada(cajaA) && await cajaOcupada(cajaB)) ok("las dos cajas arrancan ocupadas");
  else fail("las cajas no arrancan ocupadas");

  // ── El sistema reconoce a quién pertenece la entrega ──
  let r = await api(`/api/panel/paquetes?bookingId=${bookingId}`, {});
  let d = await r.json();
  if (!r.ok) throw new Error("no se pudo abrir el paquete: " + JSON.stringify(d));

  const sugerida = (d.candidatas || [])[0];
  if (sugerida?.id === clienteId) ok("propone sola a la clienta por su usuario de Instagram");
  else fail("no propone a la clienta: " + JSON.stringify((d.candidatas || []).map((x) => x.name)));
  if (sugerida?.seguro) ok("y la marca como coincidencia segura, no como parecido");
  else fail("no distingue una coincidencia exacta de un parecido");
  if (sugerida?.pendientes === 3) ok("dice cuántos productos la esperan: 3");
  else fail(`dice ${sugerida?.pendientes} productos en vez de 3`);

  // ── Qué productos hay y dónde está cada uno ──
  r = await api(`/api/panel/paquetes?clientId=${clienteId}`, {});
  d = await r.json();
  const prods = d.productos || [];
  if (prods.length === 3) ok("lista los 3 productos que espera");
  else fail(`lista ${prods.length} productos`);

  const enCajaA = prods.filter((x) => Number(x.caja) === cajaA);
  if (enCajaA.length === 2 && enCajaA.every((x) => x.ubicacion === "caja"))
    ok(`y dice dónde está cada uno: 2 en la caja ${cajaA}`);
  else fail("no dice bien dónde está cada producto");

  const elDeB = prods.find((x) => Number(x.caja) === cajaB);
  if (elDeB && elDeB.deLaCompra.debe === 400 && !elDeB.deLaCompra.liquidada)
    ok("marca el que viene de una compra con $400 pendientes, para no entregar lo que no está pagado");
  else fail("no marca lo que todavía se debe: " + JSON.stringify(elDeB?.deLaCompra));

  // ── Simular: llevarse solo lo liquidado (los 2 de la caja A) ──
  r = await api("/api/panel/paquetes", {
    method: "POST",
    body: JSON.stringify({ accion: "simular", clientId: clienteId, itemIds: enA.itemIds }),
  });
  d = await r.json();
  if (d.seLiberan?.includes(cajaA)) ok(`avisa que se libera la caja ${cajaA}`);
  else fail(`no avisa que se libera la ${cajaA}: ${JSON.stringify(d.seLiberan)}`);
  if (d.cajasConRestos?.includes(cajaB) && !d.hayQueJuntar)
    ok(`y que le queda 1 producto en la caja ${cajaB}, que no se libera`);
  else fail("no avisa de lo que queda: " + JSON.stringify(d));

  // ── Armar el paquete ──
  r = await api("/api/panel/paquetes", {
    method: "POST",
    body: JSON.stringify({ accion: "armar", bookingId, clientId: clienteId, itemIds: enA.itemIds }),
  }, "Gaby");
  d = await r.json();
  if (r.ok && d.empacados === 2) ok("arma el paquete con los 2 productos");
  else fail("no se armó: " + JSON.stringify(d));

  // ── LO IMPORTANTE: la caja se libera al armar, no al entregar ──
  if (!(await cajaOcupada(cajaA))) ok(`la caja ${cajaA} queda LIBRE al armar el paquete, sin esperar a la entrega`);
  else fail(`la caja ${cajaA} sigue ocupada después de armar`);
  if (await cajaOcupada(cajaB)) ok(`y la ${cajaB} sigue ocupada, porque ahí sí quedó mercancía`);
  else fail(`la caja ${cajaB} se liberó de más`);

  const items = await db.query(
    `select id, delivery_status, paquete_booking_id from sale_items where id = ANY($1::uuid[])`, [enA.itemIds]);
  if (items.rows.every((i) => i.paquete_booking_id === bookingId && i.delivery_status === "pending"))
    ok("los productos quedan EN EL PAQUETE, no entregados: siguen pendientes hasta que salga");
  else fail("el estado de los productos no es el correcto: " + JSON.stringify(items.rows));

  // ── Y la entrega queda ligada: esto es lo que faltaba ──
  const bk = await db.query(
    `select sale_item_ids, preparado_at, preparado_por_name from bookings where id=$1`, [bookingId]);
  const ligados = bk.rows[0].sale_item_ids || [];
  if (ligados.length === 2) ok("la entrega queda ligada a los 2 productos, que es lo que nunca pasaba");
  else fail("la entrega no quedó ligada: " + JSON.stringify(ligados));
  if (bk.rows[0].preparado_por_name === "Gaby" && bk.rows[0].preparado_at)
    ok("y queda registrado que la armó Gaby, con su hora");
  else fail("no registró quién armó el paquete");

  // ── La ficha ya no reclama la caja liberada ──
  const ficha = await db.query(`select box_1, box_2 from clients where id=$1`, [clienteId]);
  const enFicha = String(ficha.rows[0].box_1 || "").match(/\d+/g)?.map(Number) || [];
  if (!enFicha.includes(cajaA) && enFicha.includes(cajaB))
    ok(`su ficha queda solo con la caja ${cajaB}: la ${cajaA} se soltó sola`);
  else
    fail(`la ficha quedó con ${JSON.stringify(ficha.rows[0])}`);

  // ── Marcar la entrega ahora sí alcanza a los productos ──
  r = await api("/api/bookings/update-delivery", {
    method: "PATCH",
    body: JSON.stringify({ id: bookingId, deliveryStatus: "entregado", paymentMethod: "efectivo", products: "1x lo que sea", amountDue: 0 }),
  }, "Dennis");
  d = await r.json();
  const trasEntrega = await db.query(
    `select delivery_status, delivered_by_name from sale_items where id = ANY($1::uuid[])`, [enA.itemIds]);
  if (trasEntrega.rows.every((i) => i.delivery_status === "delivered"))
    ok("al marcar la entrega, los productos SÍ cambian a entregado (antes no pasaba nada)");
  else
    fail("los productos siguen pendientes tras la entrega: " + JSON.stringify(trasEntrega.rows));
  if (trasEntrega.rows.every((i) => i.delivered_by_name === "Dennis"))
    ok("y quedan firmados por Dennis, que fue quien entregó");
  else
    fail("no quedaron firmados: " + JSON.stringify(trasEntrega.rows));

  void libresSegunElSistema; void enB;
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (bookingId) await db.query("DELETE FROM bookings WHERE id=$1", [bookingId]);
    if (ventas.length) {
      await db.query("DELETE FROM payments WHERE sale_id = ANY($1::uuid[])", [ventas]);
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
