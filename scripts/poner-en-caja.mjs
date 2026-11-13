import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// Anota en una caja —o en el estante— todo lo que a una clienta le queda pendiente
// y sin lugar.
//
//   node scripts/poner-en-caja.mjs @usuario 72        [--aplicar]
//   node scripts/poner-en-caja.mjs @usuario estante   [--aplicar]
//
// Va por la misma puerta que el panel, así que la ficha de la clienta se sincroniza
// sola y la caja queda ocupada con las mismas reglas de siempre.
//
// Avisa de dos cosas antes de escribir: si la caja la trae otra clienta, y si alguna
// de esas compras arrastra productos ya entregados —el lugar se guarda por venta
// completa, así que conviene saberlo.

const APLICAR = process.argv.includes("--aplicar");
const [usuario, lugarTxt] = process.argv.slice(2).filter((a) => a !== "--aplicar");
const alEstante = String(lugarTxt || "").toLowerCase() === "estante";
const caja = alEstante ? null : Number(lugarTxt);

if (!usuario || (!alEstante && (!Number.isInteger(caja) || caja <= 0))) {
  console.error("Uso: node scripts/poner-en-caja.mjs @usuario 72|estante [--aplicar]");
  process.exit(1);
}
const destino = alEstante ? { tipo: "estante" } : { tipo: "caja", caja };
const comoSeLlama = alEstante ? "el estante" : `la caja ${caja}`;

const BASE = process.env.BASE_URL || "https://www.norestecm.com";
const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();

  const cliente = (await db.query(
    `select id, name, box_1 from clients where instagram = $1`, [usuario])).rows[0];
  if (!cliente) { console.error("No existe esa clienta"); process.exit(1); }

  const ventas = (await db.query(`
    select s.id,
           (select count(*) from sale_items x where x.sale_id = s.id
              and x.delivery_status <> 'delivered' and x.paquete_booking_id is null) pendientes,
           (select count(*) from sale_items x where x.sale_id = s.id
              and x.delivery_status = 'delivered') ya_entregados
    from sales s
    where s.client_id = $1 and s.ubicacion is null
      and s.status not in ('cancelled','pending_payment')
      and exists (select 1 from sale_items i where i.sale_id = s.id
                  and i.delivery_status <> 'delivered' and i.paquete_booking_id is null)`,
    [cliente.id])).rows;

  if (ventas.length === 0) { console.log(`${usuario}: no le queda nada sin ubicar.`); process.exit(0); }

  const otra = alEstante ? null : (await db.query(`
    select c.instagram from clients c
    join sales s on s.client_id = c.id
    where c.id <> $1 and s.ubicacion = 'caja' and s.caja::int = $2
      and s.status not in ('cancelled','pending_payment')
      and exists (select 1 from sale_items i where i.sale_id = s.id
                  and i.delivery_status <> 'delivered' and i.paquete_booking_id is null)
    limit 1`, [cliente.id, caja])).rows[0];
  if (otra) console.log(`  AVISO: la caja ${caja} ya tiene mercancía de ${otra.instagram}`);

  const conEntregados = ventas.filter((v) => Number(v.ya_entregados) > 0).length;
  if (conEntregados > 0) {
    console.log(`  AVISO: ${conEntregados} de esas compras traen también productos ya entregados`);
  }

  const total = ventas.reduce((s, v) => s + Number(v.pendientes), 0);
  console.log(`${usuario} (${cliente.name.trim()}): ${total} productos en ${ventas.length} compras → ${comoSeLlama}`);

  if (!APLICAR) { console.log("\n(Sin aplicar. Agrega --aplicar para escribirlo.)"); }
  else {
    const res = await fetch(`${BASE}/api/panel/ubicacion`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("admin", "Ajuste de cajas") },
      body: JSON.stringify({ saleIds: ventas.map((v) => v.id), ...destino }),
    });
    if (!res.ok) { console.error("ERROR " + res.status + ": " + (await res.text()).slice(0, 150)); process.exit(1); }

    const fin = (await db.query(`
      select coalesce(s.ubicacion,'sin lugar') donde, s.caja, count(*) productos
      from sale_items i join sales s on s.id = i.sale_id
      where s.client_id = $1 and i.delivery_status <> 'delivered'
        and s.status not in ('cancelled','pending_payment')
      group by 1, 2 order by 3 desc`, [cliente.id])).rows;
    const ficha = (await db.query(`select box_1 from clients where id = $1`, [cliente.id])).rows[0].box_1;

    console.log("\nAPLICADO. Le queda:");
    for (const f of fin) console.log(`  ${f.productos} producto(s) en ${f.donde}${f.caja ? " " + f.caja : ""}`);
    console.log(`  su ficha: ${ficha || "sin cajas"}`);
  }
} finally {
  await db.end();
}
