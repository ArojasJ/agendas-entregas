import { Client } from "pg";

// @magda.favela: sus 2 geles quedaron presos en un paquete del 12-nov, de una entrega
// de bodega que terminó como "no entregado". El 17-nov se le hizo una entrega a
// domicilio que SÍ salió y está marcada como entregada, pero quedó con cero productos
// adentro, porque al intentar armarla el sistema no podía sacar los geles del paquete
// viejo.
//
// Eso ya se arregló para adelante. Aquí se corrigen los datos de los dos: los geles
// pasan a la entrega de hoy y quedan marcados como entregados, con la fecha en que de
// verdad salieron.
//
// Sin argumentos solo enseña el plan. Con --aplicar lo escribe.

const APLICAR = process.argv.includes("--aplicar");
const VIEJA = "6deca5f8-a321-46a1-ae28-2f1f9db07d63"; // 12-nov, bodega, no entregado
const HOY = "a3c1b2c1-cc24-46cd-ae3c-1fe2e35c4e3a";   // 17-nov, domicilio, entregado

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();

  const { rows: entregas } = await db.query(
    `select id, date::date fecha, type, delivery_status from bookings where id = ANY($1::uuid[])`,
    [[VIEJA, HOY]]);
  if (entregas.length !== 2) throw new Error("no están las dos entregas: " + JSON.stringify(entregas));
  const hoy = entregas.find((e) => e.id === HOY);
  if (hoy.delivery_status !== "entregado") throw new Error("la entrega de hoy no está marcada entregada");

  const { rows: presos } = await db.query(`
    select i.id, pr.name from sale_items i
    left join products pr on pr.id = i.product_id
    where i.paquete_booking_id = $1 and i.delivery_status <> 'delivered'`, [VIEJA]);

  if (presos.length === 0) {
    console.log("Ya no queda nada preso en el paquete del 12-nov.");
  } else {
    console.log(`${presos.length} productos pasan del paquete del 12-nov a la entrega del 17-nov:`);
    for (const p of presos) console.log("   - " + p.name);

    if (APLICAR) {
      const ids = presos.map((p) => p.id);
      await db.query(`update sale_items set paquete_booking_id = $1 where id = ANY($2::uuid[])`, [HOY, ids]);

      // El estado primero: el disparador de la base pone now() al cambiarlo y se
      // comería cualquier fecha que viniera en el mismo update.
      await db.query(`
        update sale_items set delivery_status='delivered',
               delivered_by_name='Entrega a domicilio del 17-nov'
         where id = ANY($1::uuid[])`, [ids]);
      await db.query(`
        update sale_items set delivered_at = $2 where id = ANY($1::uuid[])`,
        [ids, new Date(hoy.fecha.toISOString().slice(0, 10) + "T18:00:00.000Z")]);

      await db.query(`update bookings set sale_item_ids = $2::jsonb where id = $1`,
        [HOY, JSON.stringify(ids)]);
      await db.query(`
        update bookings set sale_item_ids = '[]'::jsonb,
               preparado_at = null, preparado_por_staff_id = null, preparado_por_name = null
         where id = $1`, [VIEJA]);
      console.log("\nHecho.");
    }
  }

  const { rows: fin } = await db.query(`
    select b.date::date fecha, b.type, b.delivery_status,
           (select count(*) from sale_items i where i.paquete_booking_id = b.id) productos
    from bookings b where b.id = ANY($1::uuid[]) order by b.date`, [[VIEJA, HOY]]);
  console.log("\nComo quedan sus entregas:");
  for (const f of fin) console.log(`   ${f.fecha.toISOString().slice(0, 10)}  ${f.type.padEnd(11)} ${String(f.delivery_status).padEnd(14)} ${f.productos} productos`);

  const { rows: pend } = await db.query(`
    select count(*)::int n from sale_items i join sales s on s.id = i.sale_id
    join clients c on c.id = s.client_id
    where c.instagram = '@magda.favela' and i.delivery_status <> 'delivered'
      and s.status not in ('cancelled','pending_payment')`);
  console.log(`   le quedan ${pend[0].n} productos pendientes`);

  if (!APLICAR) console.log("\nEsto es solo el plan. Para escribirlo: --aplicar");
} finally {
  await db.end();
}
