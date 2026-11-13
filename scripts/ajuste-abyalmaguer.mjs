import { Client } from "pg";

// @abyalmaguer es clienta de otro estado: se le manda todo por paquetería, así que no
// tiene entregas agendadas y por eso sus 15 productos salían como pendientes.
//
// Su último envío fue el 4 de agosto y llevó los 4 productos que compró el 20 de
// julio. Todo lo de esa fecha y lo anterior ya está en su poder.
//
// A los 4 del envío se les pone esa fecha, que se sabe por el mensaje. A los 3 de mayo
// no: salieron en un envío anterior del que no hay registro, y ponerles el 4 de agosto
// sería inventar. Quedan sin fecha, que es lo honesto.

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();

  const pendientes = (await db.query(`
    select i.id, pr.name, s.created_at::date comprada
    from sale_items i
    join sales s on s.id = i.sale_id
    join products pr on pr.id = i.product_id
    join clients c on c.id = s.client_id
    where c.instagram = '@abyalmaguer'
      and i.delivery_status <> 'delivered'
      and s.status not in ('cancelled','pending_payment')
      and s.created_at::date <= date '2026-07-20'
    order by s.created_at`)).rows;

  const delEnvio = pendientes.filter((p) => p.comprada.toISOString().slice(0, 10) === "2026-07-20");
  const anteriores = pendientes.filter((p) => p.comprada.toISOString().slice(0, 10) !== "2026-07-20");

  await db.query(
    `update sale_items set delivery_status='delivered', delivered_by_name='Enviado por paquetería'
     where id = ANY($1::uuid[]) and delivery_status <> 'delivered'`,
    [pendientes.map((p) => p.id)]);

  await db.query(
    `update sale_items set delivered_at = timestamptz '2026-08-04 12:00:00-06' where id = ANY($1::uuid[])`,
    [delEnvio.map((p) => p.id)]);
  await db.query(
    `update sale_items set delivered_at = null where id = ANY($1::uuid[])`,
    [anteriores.map((p) => p.id)]);

  console.log(`${pendientes.length} productos marcados entregados:`);
  console.log(`  ${delEnvio.length} del envío del 4 de agosto, con esa fecha`);
  console.log(`  ${anteriores.length} anteriores, sin fecha (no hay registro de en qué envío salieron)`);
} finally {
  await db.end();
}
