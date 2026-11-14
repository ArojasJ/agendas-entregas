import { Client } from "pg";

// Productos que esperan a su clienta y cuya venta no dice dónde están, pero la ficha
// de la clienta trae UNA sola caja. Ahí la caja no se adivina: se deduce. Si su ficha
// dice caja 12 y es la única que tiene, lo que le espera está en la 12.
//
// Sin esto esos productos salen como "Sin lugar" al armarle el paquete, y el sistema
// tampoco avisa qué caja se libera al empacarlos, porque no los tiene amarrados a
// ninguna. La caja ya contaba como ocupada por la ficha; lo que falta es saber QUÉ
// hay dentro.
//
// Las clientas con DOS cajas quedan fuera a propósito: ahí no hay forma de saber en
// cuál está cada cosa y sellarlo sería inventar. Esas se ven una por una.
//
// Sin argumentos solo enseña el plan. Con --aplicar lo escribe.

const APLICAR = process.argv.includes("--aplicar");

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const cajasDe = (box1, box2) => {
  const texto = `${box1 || ""},${box2 || ""}`;
  return [...new Set((texto.match(/\d+/g) || []).map(Number))].sort((a, b) => a - b);
};

try {
  await db.connect();

  const { rows: fichas } = await db.query(`
    select id, name, instagram, box_1, box_2 from clients
    where box_1 is not null or box_2 is not null`);

  const unaSola = [];
  const variasCajas = [];
  for (const f of fichas) {
    const cajas = cajasDe(f.box_1, f.box_2);
    if (cajas.length === 1) unaSola.push({ ...f, caja: cajas[0] });
    else if (cajas.length > 1) variasCajas.push({ ...f, cajas });
  }

  let totalVentas = 0, totalProductos = 0;
  const plan = [];

  for (const f of unaSola) {
    // Solo las ventas que de verdad tienen algo esperando y sin lugar. Una venta ya
    // entregada por completo no se toca: su lugar dejó de importar y escribirlo sería
    // decir que hay mercancía guardada donde ya no hay nada.
    const { rows: ventas } = await db.query(`
      select s.id,
             (select count(*) from sale_items i
               where i.sale_id = s.id
                 and i.delivery_status <> 'delivered'
                 and i.paquete_booking_id is null) esperando
      from sales s
      where s.client_id = $1
        and s.ubicacion is null
        and s.status not in ('cancelled','pending_payment')`, [f.id]);

    const conPendientes = ventas.filter((v) => Number(v.esperando) > 0);
    if (conPendientes.length === 0) continue;

    const productos = conPendientes.reduce((s, v) => s + Number(v.esperando), 0);
    totalVentas += conPendientes.length;
    totalProductos += productos;
    plan.push({
      quien: f.instagram || f.name,
      caja: f.caja,
      ventas: conPendientes.map((v) => v.id),
      productos,
    });
  }

  plan.sort((a, b) => b.productos - a.productos);
  for (const p of plan) {
    console.log(`  caja ${String(p.caja).padStart(3)} · ${String(p.productos).padStart(2)} producto(s) · ${p.quien}`);
  }
  console.log(`\n${totalProductos} productos en ${totalVentas} ventas de ${plan.length} clientas.`);

  if (variasCajas.length) {
    const pend = [];
    for (const f of variasCajas) {
      const { rows } = await db.query(`
        select count(*)::int n from sale_items i
        join sales s on s.id = i.sale_id
        where s.client_id = $1 and s.ubicacion is null
          and s.status not in ('cancelled','pending_payment')
          and i.delivery_status <> 'delivered' and i.paquete_booking_id is null`, [f.id]);
      if (rows[0].n > 0) pend.push(`${f.instagram || f.name} (cajas ${f.cajas.join(" y ")}): ${rows[0].n}`);
    }
    if (pend.length) {
      console.log(`\nFuera, por tener más de una caja —hay que verlas una por una:`);
      for (const p of pend) console.log("  " + p);
    }
  }

  if (!APLICAR) {
    console.log("\nEsto es solo el plan. Para escribirlo: --aplicar");
  } else {
    for (const p of plan) {
      await db.query(
        `update sales set ubicacion = 'caja', caja = $2 where id = ANY($1::uuid[])`,
        [p.ventas, p.caja]);
    }
    console.log(`\nSellado. ${totalVentas} ventas quedaron con su caja anotada.`);

    const { rows: q } = await db.query(`
      select count(*)::int n from sale_items i
      join sales s on s.id = i.sale_id
      join clients c on c.id = s.client_id
      where s.status not in ('cancelled','pending_payment')
        and i.delivery_status <> 'delivered' and i.paquete_booking_id is null
        and s.ubicacion is null and (c.box_1 is not null or c.box_2 is not null)`);
    console.log(`Quedan ${q[0].n} productos sin lugar cuya clienta sí tiene caja.`);
  }
} finally {
  await db.end();
}
