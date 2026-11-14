import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

const BASE = process.env.BASE_URL || "http://localhost:3000";

// El lugar bajó de la venta al producto. Esto comprueba dos cosas:
//
//   1. Que el relleno no cambió nada: cada producto dice lo mismo que su venta.
//   2. Que se mantiene solo. Hay seis lugares en la aplicación que escriben el lugar
//      de una venta; si la sincronización dependiera de que los seis se acuerden,
//      tarde o temprano uno se olvida. Por eso vive en la base, y por eso hay que
//      comprobar que la base de verdad lo hace.

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

let clienteId, productoId, ventaId;

try {
  await db.connect();

  // ── 1. Nada quedó desalineado ──
  const { rows: d } = await db.query(`
    select count(*)::int n from sale_items i join sales s on s.id = i.sale_id
    where i.ubicacion is distinct from s.ubicacion or i.caja is distinct from s.caja`);
  if (d[0].n === 0) ok("cada producto dice el mismo lugar que su venta: el relleno no movió nada");
  else fail(`${d[0].n} productos quedaron con un lugar distinto al de su venta`);

  const { rows: c } = await db.query(`
    select count(*) filter (where ubicacion = 'caja') en_caja,
           count(*) filter (where ubicacion = 'estante') en_estante,
           count(*) filter (where ubicacion is null) sin_lugar
    from sale_items`);
  ok(`repartidos: ${c[0].en_caja} en caja, ${c[0].en_estante} en estante, ${c[0].sin_lugar} sin lugar`);

  // ── 2. Los disparadores ──
  const cl = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ('PRUEBA_LUGAR','@prueba_lugar','8710000001') RETURNING id`);
  clienteId = cl.rows[0].id;
  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ('PRUEBA_LUGAR','PRUEBA',100,9,40) RETURNING id`);
  productoId = p.rows[0].id;
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at)
     VALUES ($1,200,200,0,'paid','efectivo',now()) RETURNING id`, [clienteId]);
  ventaId = v.rows[0].id;
  await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,100,'pending')`, [ventaId, productoId]);

  const lugar = async () => (await db.query(
    `select ubicacion, caja from sale_items where sale_id = $1 order by id`, [ventaId])).rows;

  // Guardar en una caja
  await db.query(`update sales set ubicacion='caja', caja=77 where id=$1`, [ventaId]);
  let l = await lugar();
  if (l[0].ubicacion === "caja" && l[0].caja === 77)
    ok("al guardar la venta en la caja 77, su producto también dice caja 77");
  else
    fail("el producto no siguió a su venta: " + JSON.stringify(l[0]));

  // Un producto agregado DESPUÉS hereda el lugar
  await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,100,'pending')`, [ventaId, productoId]);
  l = await lugar();
  if (l.length === 2 && l[1].ubicacion === "caja" && l[1].caja === 77)
    ok("y un producto agregado después hereda la caja de su compra");
  else
    fail("el producto nuevo no heredó el lugar: " + JSON.stringify(l[1]));

  // Mover al estante
  await db.query(`update sales set ubicacion='estante', caja=null where id=$1`, [ventaId]);
  l = await lugar();
  if (l.every((x) => x.ubicacion === "estante" && x.caja === null))
    ok("al pasarla al estante, los dos productos se mueven con ella");
  else
    fail("no se movieron al estante: " + JSON.stringify(l));

  // Soltar el lugar, como cuando se entrega todo o se cancela
  await db.query(`update sales set ubicacion=null, caja=null where id=$1`, [ventaId]);
  l = await lugar();
  if (l.every((x) => x.ubicacion === null && x.caja === null))
    ok("y al soltar el lugar, los productos quedan sin lugar también");
  else
    fail("quedaron con lugar colgado: " + JSON.stringify(l));

  // Que no se dispare de más: tocar otra cosa de la venta no debe mover el lugar
  await db.query(`update sales set ubicacion='caja', caja=78 where id=$1`, [ventaId]);
  await db.query(`update sales set discount=5 where id=$1`, [ventaId]);
  l = await lugar();
  if (l.every((x) => x.caja === 78))
    ok("cambiar otra cosa de la venta no le mueve el lugar a nadie");
  else
    fail("el lugar se perdió al tocar otro campo: " + JSON.stringify(l));
  // ── 3. Lo que todo esto habilita: una compra repartida en dos cajas ──
  // Antes no se podía representar: el lugar era uno por compra, así que había que
  // mandarla entera a una caja aunque sus productos estuvieran en dos.
  await db.query(`update sales set ubicacion='caja', caja=78 where id=$1`, [ventaId]);
  const dos = (await db.query(`select id from sale_items where sale_id=$1 order by id`, [ventaId])).rows;
  await db.query(`update sale_items set caja=79 where id=$1`, [dos[1].id]);

  // Por la API y no importando el módulo: lib/ubicaciones resuelve "@/lib/..." con el
  // alias de Next, que fuera del servidor no existe. Además así se prueba el camino
  // que de verdad usa la ficha de la clienta.
  const r = await fetch(`${BASE}/api/panel/ubicacion`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("admin", "Prueba") },
    body: JSON.stringify({ clientId: clienteId }),
  });
  if (!r.ok) throw new Error("la API de ubicación respondió " + r.status);
  const { guardado } = await r.json();
  const cajas = guardado.filter((g) => g.ubicacion === "caja").map((g) => Number(g.caja)).sort();

  if (cajas.includes(78) && cajas.includes(79))
    ok("una compra con un producto en la caja 78 y otro en la 79 se lee bien: antes era imposible");
  else
    fail("no reconoce la compra repartida, dice: " + JSON.stringify(guardado.map((g) => [g.ubicacion, g.caja])));

  const renglon78 = guardado.find((g) => Number(g.caja) === 78);
  const renglon79 = guardado.find((g) => Number(g.caja) === 79);
  if (renglon78?.productos.length === 1 && renglon79?.productos.length === 1)
    ok("y cada caja enseña solo el producto que de verdad tiene dentro");
  else
    fail("repartió mal los productos: " + JSON.stringify(guardado.map((g) => [g.caja, g.productos.length])));
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (ventaId) {
      await db.query("DELETE FROM sale_items WHERE sale_id=$1", [ventaId]);
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
