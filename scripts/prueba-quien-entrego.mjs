import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// Al preguntar cuándo se entregaron los tenis de Adriana Hernandez no hubo respuesta:
// el sistema guardaba que un producto estaba entregado, pero no cuándo ni quién lo
// marcó. Ahora sí. La fecha la pone la base (hay diez lugares que marcan entregado y
// uno se iba a olvidar); el nombre lo pone la aplicación.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_QUIEN";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const api = (url, opts, quien = "Gaby") =>
  fetch(`${BASE}${url}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-panel-token": tokenDePrueba("worker", quien),
      ...(opts?.headers || {}),
    },
  });

let clienteId, productoId;
const ventas = [];

async function venta() {
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at)
     VALUES ($1,300,300,0,'paid','efectivo',now() - interval '20 days') RETURNING id`, [clienteId]);
  const i = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,300,'pending') RETURNING id`, [v.rows[0].id, productoId]);
  ventas.push(v.rows[0].id);
  return { saleId: v.rows[0].id, itemId: i.rows[0].id };
}

const firma = async (itemId) => (await db.query(
  `select delivery_status, delivered_at, delivered_by_name, delivered_by_staff_id
   from sale_items where id=$1`, [itemId])).rows[0];

try {
  await db.connect();

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',300,50,100) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8711234567') RETURNING id`,
    [ETIQUETA, "@prueba_quien"]);
  clienteId = c.rows[0].id;

  // ── Antes de entregar no hay firma ──
  const a = await venta();
  let f = await firma(a.itemId);
  if (!f.delivered_at && !f.delivered_by_name) ok("un producto sin entregar no trae fecha ni nombre");
  else fail("trae firma sin haberse entregado: " + JSON.stringify(f));

  // ── Marcar entregado desde Chequeo, como Gaby ──
  const antes = new Date();
  let r = await api("/api/panel/chequeo", {
    method: "PATCH",
    body: JSON.stringify({ accion: "entregado", itemIds: [a.itemId], clientId: clienteId }),
  }, "Gaby");
  if (!r.ok) fail("no se pudo marcar entregado: " + (await r.text()).slice(0, 150));
  const despues = new Date();

  f = await firma(a.itemId);
  if (f.delivery_status === "delivered") ok("se marca entregado");
  else fail("no quedó entregado");

  if (f.delivered_at) ok(`guarda CUÁNDO: ${new Date(f.delivered_at).toLocaleString("es-MX")}`);
  else fail("no guardó la fecha");

  const t = new Date(f.delivered_at);
  if (t >= new Date(antes.getTime() - 5000) && t <= new Date(despues.getTime() + 5000))
    ok("y la hora es la de verdad, no la de la compra");
  else
    fail(`la hora no corresponde al momento de marcarla: ${t.toISOString()}`);

  if (f.delivered_by_name === "Gaby") ok("guarda QUIÉN: Gaby, la que la marcó");
  else fail(`guardó "${f.delivered_by_name}" en vez de Gaby`);

  // ── Volver a guardar no debe reescribir la firma ──
  const fechaOriginal = f.delivered_at;
  await api("/api/panel/chequeo", {
    method: "PATCH",
    body: JSON.stringify({ accion: "entregado", itemIds: [a.itemId], clientId: clienteId }),
  }, "Dennis");
  f = await firma(a.itemId);
  if (String(f.delivered_at) === String(fechaOriginal) && f.delivered_by_name === "Gaby")
    ok("si alguien más vuelve a marcarla, no le roba el crédito a Gaby ni mueve la hora");
  else
    fail(`la firma cambió a ${f.delivered_by_name} / ${f.delivered_at}`);

  // ── Revertir la entrega borra la firma, porque dejó de ser cierta ──
  await db.query(`update sale_items set delivery_status='pending' where id=$1`, [a.itemId]);
  f = await firma(a.itemId);
  if (!f.delivered_at && !f.delivered_by_name && !f.delivered_by_staff_id)
    ok("al revertir la entrega se borra la firma: ya no es cierta");
  else
    fail("quedó una firma vieja colgando: " + JSON.stringify(f));

  // ── Y al volver a entregarla se firma de nuevo ──
  await api("/api/panel/chequeo", {
    method: "PATCH",
    body: JSON.stringify({ accion: "entregado", itemIds: [a.itemId], clientId: clienteId }),
  }, "Dennis");
  f = await firma(a.itemId);
  if (f.delivered_by_name === "Dennis" && f.delivered_at) ok("y al entregarla de nuevo se firma otra vez, ahora Dennis");
  else fail("no se volvió a firmar: " + JSON.stringify(f));

  // ── El detalle de venta lo entrega para pintarlo ──
  r = await api(`/api/sales/${a.saleId}`, {}, "Gaby");
  const d = await r.json();
  const item = (d.sale?.sale_items || [])[0];
  if (item?.delivered_at && item?.delivered_by_name === "Dennis")
    ok("el detalle de venta recibe la fecha y el nombre para mostrarlos");
  else
    fail("el detalle de venta no trae la firma: " + JSON.stringify(item));

  // ── Lo viejo se queda sin firma, y eso está bien ──
  const vieja = await venta();
  await db.query(
    `update sale_items set delivery_status='delivered' where id=$1`, [vieja.itemId]);
  const fv = await firma(vieja.itemId);
  if (fv.delivered_at && !fv.delivered_by_name)
    ok("marcado por fuera de la aplicación: la base igual guarda la fecha, el nombre queda vacío");
  else
    fail("la base no guardó la fecha de un cambio hecho por fuera: " + JSON.stringify(fv));
} catch (e) {
  fail(e.message);
} finally {
  try {
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
