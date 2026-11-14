import { Client } from "pg";

// @cr_narubi tiene dos cajas, la 54 y la 64, así que sus 16 productos sin lugar no se
// podían deducir: había que ir a verlos. Ella los revisó.
//
// En la 64 están la gorra US Polo Assn y el reloj Polo Club. Todo lo demás, en la 54.
//
// Las dos de la 64 son compras de un solo producto, así que ninguna queda partida
// entre dos cajas: la ubicación se guarda por compra, no por producto.

const CLIENTA = "@cr_narubi";

const EN_64 = [
  ["7a6932bf-2f23-44ec-8cef-1c80fd702618", "GORRA US POLO ASSN"],
  ["d6ab4958-6213-4475-bf98-163085702f87", "RELOJ POLO CLUB PLATEADO CON DORADO"],
];

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();

  // Antes de escribir, comprobar que cada venta de la 64 es la que se cree que es: un
  // id pegado mal mandaría mercancía a la caja equivocada sin que nadie lo notara.
  for (const [id, nombre] of EN_64) {
    const { rows } = await db.query(`
      select pr.name from sale_items i
      left join products pr on pr.id = i.product_id
      where i.sale_id = $1`, [id]);
    const encontrado = rows.map((r) => (r.name || "").trim().toUpperCase());
    if (encontrado.length !== 1 || encontrado[0] !== nombre) {
      throw new Error(`la venta ${id} no es "${nombre}" sino ${JSON.stringify(encontrado)}`);
    }
  }

  const { rows: pendientes } = await db.query(`
    select distinct s.id
    from sale_items i
    join sales s on s.id = i.sale_id
    join clients c on c.id = s.client_id
    where c.instagram ilike $1
      and s.ubicacion is null and s.status not in ('cancelled','pending_payment')
      and i.delivery_status <> 'delivered' and i.paquete_booking_id is null`, [CLIENTA]);

  const ids64 = EN_64.map(([id]) => id);
  const ids54 = pendientes.map((p) => p.id).filter((id) => !ids64.includes(id));

  await db.query(`update sales set ubicacion='caja', caja=64 where id = ANY($1::uuid[])`, [ids64]);
  await db.query(`update sales set ubicacion='caja', caja=54 where id = ANY($1::uuid[])`, [ids54]);
  console.log(`caja 64: ${ids64.length} compras · caja 54: ${ids54.length} compras`);

  const { rows: fin } = await db.query(`
    select s.caja, count(*) productos
    from sale_items i join sales s on s.id = i.sale_id join clients c on c.id = s.client_id
    where c.instagram ilike $1 and i.delivery_status <> 'delivered'
      and i.paquete_booking_id is null and s.status not in ('cancelled','pending_payment')
    group by 1 order by 1`, [CLIENTA]);
  console.log("\nComo quedó:");
  for (const f of fin) console.log(`  caja ${f.caja ?? "(sin lugar)"} · ${f.productos} productos`);
} finally {
  await db.end();
}
