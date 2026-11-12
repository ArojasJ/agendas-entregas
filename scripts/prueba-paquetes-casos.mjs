import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";

// Los otros tres caminos de la preparación de paquetes:
//  · sacar mercancía de dos cajas y que sobre de las dos → pregunta en cuál juntarla
//  · deshacer un paquete → los productos vuelven a su caja
//  · entrega mal agendada → se borra, pero no si ya tiene un paquete adentro

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_CASOS";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const api = (url, opts, quien = "Gaby") =>
  fetch(`${BASE}${url}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("worker", quien), ...(opts?.headers || {}) },
  });

let clienteId, productoId;
const ventas = [];
const bookings = [];

async function ventaEnCaja(caja, n) {
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja)
     VALUES ($1,$2,$2,0,'paid','efectivo',now(),'caja',$3) RETURNING id`, [clienteId, 100 * n, caja]);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const r = await db.query(
      `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
       VALUES ($1,$2,1,100,'pending') RETURNING id`, [v.rows[0].id, productoId]);
    ids.push(r.rows[0].id);
  }
  ventas.push(v.rows[0].id);
  return { saleId: v.rows[0].id, itemIds: ids };
}

async function entrega() {
  const b = await db.query(
    `INSERT INTO bookings (type,date,instagram,"fullName",phone,status,delivery_status,products,sale_item_ids)
     VALUES ('domicilio','${isoDePrueba()}','@prueba_casos',$1,'8711234567','confirmed','pendiente','x','[]'::jsonb)
     RETURNING id`, [ETIQUETA]);
  bookings.push(b.rows[0].id);
  return b.rows[0].id;
}

const cajaOcupada = async (n) => (await db.query(`
  select exists (
    select 1 from sales s
    where s.ubicacion='caja' and s.caja::int=$1
      and s.status not in ('cancelled','pending_payment')
      and exists (select 1 from sale_items i where i.sale_id=s.id
                  and i.delivery_status<>'delivered' and i.paquete_booking_id is null)) o`, [n])).rows[0].o;

