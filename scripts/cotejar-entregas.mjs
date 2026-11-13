import { Client } from "pg";

// Cruza los productos que siguen marcados como pendientes contra las entregas que YA
// están marcadas como entregadas, buscando el nombre del producto en la lista que la
// entrega tiene escrita. Durante meses las entregas no quedaban ligadas a los
// productos, así que marcarlas no movía nada: de ahí vienen los 1,167 pendientes.
//
// Reglas, a propósito estrictas: más vale dejar algo pendiente que darlo por
// entregado sin estarlo.
//   · El nombre tiene que coincidir COMPLETO, no parecerse.
//   · La entrega tiene que ser de la misma clienta.
//   · La entrega no puede ser anterior a la compra.
//   · Cada renglón cubre tantos productos como diga su cantidad: "1xGEL" justifica
//     uno, "30xGEL" hasta treinta. En la primera pasada esto no se leía y un renglón
//     valía por uno solo, así que de los 15 geles de @martinez_cinthya —que su
//     entrega listaba como 30— se marcó uno nada más.
//
// Por omisión solo informa. Con --aplicar escribe los cambios.

const APLICAR = process.argv.includes("--aplicar");
const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const limpio = (s) =>
  String(s || "").replace(/^\s*\d+\s*[xX]\s*/, "").trim().toUpperCase().replace(/\s+/g, " ");
// El usuario se compara sin arrobas, sin mayúsculas y SIN ESPACIOS. Hay 1,786
// entregas con el usuario escrito distinto al de la ficha —"@Fernandaorozco _" en
// vez de "@fernandaorozco_"— y sin quitar los espacios no se reconocían como de la
// misma clienta. Los puntos sí se respetan: en Instagram distinguen (magda.favela).
const ig = (s) => String(s || "").replace(/^@+/, "").replace(/\s+/g, "").toLowerCase();

