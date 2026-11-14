import { Client } from "pg";

// Entregas de bodega, paquetería y florería cuya fecha ya pasó y siguen "pendientes":
// la clienta nunca vino, o el paquete nunca salió, y nadie las cerró. Se quedan ahí
// para siempre ensuciando las listas y haciendo que el trabajo pendiente se vea más
// grande de lo que es.
//
// Pasan a "no entregado", que es lo que de verdad ocurrió.
//
// Esto SOLO es seguro desde que la penalización mira el tipo de entrega. El doble
// cobro de envío se dispara con un "no entregado", y antes contaba todos los tipos:
// marcar estas 326 le hubiera cobrado $90 a 120 clientas de golpe por no haber pasado
// a recoger a bodega, que nunca fue la política. Ahora solo cuenta un domicilio
// fallido, que es el viaje que de verdad se perdió.
//
// Los DOMICILIOS viejos quedan fuera a propósito: ahí marcar sí le cuesta dinero a una
// clienta real, y mirándolos de cerca no son intentos fallidos sino rutas que nadie
// cerró —once el mismo día, cuatro al siguiente—. Esos se revisan a mano.
//
// Sin argumentos solo enseña el plan. Con --aplicar lo escribe.

const APLICAR = process.argv.includes("--aplicar");
const TIPOS = ["bodega", "paqueteria", "floreria"];

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();

  const { rows } = await db.query(`
    select b.id, b.type, b.date::date fecha,
           (select count(*) from sale_items i where i.paquete_booking_id = b.id) productos
    from bookings b
    where coalesce(b.delivery_status,'pendiente') = 'pendiente'
      and b.date < current_date
      and b.type = ANY($1::text[])
    order by b.date`, [TIPOS]);

  // Una entrega con un paquete armado adentro NO se archiva: ese paquete está hecho y
  // esperando a salir. Cerrarla diría que no se entregó algo que todavía va a salir.
  const archivables = rows.filter((r) => Number(r.productos) === 0);
  const conPaquete = rows.filter((r) => Number(r.productos) > 0);

  const porTipo = new Map();
  for (const r of archivables) porTipo.set(r.type, (porTipo.get(r.type) || 0) + 1);

  console.log(`Pendientes viejas de ${TIPOS.join(", ")}: ${rows.length}`);
  for (const [t, n] of porTipo) console.log(`   ${t}: ${n}`);
  if (conPaquete.length)
    console.log(`\n   ${conPaquete.length} NO se tocan: tienen un paquete armado adentro, esperando a salir.`);
  console.log(`\n   se archivan como "no entregado": ${archivables.length}`);

  if (!APLICAR) {
    console.log("\n   Esto es solo el plan. Para escribirlo: --aplicar");
  } else {
    await db.query(
      `update bookings set delivery_status = 'no_entregado' where id = ANY($1::uuid[])`,
      [archivables.map((r) => r.id)]);
    console.log(`\n   ${archivables.length} entregas archivadas.`);

    const { rows: quedan } = await db.query(`
      select b.type, count(*)::int n from bookings b
      where coalesce(b.delivery_status,'pendiente')='pendiente' and b.date < current_date
      group by 1 order by 2 desc`);
    console.log("\n   Pendientes viejas que quedan:");
    for (const x of quedan) console.log(`      ${x.type}: ${x.n}`);
  }
} finally {
  await db.end();
}
