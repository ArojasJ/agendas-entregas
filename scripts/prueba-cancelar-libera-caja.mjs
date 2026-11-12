import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// Cancelar una venta devolvía el inventario pero NO tocaba las cajas: la caja 44 de
// @dominnik.s se quedó anotada en su ficha aunque la mercancía ya había vuelto a la
// tienda. Ahora se recalcula.
//
// Y no basta con soltarla: en esa misma caja, o en otras suyas, puede quedar
// mercancía de compras que NO se cancelaron. Eso no se puede adivinar, así que el
// sistema devuelve cómo quedó todo para preguntarlo en pantalla.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_CANCELAR";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const api = (url, opts) =>
  fetch(`${BASE}${url}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("admin", "Prueba Admin"), ...(opts?.headers || {}) },
  });

let productoId;
const clientes = [];
const ventas = [];

async function ventaEnCaja(clienteId, caja, n = 1) {
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja)
     VALUES ($1,$2,$2,0,'paid','efectivo',now(),'caja',$3) RETURNING id`, [clienteId, 100 * n, caja]);
  for (let i = 0; i < n; i++) {
    await db.query(
      `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
       VALUES ($1,$2,1,100,'pending')`, [v.rows[0].id, productoId]);
  }
  ventas.push(v.rows[0].id);
  return v.rows[0].id;
}

const cajaOcupada = async (n) => (await db.query(`
  select exists (
    select 1 from sales s
    where s.ubicacion='caja' and s.caja::int=$1
      and s.status not in ('cancelled','pending_payment')
      and exists (select 1 from sale_items i where i.sale_id=s.id
                  and i.delivery_status<>'delivered' and i.paquete_booking_id is null)) o`, [n])).rows[0].o;

const ficha = async (id) => (await db.query("select box_1 from clients where id=$1", [id])).rows[0].box_1;

