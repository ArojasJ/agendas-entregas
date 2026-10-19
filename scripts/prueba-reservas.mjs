import { Client } from "pg";

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const ETIQUETA = "PRUEBA_RESERVAS";
let productoId, clienteId;

async function stock() {
  const r = await c.query("SELECT stock FROM products WHERE id=$1", [productoId]);
  return Number(r.rows[0].stock);
}

async function crearVenta({ vencida, estado = "pending_payment", cantidad = 3 }) {
  const v = await c.query(
    `INSERT INTO sales (client_id, total, down_payment, discount, status, payment_method, expires_at)
     VALUES ($1, 100, 0, 0, $2, 'pendiente', now() + ($3 || ' minutes')::interval)
     RETURNING id`,
    [clienteId, estado, vencida ? -60 : 60]
  );
  const saleId = v.rows[0].id;
  await c.query(
    `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, delivery_status)
     VALUES ($1, $2, $3, 100, 'pending')`,
    [saleId, productoId, cantidad]
  );
  await c.query("UPDATE products SET stock = stock - $1 WHERE id = $2", [cantidad, productoId]);
  return saleId;
}

try {
  await c.connect();

  const p = await c.query(
    `INSERT INTO products (name, category, price, stock, cost) VALUES ($1,'PRUEBA',100,10,50) RETURNING id`,
    [ETIQUETA]
  );
  productoId = p.rows[0].id;
  const cl = await c.query(
    `INSERT INTO clients (name, instagram) VALUES ($1,$2) RETURNING id`,
    [ETIQUETA, "@" + ETIQUETA.toLowerCase()]
  );
  clienteId = cl.rows[0].id;

  // 1. Una reserva vencida devuelve su inventario
  const vencida = await crearVenta({ vencida: true });
  if (await stock() === 7) ok("al apartar, el stock baja de 10 a 7");
  else fail(`el stock quedó en ${await stock()} tras apartar`);

  let r = await c.query("SELECT * FROM liberar_reservas_vencidas()");
  if (await stock() === 10) ok(`la reserva vencida devolvió las 3 piezas (${r.rowCount} venta liberada)`);
  else fail(`el stock quedó en ${await stock()}, debía volver a 10`);

  const est = await c.query("SELECT status FROM sales WHERE id=$1", [vencida]);
  if (est.rows[0].status === "cancelled") ok("la venta vencida quedó como cancelada");
  else fail(`la venta quedó en "${est.rows[0].status}"`);

  // 2. Correr el barrido otra vez no debe devolver el inventario dos veces
  await c.query("SELECT * FROM liberar_reservas_vencidas()");
  if (await stock() === 10) ok("correrlo dos veces no duplica el inventario");
  else fail(`el segundo barrido dejó el stock en ${await stock()}`);

  // 3. Una reserva todavía vigente no se toca
  await crearVenta({ vencida: false });
  await c.query("SELECT * FROM liberar_reservas_vencidas()");
  if (await stock() === 7) ok("una reserva vigente no se libera antes de tiempo");
  else fail(`el stock quedó en ${await stock()}, la vigente no debía liberarse`);

  // 4. Un apartado de los de siempre nunca caduca, aunque sea viejo
  const apartado = await c.query(
    `INSERT INTO sales (client_id, total, down_payment, discount, status, payment_method, expires_at)
     VALUES ($1, 100, 0, 0, 'catalog_pending', 'pendiente', now() - interval '10 days') RETURNING id`,
    [clienteId]
  );
  await c.query(
    `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, delivery_status)
     VALUES ($1,$2,2,100,'pending')`,
    [apartado.rows[0].id, productoId]
  );
  await c.query("UPDATE products SET stock = stock - 2 WHERE id = $1", [productoId]);
  await c.query("SELECT * FROM liberar_reservas_vencidas()");
  const estApartado = await c.query("SELECT status FROM sales WHERE id=$1", [apartado.rows[0].id]);
  if (estApartado.rows[0].status === "catalog_pending" && (await stock()) === 5)
    ok("un apartado viejo NO se cancela ni devuelve inventario");
  else fail(`el apartado quedó en "${estApartado.rows[0].status}" con stock ${await stock()}`);

  // 5. Un pago que entra justo antes del barrido gana
  const carrera = await crearVenta({ vencida: true, cantidad: 1 });
  await c.query("UPDATE sales SET status='paid' WHERE id=$1", [carrera]);
  const antes = await stock();
  await c.query("SELECT * FROM liberar_reservas_vencidas()");
  if (await stock() === antes) ok("una venta ya pagada no se cancela ni devuelve stock");
  else fail("el barrido devolvió el inventario de una venta pagada");
} catch (e) {
  fail(e.message);
} finally {
  try {
    await c.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id=$1)`, [clienteId]);
    await c.query("DELETE FROM sales WHERE client_id=$1", [clienteId]);
    await c.query("DELETE FROM clients WHERE id=$1", [clienteId]);
    await c.query("DELETE FROM products WHERE id=$1", [productoId]);
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await c.end();
}
