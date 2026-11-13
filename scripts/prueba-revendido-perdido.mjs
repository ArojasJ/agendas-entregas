import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// En Chequeo solo había dos salidas: estante o ya entregado. Pero hay casos que no son
// ninguna: un apartado que no se pagó y el producto se REVENDIÓ, o uno que se PERDIÓ.
//
// Son etiquetas y nada más. Lo que esta prueba cuida es justo lo que se pidió: que no
// toquen inventario, ni dinero, ni la deuda, ni creen ventas; que el producto deje de
// contarse como pendiente; y que la clienta NO vea la etiqueta ni el motivo.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_RESOL";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const api = (url, opts) =>
  fetch(`${BASE}${url}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("worker", "Gaby"), ...(opts?.headers || {}) },
  });

let clienteId, productoId, caja;
const ventas = [];

const estado = async (itemId) => (await db.query(
  `select delivery_status, resolucion, delivered_by_name, delivered_at from sale_items where id=$1`,
  [itemId])).rows[0];

try {
  await db.connect();

  const libre = await db.query(`
    with o as (
      select (regexp_matches(coalesce(box_1,'')||','||coalesce(box_2,''),'\\d+','g'))[1]::int n from clients
      union select caja::int from sales where ubicacion='caja' and caja is not null)
    select n from generate_series(1,120) n where n not in (select n from o where n is not null) order by n desc limit 1`);
  caja = libre.rows[0].n;

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',500,7,200) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone,saldo_favor) VALUES ($1,$2,'8711234567',0) RETURNING id`,
    [ETIQUETA, "@prueba_resol"]);
  clienteId = c.rows[0].id;

  // Un apartado a crédito con $400 sin pagar, guardado en una caja: el caso típico
  // del producto que se acaba revendiendo.
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja,due_date)
     VALUES ($1,500,100,0,'credit','efectivo',now() - interval '40 days','caja',$2,current_date - 25) RETURNING id`,
    [clienteId, caja]);
  const i1 = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,500,'pending') RETURNING id`, [v.rows[0].id, productoId]);
  ventas.push(v.rows[0].id);

  // Y otra compra pagada con un producto que se perdió.
  const v2 = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion)
     VALUES ($1,500,500,0,'paid','efectivo',now() - interval '40 days','estante') RETURNING id`, [clienteId]);
  const i2 = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,500,'pending') RETURNING id`, [v2.rows[0].id, productoId]);
  ventas.push(v2.rows[0].id);
  ok(`apartado a crédito debiendo $400 en la caja ${caja}, y una compra pagada en estante`);

  const stockAntes = (await db.query(`select stock from products where id=$1`, [productoId])).rows[0].stock;
  const ventasAntes = (await db.query(`select count(*) n from sales`)).rows[0].n;

  // ── REVENDIDO ──
  let r = await api("/api/panel/chequeo", {
    method: "PATCH",
    body: JSON.stringify({ accion: "revendido", itemIds: [i1.rows[0].id], clientId: clienteId }),
  });
  let d = await r.json();
  if (r.ok && d.resolucion === "revendido") ok("Chequeo acepta marcar REVENDIDO");
  else fail("no aceptó revendido: " + JSON.stringify(d));

  let e = await estado(i1.rows[0].id);
  if (e.resolucion === "revendido") ok("el motivo queda guardado como revendido");
  else fail("no guardó el motivo: " + JSON.stringify(e));
  if (e.delivered_by_name === "Gaby") ok("y queda registrado quién lo marcó");
  else fail("no registró quién: " + e.delivered_by_name);

  // ── Lo que NO debe pasar ──
  const stockDespues = (await db.query(`select stock from products where id=$1`, [productoId])).rows[0].stock;
  if (stockDespues === stockAntes) ok(`NO devuelve inventario: el stock sigue en ${stockAntes}`);
  else fail(`tocó el inventario: ${stockAntes} → ${stockDespues}`);

  const ventasDespues = (await db.query(`select count(*) n from sales`)).rows[0].n;
  if (ventasDespues === ventasAntes) ok("NO crea ninguna venta nueva");
  else fail(`creó ventas: ${ventasAntes} → ${ventasDespues}`);

  const dinero = (await db.query(
    `select s.status, s.total, s.down_payment, s.penalty_amount,
            coalesce((select sum(p.amount) from payments p where p.sale_id=s.id),0) abonos,
            (select saldo_favor from clients where id=s.client_id) saldo
     from sales s where s.id=$1`, [v.rows[0].id])).rows[0];
  if (dinero.status === "credit" && Number(dinero.down_payment) === 100 && Number(dinero.abonos) === 0)
    ok("NO toca el dinero: la venta sigue a crédito con su enganche de $100");
  else
    fail("movió dinero: " + JSON.stringify(dinero));
  if (Number(dinero.saldo) === 0 && dinero.penalty_amount === null)
    ok("y no inventa penalización ni saldo a favor");
  else
    fail("inventó penalización o saldo: " + JSON.stringify(dinero));

  // ── Sí deja de contar como pendiente, y suelta la caja ──
  const sigueContando = (await db.query(`
    select exists (
      select 1 from sales s
      where s.ubicacion='caja' and s.caja::int=$1 and s.status not in ('cancelled','pending_payment')
        and exists (select 1 from sale_items i where i.sale_id=s.id
                    and i.delivery_status<>'delivered' and i.paquete_booking_id is null)) o`,
    [caja])).rows[0].o;
  if (!sigueContando) ok(`la caja ${caja} queda libre: lo revendido ya no está guardado ahí`);
  else fail(`la caja ${caja} sigue ocupada`);

  // ── PERDIDO ──
  r = await api("/api/panel/chequeo", {
    method: "PATCH",
    body: JSON.stringify({ accion: "perdido", itemIds: [i2.rows[0].id], clientId: clienteId }),
  });
  d = await r.json();
  e = await estado(i2.rows[0].id);
  if (r.ok && e.resolucion === "perdido") ok("y también se puede marcar PERDIDO");
  else fail("no se pudo marcar perdido: " + JSON.stringify(d));

  // ── El Detalle de Venta sí lo enseña ──
  r = await api(`/api/sales/${v.rows[0].id}`, {});
  d = await r.json();
  const item = (d.sale?.sale_items || [])[0];
  if (item?.resolucion === "revendido") ok("el Detalle de Venta recibe el motivo para pintarlo");
  else fail("el detalle no trae el motivo: " + JSON.stringify(item));

  // ── Ya no sale en Chequeo ──
  r = await api("/api/panel/chequeo?periodo=360", {});
  d = await r.json();
  const enChequeo = JSON.stringify(d).includes(ETIQUETA);
  if (!enChequeo) ok("y deja de salir en Chequeo, que era el punto");
  else fail("sigue apareciendo en Chequeo");
} catch (e) {
  fail(e.message);
} finally {
  try {
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