try {
  await db.connect();

  const pendientes = (await db.query(`
    select i.id, pr.name producto, s.created_at comprada, s.client_id, s.id "saleId",
           c.instagram, c.name clienta, s.ubicacion, s.caja
    from sale_items i
    join sales s on s.id = i.sale_id
    join products pr on pr.id = i.product_id
    join clients c on c.id = s.client_id
    where i.delivery_status <> 'delivered'
      and s.status not in ('cancelled','pending_payment')
      -- Lo que ya está en un paquete armado no se toca: su suerte va atada a esa
      -- entrega y se marcará cuando salga, no por parecido con una entrega vieja.
      and i.paquete_booking_id is null
    order by s.created_at`)).rows;

  const entregas = (await db.query(`
    select id, instagram, type, date, products
    from bookings
    where delivery_status = 'entregado' and products is not null
    order by date`)).rows;

  // Las entregas agrupadas por clienta, y cada renglón disponible una sola vez.
  const porClienta = new Map();
  for (const b of entregas) {
    const k = ig(b.instagram);
    if (!k) continue;
    if (!porClienta.has(k)) porClienta.set(k, []);
    for (const linea of String(b.products).split("\n")) {
      const n = limpio(linea);
      if (!n) continue;
      // "30xGEL…" cubre hasta 30 productos; sin cantidad, uno.
      const m = String(linea).match(/^\s*(\d+)\s*[xX]\s*/);
      const cupo = m ? Math.min(Number(m[1]), 200) : 1;
      porClienta.get(k).push({ nombre: n, fecha: b.date, tipo: b.type, bookingId: b.id, cupo });
    }
  }

  const casan = [];
  const quedan = [];
  for (const p of pendientes) {
    const renglones = porClienta.get(ig(p.instagram)) || [];
    const r = renglones.find(
      (x) => x.cupo > 0 && x.nombre === limpio(p.producto) && new Date(x.fecha) >= new Date(p.comprada.toISOString().slice(0, 10))
    );
    if (r) { r.cupo -= 1; casan.push({ ...p, fecha: r.fecha, tipo: r.tipo, bookingId: r.bookingId }); }
    else quedan.push(p);
  }

  // ── Segunda regla: por orden de compra ──
  //
  // Si a una clienta le entregaron algo que compró DESPUÉS, lo de antes ya salió.
  // No es posible que se lleve lo del día 15 y deje en la bodega lo del día 10.
  //
  // La condición que lo vuelve seguro: la compra vieja tiene que estar PAGADA. Si
  // debía, sí cabe que le entregaran solo lo liquidado y lo otro se quedara. Por eso
  // una compra con saldo nunca entra por aquí.
  const entregadoDespues = new Map(); // clienta → fecha de la compra entregada más reciente
  for (const r of (await db.query(`
      select s.client_id, max(s.created_at::date) ultima
      from sale_items i join sales s on s.id = i.sale_id
      where i.delivery_status = 'delivered' and s.status not in ('cancelled','pending_payment')
      group by s.client_id`)).rows) {
    entregadoDespues.set(r.client_id, r.ultima);
  }

  const deudaPorVenta = new Map();
  for (const r of (await db.query(`
      select s.id, s.total - s.down_payment
             - coalesce((select sum(p.amount) from payments p where p.sale_id = s.id), 0) debe
      from sales s where s.status not in ('cancelled','pending_payment')`)).rows) {
    deudaPorVenta.set(r.id, Number(r.debe));
  }

  const porOrden = [];
  const restantes = [];
  for (const q of quedan) {
    const ultima = entregadoDespues.get(q.client_id);
    const pagada = (deudaPorVenta.get(q.saleId) ?? 1) <= 0;
    const comprada = q.comprada.toISOString().slice(0, 10);
    if (pagada && ultima && ultima.toISOString().slice(0, 10) > comprada) {
      porOrden.push({ ...q, referencia: ultima });
    } else {
      restantes.push(q);
    }
  }

  const porTipo = {};
  for (const c of casan) porTipo[c.tipo] = (porTipo[c.tipo] || 0) + 1;

  console.log(`PENDIENTES HOY:                    ${pendientes.length}`);
  console.log(`1) casan con una entrega hecha:    ${casan.length}  (${Object.entries(porTipo).map(([t, n]) => `${t}: ${n}`).join(" · ")})`);
  console.log(`2) pagados, y se le entregó algo`);
  console.log(`   que compró después:             ${porOrden.length}  (${new Set(porOrden.map((c) => c.instagram)).size} clientas)`);
  console.log(`QUEDARÍAN PENDIENTES:              ${restantes.length}`);

  const todos = [...casan, ...porOrden];
  const cajasQueSeSueltan = new Set(
    todos.filter((c) => c.ubicacion === "caja" && c.caja != null).map((c) => Number(c.caja))
  );
  const cajasQueSiguen = new Set(
    restantes.filter((c) => c.ubicacion === "caja" && c.caja != null).map((c) => Number(c.caja))
  );
  const libera = [...cajasQueSeSueltan].filter((n) => !cajasQueSiguen.has(n)).sort((a, b) => a - b);
  console.log(`CAJAS que quedarían libres:  ${libera.length ? libera.join(", ") : "ninguna"}`);

  console.log("\n— Muestra de 12 que casan —");
  for (const c of casan.slice(0, 12)) {
    console.log(`  ${(c.instagram || "").padEnd(20)} ${c.producto.slice(0, 44).padEnd(45)} entregado ${c.fecha.toISOString().slice(0, 10)} (${c.tipo})`);
  }

  console.log("\n— Muestra de 10 por orden de compra —");
  for (const c of porOrden.slice(0, 10)) {
    console.log(`  ${(c.instagram || "").padEnd(20)} ${c.producto.slice(0, 38).padEnd(39)} comprado ${c.comprada.toISOString().slice(0, 10)}, se le entregó algo del ${c.referencia.toISOString().slice(0, 10)}`);
  }

  console.log("\n— Lo que quedaría pendiente, por antigüedad —");
  const porAnio = {};
  for (const q of restantes) {
    const m = q.comprada.toISOString().slice(0, 7);
    porAnio[m] = (porAnio[m] || 0) + 1;
  }
  for (const [mes, n] of Object.entries(porAnio).sort()) console.log(`  ${mes}: ${n}`);

  if (!APLICAR) {
    console.log("\n(Sin aplicar. Corre con --aplicar para escribirlo.)");
  } else {
    // Antes de escribir, queda guardado qué se va a tocar. Son cientos de renglones
    // de producción: sin esta lista no habría forma de deshacerlo.
    const { writeFileSync } = await import("node:fs");
    const bitacora = `scripts/cotejado-${new Date().toISOString().slice(0, 10)}.json`;
    writeFileSync(bitacora, JSON.stringify(
      todos.map((c) => ({ item: c.id, producto: c.producto, clienta: c.instagram, fecha: c.fecha || null })), null, 1));
    console.log(`\nRespaldo de lo que se va a tocar: ${bitacora}`);

    let n = 0;
    for (const c of casan) {
      await db.query(
        `update sale_items set delivery_status='delivered', delivered_by_name='Cotejado con su entrega'
         where id=$1 and delivery_status<>'delivered'`, [c.id]);
      // La fecha de la entrega en la que salió, no la de hoy.
      await db.query(`update sale_items set delivered_at=$1 where id=$2`, [c.fecha, c.id]);
      n++;
    }

    let m = 0;
    for (const c of porOrden) {
      await db.query(
        `update sale_items set delivery_status='delivered', delivered_by_name='Deducido por compras posteriores'
         where id=$1 and delivery_status<>'delivered'`, [c.id]);
      // Aquí NO se sabe el día: solo que fue antes de esa otra entrega. Se deja en
      // blanco, que es lo honesto, en vez de ponerle la fecha de hoy.
      await db.query(`update sale_items set delivered_at=null where id=$1`, [c.id]);
      m++;
    }
    console.log(`\nAPLICADO: ${n} por su entrega (con fecha) + ${m} por orden de compra (sin fecha) = ${n + m}`);
  }
} catch (e) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
