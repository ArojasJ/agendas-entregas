import { Client } from "pg";

// @diianaiirmz tiene dos cajas, la 57 y la 59, así que sus 7 productos sin lugar no se
// podían deducir: había que ir a verlos. Ella los revisó y resultó que dos ni siquiera
// están en caja, están en el estante.
//
//   estante  · crossbody Steve Madden vainilla · tenis Reebok red
//   caja 57  · cosmetiquera Guess · mermelada + Torani de calabaza · calcetas Gaiam
//   caja 59  · tenis Reebok CTZ-Cheetaa
//
// La compra de la mermelada trae dos productos y se va entera a la 57: la ubicación se
// guarda por compra, no por producto, así que una compra partida entre dos lugares no
// se podría representar.

const CLIENTA = "@diianaiirmz";

// venta, dónde va, y el producto que debe contener para no escribir a ciegas
const DESTINOS = [
  ["ca9acf00-c239-42c5-8e61-b20f798cae68", "estante", null, ["CROSSBODY STEVE MADDEN VAINILLA CADENA DORADA"]],
  ["64f845bd-2703-46cf-a7c9-88e6b7cd9a6a", "estante", null, ["TENIS REEBOK RED"]],
  ["0d011463-a4e0-4eff-b902-e04965de19df", "caja", 57, ["COSMETIQUERA GUESS LIGHT SAGE"]],
  ["26e9d629-a4d6-467d-a27f-186e37d4b1ff", "caja", 57, ["MERMELADA SKINNY MIXES SABOR CALABAZA", "TORANI SABOR PASTEL DE CALABAZA"]],
  ["abfbb344-7b48-4f95-bbd4-8df55e83c4d1", "caja", 57, ["CALCETAS GAIAM 2PZAS CON ANTIDERRAPANTE BLANCO/GRIS"]],
  ["9532d8e3-b989-40b9-adcf-c5325337cd7c", "caja", 59, ["TENIS REEBOK CTZ-CHEETAA 3.5MX"]],
];

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();

  // Que cada venta sea la que se cree: un id pegado mal mandaría mercancía al lugar
  // equivocado sin que nadie lo notara.
  for (const [id, , , esperados] of DESTINOS) {
    const { rows } = await db.query(`
      select pr.name from sale_items i
      left join products pr on pr.id = i.product_id where i.sale_id = $1`, [id]);
    const hay = rows.map((r) => (r.name || "").trim().toUpperCase()).sort();
    const debe = [...esperados].sort();
    if (JSON.stringify(hay) !== JSON.stringify(debe)) {
      throw new Error(`la venta ${id} no contiene ${JSON.stringify(debe)} sino ${JSON.stringify(hay)}`);
    }
  }

  for (const [id, ubicacion, caja] of DESTINOS) {
    await db.query(`update sales set ubicacion = $2, caja = $3 where id = $1`, [id, ubicacion, caja]);
  }

  const { rows: fin } = await db.query(`
    select coalesce(s.ubicacion,'(sin lugar)') lugar, s.caja, count(*) productos
    from sale_items i join sales s on s.id = i.sale_id join clients c on c.id = s.client_id
    where c.instagram ilike $1 and i.delivery_status <> 'delivered'
      and i.paquete_booking_id is null and s.status not in ('cancelled','pending_payment')
    group by 1,2 order by 1,2`, [CLIENTA]);
  console.log("Como quedó:");
  for (const f of fin) console.log(`  ${f.lugar}${f.caja ? " " + f.caja : ""} · ${f.productos} productos`);
} finally {
  await db.end();
}
