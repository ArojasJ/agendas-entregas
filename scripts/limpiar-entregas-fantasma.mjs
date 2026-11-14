import { Client } from "pg";

// Entregas duplicadas que quedaron colgadas.
//
// El patrón: se agenda una entrega, no sale ese día, y en vez de moverle la fecha se
// agenda otra. La nueva sale y se marca entregada; la vieja se queda "pendiente" para
// siempre porque nadie se acuerda de que existe.
//
// Se limpian dos grupos distintos, y con cuidados distintos:
//
//   A) La gemela YA SE ENTREGÓ. El pedido salió; este registro es un fantasma. Su
//      amount_due no es dinero en riesgo: ese campo no entra en cortes ni en reportes,
//      es la instrucción de cuánto cobrarle al repartidor, y ese momento ya pasó.
//      Se borra.
//
//   B) NINGUNA se entregó. El pedido sigue sin salir, así que una tiene que
//      sobrevivir: se queda la más reciente. Si el cobro estaba en una de las que se
//      van, se le pasa a la que se queda; ahí sí importa, porque esa entrega todavía
//      va a ocurrir. Es lo que pasó con @yucelaylin.
//
// Nunca se borra una entrega con productos adentro: eso desarmaría un paquete sin que
// nadie se entere. Y nunca se toca la gemela entregada.
//
// Sin argumentos solo enseña el plan. Con --aplicar lo escribe.

const APLICAR = process.argv.includes("--aplicar");

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const vacia = (b) => Number(b.en_paquete) === 0 && Number(b.ligados) === 0;

try {
  await db.connect();

  // ── A) fantasmas: la gemela ya se entregó ──
  const { rows: fantasmas } = await db.query(`
    select b.id, b.date::date fecha, b.type, coalesce(b.instagram,b."fullName") quien,
           coalesce(b.amount_due,0) envio,
           (select count(*) from sale_items i where i.paquete_booking_id = b.id) en_paquete,
           jsonb_array_length(coalesce(b.sale_item_ids,'[]'::jsonb)) ligados
    from bookings b
    where coalesce(b.delivery_status,'pendiente') = 'pendiente'
      and b.date < current_date
      and b.phone is not null and b.phone <> ''
      and exists (select 1 from bookings g where g.id <> b.id and g.phone = b.phone
                    and g.products = b.products and g.delivery_status = 'entregado')
    order by b.date`);

  const borrablesA = fantasmas.filter(vacia);
  const conProductoA = fantasmas.filter((b) => !vacia(b));
  console.log(`A) Fantasmas (la gemela ya se entregó): ${fantasmas.length}`);
  console.log(`   se borran: ${borrablesA.length}`);
  if (conProductoA.length) console.log(`   NO se tocan por traer productos adentro: ${conProductoA.length}`);

  // ── B) duplicadas donde ninguna salió ──
  const { rows: pendientes } = await db.query(`
    select b.id, b.date::date fecha, b.date orden, b.type, b.phone, b.products,
           coalesce(b.instagram,b."fullName") quien, coalesce(b.amount_due,0) envio,
           (select count(*) from sale_items i where i.paquete_booking_id = b.id) en_paquete,
           jsonb_array_length(coalesce(b.sale_item_ids,'[]'::jsonb)) ligados
    from bookings b
    where coalesce(b.delivery_status,'pendiente') = 'pendiente'
      and b.phone is not null and b.phone <> ''
      and not exists (select 1 from bookings g where g.id <> b.id and g.phone = b.phone
                        and g.products = b.products and g.delivery_status = 'entregado')
      and exists (select 1 from bookings g where g.id <> b.id and g.phone = b.phone
                    and g.products = b.products)
    order by b.date`);

  const grupos = new Map();
  for (const b of pendientes) {
    const k = b.phone + "||" + b.products;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(b);
  }

  const borrablesB = [];
  const cobrosAPasar = [];
  for (const lista of grupos.values()) {
    if (lista.length < 2) continue;
    // Se queda la más reciente; si empatan, la que tenga el cobro.
    const ordenadas = [...lista].sort((a, b) =>
      new Date(b.orden) - new Date(a.orden) || Number(b.envio) - Number(a.envio));
    const sobrevive = ordenadas[0];
    for (const b of ordenadas.slice(1)) {
      if (!vacia(b)) continue;               // con productos adentro no se toca
      if (Number(b.envio) > 0 && Number(sobrevive.envio) === 0) {
        cobrosAPasar.push({ de: b, a: sobrevive, monto: Number(b.envio) });
      }
      borrablesB.push(b);
    }
  }
  console.log(`\nB) Duplicadas sin entregar: ${pendientes.length} en ${grupos.size} grupos`);
  console.log(`   se borran (sobrevive la más reciente de cada grupo): ${borrablesB.length}`);
  console.log(`   cobros que se pasan a la que sobrevive: ${cobrosAPasar.length}  ($${cobrosAPasar.reduce((s, c) => s + c.monto, 0)})`);
  for (const c of cobrosAPasar)
    console.log(`     $${c.monto} de ${c.de.fecha.toISOString().slice(0, 10)} -> ${c.a.fecha.toISOString().slice(0, 10)}  ${c.a.quien}`);

  const total = borrablesA.length + borrablesB.length;
  console.log(`\n   TOTAL A BORRAR: ${total} entregas fantasma`);

  if (!APLICAR) {
    console.log("\n   Esto es solo el plan. Para escribirlo: --aplicar");
  } else {
    for (const c of cobrosAPasar) {
      await db.query(`update bookings set amount_due = $2 where id = $1 and coalesce(amount_due,0) = 0`,
        [c.a.id, c.monto]);
    }
    const ids = [...borrablesA, ...borrablesB].map((b) => b.id);
    // Última red: que ninguna haya adquirido productos entre el plan y el borrado.
    const { rows: ocupadas } = await db.query(
      `select distinct paquete_booking_id id from sale_items where paquete_booking_id = ANY($1::uuid[])`, [ids]);
    const seguras = ids.filter((i) => !ocupadas.some((o) => o.id === i));
    if (seguras.length !== ids.length)
      console.log(`   ${ids.length - seguras.length} se saltaron: adquirieron productos.`);

    await db.query(`delete from bookings where id = ANY($1::uuid[])`, [seguras]);
    console.log(`\n   ${seguras.length} entregas fantasma borradas.`);

    const { rows: q } = await db.query(`
      select count(*)::int n from bookings b
      where coalesce(b.delivery_status,'pendiente')='pendiente' and b.date < current_date
        and b.phone is not null and b.phone <> ''
        and exists (select 1 from bookings g where g.id <> b.id and g.phone = b.phone and g.products = b.products)`);
    console.log(`   Quedan ${q[0].n} pendientes duplicadas.`);
  }
} finally {
  await db.end();
}
