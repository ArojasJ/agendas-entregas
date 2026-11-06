import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// Al vaciar una caja, la clienta se quedaba con ella apuntada en la ficha para siempre:
// la función que recalcula las cajas preguntaba "qué tiene guardado", y esa respuesta
// incluía la caja de la propia ficha. La ficha se confirmaba a sí misma.
//
// Lo que no se puede romper al arreglarlo: las cajas heredadas, de cuando no se
// anotaba el lugar por compra. De esas no consta el contenido, pero la mercancía sí
// está ahí y no se pueden soltar.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_FANTASMA";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let token, productoId;
const creados = [];

const api = (url, opts) =>
  fetch(`${BASE}${url}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-panel-token": token, ...(opts?.headers || {}) },
  }).then((r) => r.json());

async function nuevaClienta(sufijo, caja = null) {
  const r = await c.query(
    `INSERT INTO clients (name,instagram,phone,box_1) VALUES ($1,$2,'8711234567',$3) RETURNING id`,
    [ETIQUETA + "_" + sufijo, "@prueba_fantasma_" + sufijo.toLowerCase(), caja]);
  creados.push(r.rows[0].id);
  return r.rows[0].id;
}

// Una venta pendiente, con el lugar que se le quiera dar (o ninguno)
async function venderA(clientId, { ubicacion = null, caja = null } = {}) {
  const v = await c.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja)
     VALUES ($1,100,100,0,'paid','efectivo',now(),$2,$3) RETURNING id`,
    [clientId, ubicacion, caja]);
  await c.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,100,'pending')`, [v.rows[0].id, productoId]);
  return v.rows[0].id;
}

const ficha = async (id) => {
  const r = await c.query("SELECT box_1, box_2 FROM clients WHERE id=$1", [id]);
  return r.rows[0];
};

// Mover una venta a un lugar pasa por la misma ruta que usan el panel y el punto de
// venta, que es la que dispara la sincronización de cajas.
const mover = (saleIds, tipo, caja) =>
  api("/api/panel/ubicacion", { method: "PATCH", body: JSON.stringify({ saleIds, tipo, caja }) });

async function cajaLibre() {
  const r = await c.query(`
    with ocupadas as (
      select nullif(regexp_replace(box_1,'\\D','','g'),'')::int n from clients where box_1 ~ '^[0-9]+$'
      union select nullif(regexp_replace(box_2,'\\D','','g'),'')::int from clients where box_2 ~ '^[0-9]+$'
      union select caja::int from sales where ubicacion='caja' and caja is not null)
    select n from generate_series(1,120) n
    where n not in (select n from ocupadas where n is not null)
    order by n desc limit 2`);
  return r.rows.map((x) => x.n);
}

try {
  await c.connect();
  token = tokenDePrueba();

  const p = await c.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,500,40) RETURNING id`,
    [ETIQUETA]);
  productoId = p.rows[0].id;

  const [cajaA, cajaB] = await cajaLibre();
  ok(`se usan las cajas libres ${cajaA} y ${cajaB} para la prueba`);

  // ── 1. El caso reportado: se vacía la caja y la ficha tiene que soltarla ──
  const a = await nuevaClienta("A");
  const ventaA = await venderA(a);
  await mover([ventaA], "caja", cajaA);

  if (String((await ficha(a)).box_1) === String(cajaA))
    ok(`al meter la venta a la caja ${cajaA}, la ficha la toma`);
  else
    fail(`la ficha quedó en "${(await ficha(a)).box_1}" y debía ser ${cajaA}`);

  await mover([ventaA], "estante");
  const despues = await ficha(a);
  if (despues.box_1 === null)
    ok("al pasar todo al estante, la ficha suelta la caja (era el bug)");
  else
    fail(`la caja no se soltó: la ficha sigue en "${despues.box_1}"`);

  // Y la caja vuelve a estar disponible para alguien más
  const libres = await cajaLibre();
  if (libres.includes(cajaA)) ok(`la caja ${cajaA} vuelve a quedar libre`);
  else fail(`la caja ${cajaA} sigue apartada aunque está vacía`);

  // ── 2. Lo que NO se puede romper: las cajas heredadas ──
  // Ficha con caja pero sin venta adentro, y mercancía pendiente sin ubicar: esa
  // mercancía bien puede estar en esa caja, así que no se suelta.
  const b = await nuevaClienta("B", String(cajaB));
  await venderA(b);                                   // pendiente, sin ubicación
  const otraB = await venderA(b);
  await mover([otraB], "estante");                    // dispara la sincronización

  if (String((await ficha(b)).box_1) === String(cajaB))
    ok(`la caja heredada ${cajaB} se conserva mientras quede mercancía sin ubicar`);
  else
    fail(`se soltó la caja heredada ${cajaB}: se perdería dónde está la mercancía`);

  // Y el punto de venta la sigue proponiendo para juntar
  const prop = await api(`/api/panel/ubicacion?clientId=${b}&productos=1`);
  if (prop.tipo === "juntar" && String(prop.caja) === String(cajaB))
    ok(`y el cobro sigue proponiendo juntar en la caja ${cajaB}`);
  else
    fail(`el cobro propuso "${prop.tipo}" caja "${prop.caja}"`);

  // ── 3. Ya sin mercancía sin ubicar, esa misma caja heredada sí se suelta ──
  const pendientesB = await c.query(
    `SELECT id FROM sales WHERE client_id=$1 AND ubicacion IS NULL`, [b]);
  await mover(pendientesB.rows.map((r) => r.id), "estante");

  if ((await ficha(b)).box_1 === null)
    ok("cuando ya todo tiene lugar, la caja heredada también se suelta");
  else
    fail(`la caja heredada quedó pegada en "${(await ficha(b)).box_1}"`);

  // ── 4. Una caja con venta adentro no se suelta por nada ──
  const d = await nuevaClienta("D");
  const v1 = await venderA(d);
  const v2 = await venderA(d);
  await mover([v1], "caja", cajaA);
  await mover([v2], "estante");

  if (String((await ficha(d)).box_1) === String(cajaA))
    ok(`con una venta todavía dentro, la caja ${cajaA} no se suelta`);
  else
    fail(`se soltó la caja ${cajaA} teniendo una venta adentro`);

  // ── 5. Entregar lo que queda en la caja también la libera ──
  await c.query(
    `UPDATE sale_items SET delivery_status='delivered' WHERE sale_id=$1`, [v1]);
  await c.query(`UPDATE sales SET ubicacion=NULL, caja=NULL WHERE id=$1`, [v1]);
  await mover([v2], "estante");

  if ((await ficha(d)).box_1 === null)
    ok("al entregarse lo de la caja, la ficha la suelta");
  else
    fail(`quedó la caja "${(await ficha(d)).box_1}" después de entregar su contenido`);
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (creados.length) {
      await c.query(
        `DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1::uuid[]))`,
        [creados]);
      await c.query("DELETE FROM sales WHERE client_id = ANY($1::uuid[])", [creados]);
      await c.query("DELETE FROM clients WHERE id = ANY($1::uuid[])", [creados]);
    }
    if (productoId) {
      await c.query("DELETE FROM sale_items WHERE product_id=$1", [productoId]);
      await c.query("DELETE FROM products WHERE id=$1", [productoId]);
    }
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await c.end();
}
