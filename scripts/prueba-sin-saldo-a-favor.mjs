import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// El saldo a favor se quitó. Lo que la clienta pagó de más al cancelarle un apartado
// se le devuelve en efectivo, no se le apunta en el sistema: nunca se usaba —ni una
// sola venta se pagó con saldo— y mientras tanto le prometía un dinero que en la
// práctica se le entregaba a mano.
//
// Lo que NO cambia, y es lo que más importa comprobar: cancelar sigue penalizando el
// 15%, ese dinero se lo sigue quedando el negocio y sigue entrando al corte.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_SIN_SALDO";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let clienteId, productoId, ventaId;

const saldoDe = async () => Number(
  (await db.query(`select coalesce(saldo_favor,0) s from clients where id=$1`, [clienteId])).rows[0].s);

try {
  await db.connect();

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',1000,5,400) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone,saldo_favor) VALUES ($1,'@prueba_sin_saldo','8710001122',0) RETURNING id`, [ETIQUETA]);
  clienteId = c.rows[0].id;

  // El caso que me contaste: producto de $1,000, apartó con $200.
  // El 15% son $150, que se queda el negocio. Le sobran $50.
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,due_date)
     VALUES ($1,1000,200,0,'credit','efectivo',now(),current_date + 15) RETURNING id`, [clienteId]);
  ventaId = v.rows[0].id;
  await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,1000,'pending')`, [ventaId, productoId]);
  ok("apartado de $1,000 con $200 de enganche, sin saldo previo");

  // Cancelar y penalizar
  const r = await fetch(`${BASE}/api/sales/${ventaId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("admin", "Antonio") },
    body: JSON.stringify({ action: "cancel_forfeit" }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error("no se pudo penalizar: " + JSON.stringify(d).slice(0, 200));

  // ── Lo que NO cambia ──
  const venta = (await db.query(
    `select status, penalty_amount, pos_cut_id from sales where id=$1`, [ventaId])).rows[0];
  if (venta.status === "cancelled") ok("la venta queda cancelada, como siempre");
  else fail("no se canceló: " + venta.status);

  if (Number(venta.penalty_amount) === 150)
    ok("se le penaliza el 15%: $150 de los $1,000, que se queda el negocio");
  else
    fail("la penalización cambió: $" + venta.penalty_amount);

  if (venta.pos_cut_id === null)
    ok("y queda fuera de corte, lista para entrar al próximo como siempre");
  else
    fail("entró a un corte sola");

  const stock = (await db.query(`select stock from products where id=$1`, [productoId])).rows[0].stock;
  if (stock === 6) ok("el producto vuelve al inventario");
  else fail("el inventario no se restauró, quedó en " + stock);

  // ── Lo que SÍ cambia ──
  if (await saldoDe() === 0)
    ok("y a la clienta NO se le apunta ningún saldo a favor");
  else
    fail("se le acreditó saldo: $" + await saldoDe());

  if (Number(d.aDevolver) === 50)
    ok("la respuesta dice los $50 que hay que devolverle en efectivo: no se esconde el dato");
  else
    fail("no dice cuánto devolver: " + JSON.stringify(d));

  if (d.saldoFavor === undefined)
    ok("y ya no manda ningún 'saldoFavor', para que ninguna pantalla lo vuelva a pintar");
  else
    fail("sigue mandando saldoFavor: " + d.saldoFavor);

  // ── Revertir no debe inventar un saldo negativo ──
  const r2 = await fetch(`${BASE}/api/sales/${ventaId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("admin", "Antonio") },
    body: JSON.stringify({ action: "revert_cancel" }),
  });
  if (!r2.ok) throw new Error("no se pudo revertir: " + (await r2.text()).slice(0, 200));
  if (await saldoDe() === 0)
    ok("al revertir la cancelación tampoco le queda saldo en contra");
  else
    fail("revertir le dejó saldo: $" + await saldoDe());

  const revertida = (await db.query(`select status, penalty_amount from sales where id=$1`, [ventaId])).rows[0];
  if (revertida.status === "credit" && revertida.penalty_amount === null)
    ok("y la venta vuelve a crédito sin penalización, como antes");
  else
    fail("no se revirtió bien: " + JSON.stringify(revertida));

  // ── Dejar constancia de que ya se le entregó el efectivo ──
  const estado = async () => (await db.query(
    `select devuelto_at, devuelto_por_name from sales where id=$1`, [ventaId])).rows[0];

  // Volver a cancelarla para tener el pendiente
  await fetch(`${BASE}/api/sales/${ventaId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("admin", "Antonio") },
    body: JSON.stringify({ action: "cancel_forfeit" }),
  });
  if ((await estado()).devuelto_at === null)
    ok("una cancelación nueva nace pendiente de devolver: el efectivo todavía no sale del cajón");
  else
    fail("nació marcada como devuelta");

  const r3 = await fetch(`${BASE}/api/sales/${ventaId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("admin", "Antonio") },
    body: JSON.stringify({ action: "marcar_devuelto" }),
  });
  if (!r3.ok) throw new Error("no se pudo marcar devuelto: " + (await r3.text()).slice(0, 200));
  const e3 = await estado();
  if (e3.devuelto_at && e3.devuelto_por_name === "Antonio")
    ok("al picar 'Ya se le devolvió' queda la fecha y quién lo entregó");
  else
    fail("no quedó constancia: " + JSON.stringify(e3));

  // Y el dinero de la venta no se movió: eso era lo importante
  const dinero = (await db.query(
    `select total, down_payment, penalty_amount from sales where id=$1`, [ventaId])).rows[0];
  if (Number(dinero.total) === 1000 && Number(dinero.down_payment) === 200 && Number(dinero.penalty_amount) === 150)
    ok("y no se tocó ni un peso de lo que la clienta pagó ni de la penalización");
  else
    fail("se alteró el dinero de la venta: " + JSON.stringify(dinero));

  const r4 = await fetch(`${BASE}/api/sales/${ventaId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("admin", "Antonio") },
    body: JSON.stringify({ action: "deshacer_devuelto" }),
  });
  if (r4.ok && (await estado()).devuelto_at === null)
    ok("y se puede deshacer si se marcó por error");
  else
    fail("no se pudo deshacer");

  // ── Nadie quedó con saldo en toda la base ──
  const quedan = (await db.query(
    `select count(*)::int n from clients where coalesce(saldo_favor,0) <> 0`)).rows[0].n;
  if (quedan === 0) ok("y en toda la base no queda ninguna clienta con saldo a favor");
  else out.push(`  --    todavía hay ${quedan} clientas con saldo: falta correr la limpieza`);

  const pendientes = (await db.query(
    `select count(*)::int n from sales where status='cancelled' and devuelto_at is null and id <> $1`,
    [ventaId])).rows[0].n;
  if (pendientes === 0) ok("ni ninguna cancelación vieja pidiendo devolver: se arranca en cero");
  else out.push(`  --    quedan ${pendientes} cancelaciones por devolver`);
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (ventaId) {
      await db.query("DELETE FROM sale_items WHERE sale_id=$1", [ventaId]);
      await db.query("DELETE FROM payments WHERE sale_id=$1", [ventaId]);
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
