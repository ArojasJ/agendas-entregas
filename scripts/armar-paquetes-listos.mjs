import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// Liga a su entrega los paquetes que ya están armados físicamente, para que queden
// como PAQUETE ARMADO y, sobre todo, para que al marcarlos entregados los productos
// se enteren. Hasta hoy la entrega y los productos vivían separados.
//
// Cada pareja clienta↔entrega se revisó una por una contra la lista escrita en la
// tarjeta; no se adivina ninguna.

const BASE = process.env.BASE_URL || "https://www.norestecm.com";

// usuario de la ficha → entrega a la que se liga
const PAREJAS = [
  ["@rouch221",            "2026-11-05"], // la del 5 nov; la del 22 oct quedó no entregada
  ["@Frida.lrj",           "2026-11-05"],
  ["@aleegaboo",           "2026-03-05"], // lleva 8 meses agendada sin cerrarse
  ["@fernando_gonzalezrd", "2026-10-22"],
  ["@dgaytnn",             "2026-10-15"],
  ["@azu.saal",            "2026-08-28"], // tiene tres entregas repetidas del mismo set
  ["@marylurdz27",         "2026-11-12"],
  ["@daniaparicio09",      "2026-11-12"],
  ["@kpalaciosc_",         "2026-10-01"], // su entrega quedó escrita como @Kpalaciosc, sin guion
];

const ig = (s) => String(s || "").replace(/^@+/, "").replace(/\s+/g, "").toLowerCase();
const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const token = tokenDePrueba("admin", "Ajuste de cajas");

try {
  await db.connect();
  const clientes = (await db.query(`select id, name, instagram from clients`)).rows;
  const bookings = (await db.query(
    `select id, instagram, date, products from bookings
     where coalesce(delivery_status,'pendiente') in ('pendiente','no_entregado')`)).rows;

  for (const [usuario, fecha] of PAREJAS) {
    const c = clientes.find((x) => ig(x.instagram) === ig(usuario));
    if (!c) { console.log(`${usuario}  >> no existe la clienta`); continue; }

    // La entrega de esa fecha. El usuario se compara flojo porque en las tarjetas
    // viene escrito de cualquier forma; aun así tiene que empezar igual.
    const b = bookings.find(
      (x) => x.date.toISOString().slice(0, 10) === fecha &&
             (ig(x.instagram) === ig(usuario) ||
              ig(usuario).startsWith(ig(x.instagram)) ||
              ig(x.instagram).startsWith(ig(usuario)))
    );
    if (!b) { console.log(`${usuario}  >> no se encontró su entrega del ${fecha}`); continue; }

    const items = (await db.query(
      `select i.id, pr.name from sale_items i
       join sales s on s.id = i.sale_id join products pr on pr.id = i.product_id
       where s.client_id = $1 and i.delivery_status <> 'delivered'
         and i.paquete_booking_id is null
         and s.status not in ('cancelled','pending_payment')`, [c.id])).rows;

    if (!items.length) { console.log(`${usuario}  — ya estaba armado`); continue; }

    const res = await fetch(`${BASE}/api/panel/paquetes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-panel-token": token },
      body: JSON.stringify({
        accion: "armar", bookingId: b.id, clientId: c.id, itemIds: items.map((i) => i.id),
      }),
    });
    const d = await res.json();
    console.log(res.ok
      ? `${usuario}  — ${d.empacados} producto(s) en PAQUETE ARMADO, ligados a su entrega del ${fecha}`
      : `${usuario}  >> ERROR ${JSON.stringify(d)}`);
  }
} finally {
  await db.end();
}

// ── @bustosmartha, agregada después: su ficha dice @bustosmartha pero sus entregas
//    dicen @Bustos.martha (con punto), así que no casaban por usuario. Y su producto
//    está capturado como "BUFNDA", sin la A, así que tampoco casaba por nombre.
//    Se liga a mano a su entrega de bodega del 17 de agosto.
{
  const db2 = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await db2.connect();
    const c = (await db2.query(`select id from clients where instagram='@bustosmartha'`)).rows[0];
    const items = (await db2.query(
      `select i.id from sale_items i join sales s on s.id=i.sale_id
       where s.client_id=$1 and i.delivery_status<>'delivered' and i.paquete_booking_id is null
         and s.status not in ('cancelled','pending_payment')`, [c.id])).rows.map((r) => r.id);
    if (items.length) {
      const res = await fetch(`${BASE}/api/panel/paquetes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({
          accion: "armar",
          bookingId: "7cfe5eb2-dbe2-4d13-be3a-4d8cd24fd538",
          clientId: c.id, itemIds: items,
        }),
      });
      const d = await res.json();
      console.log(`@bustosmartha  — ${res.ok ? d.empacados + " producto(s) en PAQUETE ARMADO, ligados a su entrega del 2026-08-17" : "ERROR " + JSON.stringify(d)}`);
    } else {
      console.log("@bustosmartha  — ya estaba armado");
    }
  } finally { await db2.end(); }
}

// ── @amee_antunez: su entrega está escrita como "@Amee Antúnez" —con espacio y
//    acento— mientras su ficha dice @amee_antunez. Ni quitando espacios casaba.
//    Se liga a mano a su entrega de bodega del 28 de agosto.
{
  const db3 = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  try {
    await db3.connect();
    const c = (await db3.query(`select id from clients where instagram='@amee_antunez'`)).rows[0];
    const items = (await db3.query(
      `select i.id from sale_items i join sales s on s.id=i.sale_id
       where s.client_id=$1 and i.delivery_status<>'delivered' and i.paquete_booking_id is null
         and s.status not in ('cancelled','pending_payment')`, [c.id])).rows.map((r) => r.id);
    if (items.length) {
      const res = await fetch(`${BASE}/api/panel/paquetes`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({
          accion: "armar",
          bookingId: "f52fb720-2ab3-4ca9-a6b8-6f8b76e8a34a",
          clientId: c.id, itemIds: items,
        }),
      });
      const d = await res.json();
      console.log(`@amee_antunez  — ${res.ok ? d.empacados + " producto(s) en PAQUETE ARMADO, ligados a su entrega del 2026-08-28" : "ERROR " + JSON.stringify(d)}`);
    } else {
      console.log("@amee_antunez  — ya estaba armado");
    }
  } finally { await db3.end(); }
}
