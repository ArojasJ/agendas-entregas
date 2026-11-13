import { Client } from "pg";

// Revisa una lista de clientas cuyos paquetes YA están armados físicamente, para
// ligarlos a su entrega y soltar las cajas. Solo informa; no escribe nada.
//
// Los usuarios se comparan sin arrobas, sin mayúsculas y sin espacios, porque en las
// entregas vienen escritos de cualquier forma.

// Dos venían con el usuario ligeramente distinto al de su ficha: "kpalaciosc" es
// @kpalaciosc_ (con guion bajo) y "dgaytann" es @dgaytnn.
const USUARIOS = [
  "kpalaciosc_", "rouch221", "Frida.lrj", "aleegaboo", "fernando_gonzalezrd", "dgaytnn",
  "bustosmartha", "amee_antunez", "azu.saal", "Magda.favela", "marylurdz27", "daniaparicio09",
];

const ig = (s) => String(s || "").replace(/^@+/, "").replace(/\s+/g, "").toLowerCase();
const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();

  const clientes = (await db.query(`select id, name, instagram, box_1, box_2 from clients`)).rows;
  const bookings = (await db.query(`
    select id, instagram, type, date, delivery_status, amount_due, products,
           jsonb_array_length(to_jsonb(sale_item_ids)) ligados
    from bookings
    where coalesce(delivery_status,'pendiente') in ('pendiente','no_entregado')
    order by date desc`)).rows;

  for (const u of USUARIOS) {
    const c = clientes.find((x) => ig(x.instagram) === ig(u));
    if (!c) { console.log(`\n@${u}  >> NO EXISTE esa clienta en el sistema`); continue; }

    const items = (await db.query(`
      select i.id, pr.name, i.paquete_booking_id, s.ubicacion, s.caja, s.id venta,
             s.total - s.down_payment
               - coalesce((select sum(p.amount) from payments p where p.sale_id = s.id), 0) debe
      from sale_items i
      join sales s on s.id = i.sale_id
      join products pr on pr.id = i.product_id
      where s.client_id = $1 and i.delivery_status <> 'delivered'
        and s.status not in ('cancelled','pending_payment')
      order by s.created_at`, [c.id])).rows;

    const bks = bookings.filter((b) => ig(b.instagram) === ig(u));
    const porVenta = new Map(items.map((i) => [i.venta, Number(i.debe)]));
    const deuda = [...porVenta.values()].reduce((a, b) => a + Math.max(0, b), 0);

    console.log(`\n@${u}  (${c.name.trim()})  ficha: ${c.box_1 || "sin cajas"}  pendientes: ${items.length}  debe: $${deuda}`);
    if (!bks.length) console.log("   >> sin entrega pendiente ni no entregada");
    for (const b of bks) {
      const lista = String(b.products || "(sin lista escrita)").split("\n").filter(Boolean).join(" | ");
      console.log(`   entrega ${b.date.toISOString().slice(0, 10)} ${b.type} [${b.delivery_status || "pendiente"}] cobrar $${b.amount_due} ligados:${b.ligados}`);
      console.log(`      ${lista}`);
    }
    for (const i of items) {
      const donde = i.ubicacion === "caja" ? `caja ${i.caja}` : i.ubicacion || "sin lugar";
      console.log(`     - ${i.name.trim()}  [${donde}]${i.paquete_booking_id ? " (ya en paquete)" : ""}`);
    }
  }
} finally {
  await db.end();
}