try {
  await db.connect();

  const libres = await db.query(`
    with o as (
      select (regexp_matches(coalesce(box_1,'')||','||coalesce(box_2,''),'\\d+','g'))[1]::int n from clients
      union select caja::int from sales where ubicacion='caja' and caja is not null)
    select n from generate_series(1,120) n where n not in (select n from o where n is not null) order by n desc limit 2`);
  const [c1, c2] = [libres.rows[0].n, libres.rows[1].n];

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,99,40) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone,box_1) VALUES ($1,$2,'8711234567',$3) RETURNING id`,
    [ETIQUETA, "@prueba_casos", `${c1}, ${c2}`]);
  clienteId = c.rows[0].id;

  // ── Caso 1: sobra de las dos cajas → tiene que preguntar dónde juntarlo ──
  const a = await ventaEnCaja(c1, 2);
  const b = await ventaEnCaja(c2, 2);
  const bk = await entrega();
  ok(`clienta con 2 productos en la caja ${c1} y 2 en la ${c2}`);

  // Se lleva uno de cada caja: queda uno en cada una
  const seLleva = [a.itemIds[0], b.itemIds[0]];
  let r = await api("/api/panel/paquetes", {
    method: "POST",
    body: JSON.stringify({ accion: "simular", clientId: clienteId, itemIds: seLleva }),
  });
  let d = await r.json();
  if (d.hayQueJuntar && d.cajasConRestos?.length === 2)
    ok(`avisa que sobra mercancía en las cajas ${d.cajasConRestos.join(" y ")} y hay que juntarla`);
  else
    fail("no detecta que hay que juntar: " + JSON.stringify(d));
  if ((d.seLiberan || []).length === 0) ok("y que todavía no se libera ninguna, porque de las dos sobró");
  else fail("dice que se libera alguna cuando en las dos quedó algo");

  // Armar juntando lo que sobra en la primera caja
  r = await api("/api/panel/paquetes", {
    method: "POST",
    body: JSON.stringify({ accion: "armar", bookingId: bk, clientId: clienteId, itemIds: seLleva, juntarRestosEn: c1 }),
  });
  d = await r.json();
  if (!r.ok) fail("no se armó: " + JSON.stringify(d));

  if (await cajaOcupada(c1) && !(await cajaOcupada(c2)))
    ok(`lo que sobró se juntó en la caja ${c1}, y la ${c2} quedó libre`);
  else
    fail(`las cajas quedaron mal: ${c1}=${await cajaOcupada(c1)}, ${c2}=${await cajaOcupada(c2)}`);

  const sueltos = await db.query(
    `select distinct s.caja::int caja from sales s join sale_items i on i.sale_id=s.id
     where s.client_id=$1 and i.delivery_status<>'delivered' and i.paquete_booking_id is null`, [clienteId]);
  if (sueltos.rows.length === 1 && sueltos.rows[0].caja === c1)
    ok("todo lo pendiente quedó en una sola caja, no repartido");
  else
    fail("quedó repartido: " + JSON.stringify(sueltos.rows));

  // ── Caso 2: no se puede borrar una entrega que ya tiene paquete ──
  r = await api("/api/panel/paquetes", {
    method: "POST",
    body: JSON.stringify({ accion: "mal_agendada", bookingId: bk }),
  });
  if (r.status === 409) ok("no deja borrar una entrega que ya tiene productos adentro");
  else fail(`dejó borrar un paquete armado (${r.status})`);

  // ── Caso 3: deshacer devuelve los productos a su caja ──
  r = await api("/api/panel/paquetes", {
    method: "POST",
    body: JSON.stringify({ accion: "deshacer", bookingId: bk, clientId: clienteId }),
  });
  d = await r.json();
  if (r.ok && d.sueltos === 2) ok("deshacer suelta los 2 productos del paquete");
  else fail("no se deshizo: " + JSON.stringify(d));

  if (await cajaOcupada(c1)) ok(`y vuelven a ocupar la caja ${c1}, donde estaban`);
  else fail("los productos no volvieron a ocupar su caja");

  const bkTrasDeshacer = await db.query(
    `select sale_item_ids, preparado_at, preparado_por_name from bookings where id=$1`, [bk]);
  if ((bkTrasDeshacer.rows[0].sale_item_ids || []).length === 0 && !bkTrasDeshacer.rows[0].preparado_at)
    ok("la entrega vuelve a quedar sin preparar, sin firma colgando");
  else
    fail("quedó rastro de la preparación deshecha: " + JSON.stringify(bkTrasDeshacer.rows[0]));

  // ── Caso 4: una entrega vacía y mal agendada sí se borra ──
  const sobrante = await entrega();
  r = await api("/api/panel/paquetes", {
    method: "POST",
    body: JSON.stringify({ accion: "mal_agendada", bookingId: sobrante }),
  });
  const existe = await db.query("select 1 from bookings where id=$1", [sobrante]);
  if (r.ok && existe.rows.length === 0) ok("una entrega mal agendada y vacía sí se borra de la lista");
  else fail("no se borró la entrega mal agendada");

  // ── Caso 5: no se puede meter al paquete un producto de otra clienta ──
  const otra = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8710000000') RETURNING id`,
    [ETIQUETA + " OTRA", "@prueba_casos_otra"]);
  const vOtra = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at)
     VALUES ($1,100,100,0,'paid','efectivo',now()) RETURNING id`, [otra.rows[0].id]);
  const iOtra = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,100,'pending') RETURNING id`, [vOtra.rows[0].id, productoId]);
  ventas.push(vOtra.rows[0].id);

  const bk2 = await entrega();
  r = await api("/api/panel/paquetes", {
    method: "POST",
    body: JSON.stringify({ accion: "armar", bookingId: bk2, clientId: clienteId, itemIds: [iOtra.rows[0].id] }),
  });
  const quedo = await db.query("select paquete_booking_id from sale_items where id=$1", [iOtra.rows[0].id]);
  if (!quedo.rows[0].paquete_booking_id) ok("no deja meter al paquete el producto de otra clienta");
  else fail("metió al paquete mercancía de otra persona");
  // La clienta de más se borra al final, cuando ya no quede ninguna venta colgando.
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (bookings.length) await db.query("DELETE FROM bookings WHERE id = ANY($1::uuid[])", [bookings]);
    if (ventas.length) {
      await db.query("DELETE FROM sale_items WHERE sale_id = ANY($1::uuid[])", [ventas]);
      await db.query("DELETE FROM sales WHERE id = ANY($1::uuid[])", [ventas]);
    }
    await db.query("DELETE FROM clients WHERE instagram IN ('@prueba_casos','@prueba_casos_otra')");
    if (productoId) {
      await db.query("DELETE FROM sale_items WHERE product_id=$1", [productoId]);
      await db.query("DELETE FROM products WHERE id=$1", [productoId]);
    }
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await db.end();
}
