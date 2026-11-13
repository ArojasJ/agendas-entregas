import { Client } from "pg";

// @hanny_luna29 arrastraba 39 productos pendientes desde el 30 de abril, que es la
// fecha de la carga del sistema anterior (ahí hay hasta dulces de San Valentín).
//
// Su entrega del 1 de septiembre llevó 12 productos, el más nuevo comprado el 31 de
// agosto. Todo eso y lo anterior ya está en su poder.
//
// A los 12 que vienen nombrados en el mensaje se les pone el 1 de septiembre. A los
// demás no: salieron en envíos anteriores de los que no quedó registro, y ponerles una
// fecha sería inventarla.

const DEL_ENVIO = [
  "BLUSA GUESS ROSA TALLA M",
  "FRAGANCIA COACH BLOSSOM 250 ML",
  "CONJUNTO 2 PZ CALVIN KLEIN YELLOW",
  "LAPICERAS ROSA/BLANCA",
  "SET PUMA T2 AZUL BEIGE",
  "COLORES CON BORRADOR CRAYOLA 24PZAS",
  "FOOD JARS BENTGO 6PZ",
  "TENIS TOMMY HILFIGER ROSAS",
  "BLUSA GUESS ROJA S",
  "TACONES DKNY BLACK 6.5 MX",
  "BOLSO DE VIAJE GUESS GRIS CON ROJO",
];

const limpio = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, " ");
const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();

  const pendientes = (await db.query(`
    select i.id, pr.name, s.created_at::date comprada
    from sale_items i
    join sales s on s.id = i.sale_id
    join products pr on pr.id = i.product_id
    join clients c on c.id = s.client_id
    where c.instagram = '@hanny_luna29'
      and i.delivery_status <> 'delivered'
      and s.status not in ('cancelled','pending_payment')
      and s.created_at::date <= date '2026-08-31'
    order by s.created_at`)).rows;

  const nombrados = new Set(DEL_ENVIO.map(limpio));
  const conFecha = pendientes.filter((p) => nombrados.has(limpio(p.name)));
  const sinFecha = pendientes.filter((p) => !nombrados.has(limpio(p.name)));

  await db.query(
    `update sale_items set delivery_status='delivered', delivered_by_name='Enviado por paquetería'
     where id = ANY($1::uuid[]) and delivery_status <> 'delivered'`,
    [pendientes.map((p) => p.id)]);
  await db.query(
    `update sale_items set delivered_at = timestamptz '2026-09-01 12:00:00-06' where id = ANY($1::uuid[])`,
    [conFecha.map((p) => p.id)]);
  await db.query(
    `update sale_items set delivered_at = null where id = ANY($1::uuid[])`,
    [sinFecha.map((p) => p.id)]);

  console.log(`${pendientes.length} productos marcados entregados:`);
  console.log(`  ${conFecha.length} del envío del 1 de septiembre, con esa fecha`);
  console.log(`  ${sinFecha.length} anteriores, sin fecha`);
} finally {
  await db.end();
}