async function clienta(sufijo, cajas) {
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone,box_1) VALUES ($1,$2,'8711234567',$3) RETURNING id`,
    [`${ETIQUETA} ${sufijo}`, `@prueba_cancelar_${sufijo}`, cajas]);
  clientes.push(c.rows[0].id);
  return c.rows[0].id;
}

try {
  await db.connect();

  const libres = await db.query(`
    with o as (
      select (regexp_matches(coalesce(box_1,'')||','||coalesce(box_2,''),'\\d+','g'))[1]::int n from clients
      union select caja::int from sales where ubicacion='caja' and caja is not null)
    select n from generate_series(1,120) n where n not in (select n from o where n is not null) order by n desc limit 3`);
  const [c1, c2, c3] = libres.rows.map((r) => r.n);

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,99,40) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;

  // ── Caso 1: era lo único en esa caja → la caja se libera ──
  const sola = await clienta("sola", String(c1));
  const ventaSola = await ventaEnCaja(sola, c1);
  if (await cajaOcupada(c1)) ok(`la caja ${c1} arranca ocupada con una sola compra`);
  else fail("la caja no arranca ocupada");

  let r = await api(`/api/sales/${ventaSola}`, { method: "PATCH", body: JSON.stringify({ action: "cancel_forfeit" }) });
  let d = await r.json();
  if (!r.ok) fail("no se pudo cancelar: " + JSON.stringify(d));

  if (!(await cajaOcupada(c1))) ok(`al cancelar, la caja ${c1} queda libre`);
  else fail(`la caja ${c1} sigue ocupada después de cancelar`);
  if (!(await ficha(sola))) ok("y se borra de la ficha de la clienta");
  else fail("la ficha sigue reclamando la caja: " + (await ficha(sola)));
  if (d.cajas?.seLibero && d.cajas.caja === c1) ok("el sistema avisa que esa caja se liberó");
  else fail("no avisa que se liberó: " + JSON.stringify(d.cajas));

  // ── Caso 2: quedaba otra compra en la MISMA caja → no se libera, y avisa ──
  const misma = await clienta("misma", String(c2));
  const aCancelar = await ventaEnCaja(misma, c2);
  await ventaEnCaja(misma, c2, 2); // esta NO se cancela

  r = await api(`/api/sales/${aCancelar}`, { method: "PATCH", body: JSON.stringify({ action: "cancel_forfeit" }) });
  d = await r.json();

  if (await cajaOcupada(c2)) ok(`la caja ${c2} NO se libera: ahí quedó mercancía de otra compra`);
  else fail(`se liberó la caja ${c2} dejando mercancía dentro`);
  if (d.cajas?.quedaEnLaMisma && !d.cajas.seLibero)
    ok("y el sistema lo dice en vez de darla por libre");
  else
    fail("no avisa que quedó mercancía: " + JSON.stringify(d.cajas));
  if (d.cajas?.quedaGuardado?.length === 2) ok("diciendo cuántos productos siguen ahí: 2");
  else fail(`dice ${d.cajas?.quedaGuardado?.length} productos`);

  // ── Caso 3: le quedó mercancía en DOS cajas → pregunta en cuál juntarla ──
  const varias = await clienta("varias", `${c2}, ${c3}`);
  const otra = await ventaEnCaja(varias, c2);
  await ventaEnCaja(varias, c2);
  await ventaEnCaja(varias, c3);

  r = await api(`/api/sales/${otra}`, { method: "PATCH", body: JSON.stringify({ action: "cancel_forfeit" }) });
  d = await r.json();

  if (d.cajas?.hayQueJuntar && d.cajas.cajasConRestos?.length === 2)
    ok(`avisa que le quedó mercancía repartida en las cajas ${d.cajas.cajasConRestos.join(" y ")} y pregunta`);
  else
    fail("no pregunta por las cajas repartidas: " + JSON.stringify(d.cajas));

  // Responder "déjalo todo en la primera"
  r = await api("/api/panel/paquetes", {
    method: "POST",
    body: JSON.stringify({ accion: "juntar", clientId: varias, juntarRestosEn: c2 }),
  });
  if (!r.ok) fail("no se pudo juntar: " + (await r.text()).slice(0, 150));

  const repartido = await db.query(
    `select distinct s.caja::int caja from sales s join sale_items i on i.sale_id=s.id
     where s.client_id=$1 and s.status not in ('cancelled','pending_payment')
       and i.delivery_status<>'delivered' and i.paquete_booking_id is null`, [varias]);
  if (repartido.rows.length === 1 && repartido.rows[0].caja === c2)
    ok(`al responder, todo lo pendiente queda en la caja ${c2} y la ${c3} se suelta`);
  else
    fail("no se juntó: " + JSON.stringify(repartido.rows));

  // ── Una venta sin caja no debe inventar preguntas ──
  const sinCaja = await clienta("sincaja", null);
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at)
     VALUES ($1,100,100,0,'paid','efectivo',now()) RETURNING id`, [sinCaja]);
  await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,100,'pending')`, [v.rows[0].id, productoId]);
  ventas.push(v.rows[0].id);

  r = await api(`/api/sales/${v.rows[0].id}`, { method: "PATCH", body: JSON.stringify({ action: "cancel_forfeit" }) });
  d = await r.json();
  if (r.ok && !d.cajas?.seLibero && !d.cajas?.hayQueJuntar)
    ok("cancelar una venta que no estaba en ninguna caja no inventa avisos");
  else
    fail("inventó un aviso de cajas: " + JSON.stringify(d.cajas));
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (ventas.length) {
      await db.query("DELETE FROM payments WHERE sale_id = ANY($1::uuid[])", [ventas]);
      await db.query("DELETE FROM sale_items WHERE sale_id = ANY($1::uuid[])", [ventas]);
    }
    if (clientes.length) {
      await db.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1::uuid[]))`, [clientes]);
      await db.query(`DELETE FROM sales WHERE client_id = ANY($1::uuid[])`, [clientes]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [clientes]);
    }
    if (productoId) {
      await db.query("DELETE FROM sale_items WHERE product_id=$1", [productoId]);
      await db.query("DELETE FROM products WHERE id=$1", [productoId]);
    }
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await db.end();
}
