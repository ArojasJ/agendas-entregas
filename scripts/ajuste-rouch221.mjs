import { Client } from "pg";

// La playera Gymshark de @rouch221 salió el 13 de noviembre en su entrega a domicilio
// —la tarjeta de esa entrega quedó marcada como entregada— pero el producto se quedó
// en pending.
//
// El motivo: el 12 de noviembre, con el script de ajuste de cajas, la metí a un paquete
// amarrado a su entrega de BODEGA del 5-nov, que seguía pendiente. La entrega que de
// verdad pasó fue otra, y como no tenía el producto ligado, al marcarse entregada no
// marcó nada.
//
// Aquí solo se marca el producto como entregado con la fecha en que salió. El paquete
// y las entregas duplicadas se dejan como están: eso es otra decisión.

const CLIENTA = "38c613e0-456a-45fb-a070-f54bbb35ea9c";
const ENTREGA_DOMICILIO = "53d919a4-7ce2-405e-b237-4ece8ecd6c87"; // 13-nov, entregada

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();

  const { rows: antes } = await db.query(`
    select i.id, pr.name, i.delivery_status, i.paquete_booking_id
    from sale_items i
    join sales s on s.id = i.sale_id
    left join products pr on pr.id = i.product_id
    where s.client_id = $1 and i.delivery_status <> 'delivered'`, [CLIENTA]);

  if (antes.length === 0) {
    console.log("No queda nada pendiente de @rouch221: ya estaba marcado.");
  } else {
    // El día en que salió, no el de hoy, para que la bitácora diga la verdad.
    const { rows: ent } = await db.query(
      `select date from bookings where id = $1`, [ENTREGA_DOMICILIO]);
    const dia = ent[0].date.toISOString().slice(0, 10);

    await db.query(`
      update sale_items
         set delivery_status = 'delivered',
             delivered_by_name = 'Entrega a domicilio del 13-nov'
       where id = ANY($1::uuid[])`, [antes.map((a) => a.id)]);

    // La fecha va en un update aparte: el disparador de la base pone now() cuando el
    // estado cambia a entregado, y se come cualquier fecha que venga en el mismo
    // update. En el segundo el estado ya no cambia, así que no se dispara.
    await db.query(`
      update sale_items set delivered_at = timestamptz '${dia} 12:00:00-06'
       where id = ANY($1::uuid[])`, [antes.map((a) => a.id)]);

    for (const a of antes) console.log(`  entregado · ${a.name}`);
  }

  const { rows: despues } = await db.query(`
    select pr.name, i.delivery_status, i.delivered_at, i.delivered_by_name
    from sale_items i join sales s on s.id = i.sale_id
    left join products pr on pr.id = i.product_id
    where s.client_id = $1`, [CLIENTA]);
  console.log("\nComo quedó:");
  for (const d of despues) console.log("  " + JSON.stringify(d));
} finally {
  await db.end();
}
