import { Client } from "pg";

// Los productos de ventas de mostrador que quedaron "pendientes" desde antes de que el
// sistema los marcara entregados solo. En una venta sin clienta no hay a quién
// guardarle nada: la persona pagó y se fue con el producto. Nadie los iba a marcar
// nunca, porque no hay entrega que hacer.
//
// La fecha de entrega es la de la venta, no la de hoy: en el mostrador la venta y la
// entrega son el mismo acto, así que esa fecha no se inventa, se sabe.
//
// La firma es quien cobró, que es quien se lo dio. Si la venta no guardó quién, queda
// la etiqueta genérica en vez de atribuírselo a alguien que a lo mejor no fue.
//
// Sin argumentos solo enseña el plan. Con --aplicar lo escribe.

const APLICAR = process.argv.includes("--aplicar");

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();

  const { rows } = await db.query(`
    select i.id item, s.id venta, s.created_at,
           coalesce(st.display_name, st.username, 'Venta de mostrador') firma
    from sale_items i
    join sales s on s.id = i.sale_id
    left join staff st on st.id = s.created_by_staff_id
    where s.client_id is null
      and s.status not in ('cancelled','pending_payment')
      and i.delivery_status <> 'delivered'
    order by s.created_at`);

  if (rows.length === 0) {
    console.log("No queda ningún producto de mostrador pendiente.");
  } else {
    const porFirma = new Map();
    for (const r of rows) porFirma.set(r.firma, (porFirma.get(r.firma) || 0) + 1);
    console.log(`${rows.length} productos de mostrador pendientes:`);
    for (const [f, n] of porFirma) console.log(`  ${String(n).padStart(3)} · cobrados por ${f}`);
    console.log(`  del ${rows[0].created_at.toISOString().slice(0, 10)} al ${rows.at(-1).created_at.toISOString().slice(0, 10)}`);

    if (APLICAR) {
      for (const r of rows) {
        // El estado primero: el disparador de la base pone now() al cambiarlo y se
        // comería cualquier fecha que viniera en el mismo update.
        await db.query(
          `update sale_items set delivery_status='delivered', delivered_by_name=$2 where id=$1`,
          [r.item, r.firma]);
        await db.query(
          `update sale_items set delivered_at=$2 where id=$1`,
          [r.item, r.created_at]);
      }
      console.log("\nMarcados entregados, cada uno con la fecha de su venta.");
    }
  }

  const { rows: q } = await db.query(`
    select count(*)::int n from sale_items i join sales s on s.id=i.sale_id
    where s.client_id is null and i.delivery_status <> 'delivered'
      and s.status not in ('cancelled','pending_payment')`);
  console.log(`\nQuedan ${q[0].n} productos de mostrador pendientes.`);
  if (!APLICAR) console.log("Esto es solo el plan. Para escribirlo: --aplicar");
} finally {
  await db.end();
}
