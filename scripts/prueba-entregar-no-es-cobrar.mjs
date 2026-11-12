import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// Cuando salía el último producto de una venta a crédito, el sistema la daba por
// pagada y además subía el enganche al total: la clienta se llevaba la mercancía y su
// deuda desaparecía sin que nadie se enterara. A Michelle Ac le habría borrado $590.
//
// Entregar no es cobrar. Ahora la venta se cierra sola SOLO si el dinero ya estaba
// registrado; si sigue debiendo, se queda a crédito y se avisa para preguntarlo.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_COBRAR";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const token = tokenDePrueba("admin", "Prueba Admin");
const api = (url, opts) =>
  fetch(`${BASE}${url}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-panel-token": token, ...(opts?.headers || {}) },
  });

let clienteId, productoId;
const creadas = [];

// Una venta a crédito con su enganche y sus productos sin entregar.
async function ventaACredito({ total, enganche }) {
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,due_date)
     VALUES ($1,$2,$3,0,'credit','efectivo',now(),current_date + 15) RETURNING id`,
    [clienteId, total, enganche]);
  const s = v.rows[0].id;
  const i = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,$3,'pending') RETURNING id`, [s, productoId, total]);
  creadas.push(s);
  return { saleId: s, itemId: i.rows[0].id };
}

const estado = async (saleId) => (await db.query(
  `select s.status, s.total, s.down_payment,
          coalesce((select sum(p.amount) from payments p where p.sale_id=s.id),0) abonos
   from sales s where s.id=$1`, [saleId])).rows[0];

try {
  await db.connect();

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',790,50,400) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8711234567') RETURNING id`,
    [ETIQUETA, "@prueba_cobrar"]);
  clienteId = c.rows[0].id;

  // ── Caso 1: el de Michelle Ac. Se lleva todo y sigue debiendo $590 ──
  const a = await ventaACredito({ total: 790, enganche: 200 });
  let r = await api("/api/panel/chequeo", {
    method: "PATCH",
    body: JSON.stringify({ accion: "entregado", itemIds: [a.itemId], clientId: clienteId }),
  });
  let d = await r.json();
  let e = await estado(a.saleId);

  if (e.status === "credit") ok("se lleva todo debiendo $590 y la venta SIGUE a crédito");
  else fail(`la venta quedó en "${e.status}": se dio por pagada sola`);

  if (Number(e.down_payment) === 200) ok("el enganche se queda en $200, no se infla al total");
  else fail(`el enganche quedó en $${e.down_payment} en vez de $200`);

  if (Number(e.abonos) === 0) ok("y no se inventó ningún abono");
  else fail(`se inventaron $${e.abonos} de abonos`);

  const aviso = (d.porCobrar || [])[0];
  if (aviso && Number(aviso.debe) === 590) ok("avisa que faltan $590 por cobrar, para preguntarlo");
  else fail("no avisa lo que falta por cobrar: " + JSON.stringify(d.porCobrar));
  if (aviso?.cliente === ETIQUETA) ok("y dice de quién es la deuda");
  else fail("el aviso no dice de quién es");

  // ── Caso 2: "sí me pagó" registra dinero de verdad, que sí cuenta en el corte ──
  r = await api("/api/payments", {
    method: "POST",
    body: JSON.stringify({ sale_id: a.saleId, amount: aviso?.debe ?? 590 }),
  });
  if (!r.ok) fail("no se pudo registrar el pago: " + (await r.text()).slice(0, 120));
  e = await estado(a.saleId);
  if (Number(e.abonos) === 590) ok('al contestar "sí me pagó" entran $590 como abono real');
  else fail(`el abono quedó en $${e.abonos}`);
  if (e.status === "paid") ok("y ahí sí la venta queda pagada");
  else fail(`la venta sigue en "${e.status}" después de pagarla`);

  // ── Caso 3: la que ya estaba pagada sí se cierra sola, sin preguntar nada ──
  const b = await ventaACredito({ total: 300, enganche: 300 });
  r = await api("/api/panel/chequeo", {
    method: "PATCH",
    body: JSON.stringify({ accion: "entregado", itemIds: [b.itemId], clientId: clienteId }),
  });
  d = await r.json();
  e = await estado(b.saleId);
  if (e.status === "paid") ok("una venta que ya estaba cubierta sí se cierra sola al entregarla");
  else fail(`la que ya estaba pagada quedó en "${e.status}"`);
  if ((d.porCobrar || []).length === 0) ok("y no molesta preguntando nada");
  else fail("pregunta por una venta que ya estaba pagada");

  // ── Caso 4: entregar solo una parte no cierra ni pregunta ──
  const cDos = await ventaACredito({ total: 500, enganche: 100 });
  const extra = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,250,'pending') RETURNING id`, [cDos.saleId, productoId]);
  r = await api("/api/panel/chequeo", {
    method: "PATCH",
    body: JSON.stringify({ accion: "entregado", itemIds: [cDos.itemId], clientId: clienteId }),
  });
  d = await r.json();
  e = await estado(cDos.saleId);
  if (e.status === "credit" && (d.porCobrar || []).length === 0)
    ok("si todavía le queda mercancía guardada, ni cierra ni pregunta");
  else
    fail(`con mercancía pendiente hizo algo: status "${e.status}", aviso ${JSON.stringify(d.porCobrar)}`);
  void extra;
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (creadas.length) {
      await db.query("DELETE FROM payments WHERE sale_id = ANY($1::uuid[])", [creadas]);
      await db.query("DELETE FROM sale_items WHERE sale_id = ANY($1::uuid[])", [creadas]);
      await db.query("DELETE FROM sales WHERE id = ANY($1::uuid[])", [creadas]);
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
