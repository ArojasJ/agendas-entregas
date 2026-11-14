import { Client } from "pg";

// @yucelaylin tenía la MISMA entrega de paquetería agendada dos veces: el 12 y el 13
// de noviembre, mismo teléfono y los mismos dos productos, que es todo lo que tiene
// esperando. Se volvió a agendar hoy porque ayer no salió.
//
// La que se queda es la del 13, que es la que ya tiene el paquete armado con sus dos
// productos adentro. Pero el cobro del envío quedó en la de ayer, así que primero se
// le pasa a la de hoy: borrarla sin más perdía los $145.

const VIEJA = "07bff498-e936-4313-aed7-2cc0daf37901"; // 12-nov, duplicada, sin paquete
const BUENA = "9f6e31bb-f063-40a4-aee0-7a81e602d55c"; // 13-nov, armada con 2 productos

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();

  // La misma guarda que pide la pantalla: una entrega con productos adentro no se
  // borra, porque eso desarmaría el paquete sin que nadie se entere.
  const { rows: dentro } = await db.query(
    `select count(*)::int n from sale_items where paquete_booking_id = $1`, [VIEJA]);
  if (dentro[0].n > 0) {
    throw new Error(`la entrega vieja tiene ${dentro[0].n} productos adentro, no se borra`);
  }

  const { rows: v } = await db.query(`select amount_due from bookings where id = $1`, [VIEJA]);
  if (!v.length) {
    console.log("La entrega duplicada ya no existe.");
  } else {
    const envio = Number(v[0].amount_due || 0);
    if (envio > 0) {
      // Solo si la de hoy no trae ya un cobro propio, para no pisarlo.
      await db.query(
        `update bookings set amount_due = $2 where id = $1 and coalesce(amount_due,0) = 0`,
        [BUENA, envio]);
      console.log(`Envío de $${envio} pasado a la entrega del 13-nov.`);
    }
    await db.query(`delete from bookings where id = $1`, [VIEJA]);
    console.log("Entrega duplicada del 12-nov borrada.");
  }

  const { rows: fin } = await db.query(`
    select date::date, amount_due, delivery_status,
           (select count(*) from sale_items i where i.paquete_booking_id = b.id) productos
    from bookings b where instagram ilike '%yucelaylin%' order by date`);
  console.log("\nComo quedó:");
  for (const f of fin) console.log("  " + JSON.stringify(f));
} finally {
  await db.end();
}
