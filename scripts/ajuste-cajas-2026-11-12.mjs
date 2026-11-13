import { Client } from "pg";

// Corrección puntual del 12 de noviembre de 2026, revisando caja por caja contra la
// bodega física. Queda escrito para que se sepa qué se tocó y por qué.
//
// @becky      — cajas 78 y 79: no había ninguna venta adentro, solo la ficha. Sus
//               productos ya se habían entregado y nadie los marcó. Se marcan
//               entregados AUNQUE NO ESTÉN PAGADOS: la deuda no se toca.
// @magdaagomez— cajas 5, 19 y 42: su envío de paquetería del 6 de noviembre ya salió
//               y la entrega estaba marcada como entregada, pero sin los productos
//               ligados. Se ligan y quedan como PAQUETE ARMADO; las 3 cajas se sueltan.
//
// @dominnik.s (caja 44) NO se toca: ahí hay algo que revisar antes.
//
// Se puede correr otra vez sin hacer daño: lo ya marcado no se vuelve a marcar.

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const out = [];

try {
  await db.connect();

  // ── @becky ──
  const becky = (await db.query(`select id, box_1, box_2 from clients where instagram='@becky'`)).rows[0];
  if (!becky) throw new Error("no se encontró @becky");

  const pendientes = await db.query(
    `select count(*) n from sale_items i join sales s on s.id=i.sale_id
     where s.client_id=$1 and i.delivery_status<>'delivered'
       and s.status not in ('cancelled','pending_payment')`, [becky.id]);

  // La fecha la pone el disparador; el nombre dice que fue un ajuste y no una persona,
  // para no atribuirle a nadie una entrega que no hizo.
  await db.query(`
    update sale_items i set delivery_status='delivered', delivered_by_name='Ajuste de cajas'
    from sales s
    where s.id=i.sale_id and s.client_id=$1 and i.delivery_status<>'delivered'
      and s.status not in ('cancelled','pending_payment')`, [becky.id]);
  await db.query(`update clients set box_1=null, box_2=null where id=$1`, [becky.id]);

  const deuda = await db.query(
    `select coalesce(sum(s.total - s.down_payment
       - coalesce((select sum(p.amount) from payments p where p.sale_id=s.id),0)),0) debe
     from sales s where s.client_id=$1 and s.status='credit'`, [becky.id]);

  out.push(`@becky — ${pendientes.rows[0].n} productos marcados entregados`);
  out.push(`        cajas ${becky.box_1}${becky.box_2 ? " y " + becky.box_2 : ""} liberadas`);
  out.push(`        su deuda NO se tocó: sigue debiendo $${deuda.rows[0].debe}`);

  // ── @magdaagomez ──
  const magda = (await db.query(`select id, box_1 from clients where instagram='@magdaagomez'`)).rows[0];
  if (!magda) throw new Error("no se encontró @magdaagomez");

  const envio = (await db.query(
    `select id, date::date, delivery_status from bookings
     where instagram ilike '%magdaagomez%' and type='paqueteria'
     order by date desc limit 1`)).rows[0];
  if (!envio) throw new Error("no se encontró su envío de paquetería");

  const items = (await db.query(
    `select i.id from sale_items i join sales s on s.id=i.sale_id
     where s.client_id=$1 and i.delivery_status<>'delivered'
       and i.paquete_booking_id is null
       and s.status not in ('cancelled','pending_payment')`, [magda.id])).rows.map((r) => r.id);

  if (items.length > 0) {
    await db.query(`update sale_items set paquete_booking_id=$1 where id = ANY($2::uuid[])`, [envio.id, items]);
    // El texto y el monto que ya traía la entrega se respetan: es un registro
    // histórico, no un paquete que se esté armando ahora.
    await db.query(
      `update bookings set sale_item_ids=$1::jsonb, preparado_at=now(),
                           preparado_por_name='Ajuste de cajas'
       where id=$2`, [JSON.stringify(items), envio.id]);
  }
  await db.query(`update clients set box_1=null, box_2=null where id=$1`, [magda.id]);

  out.push(`@magdaagomez — ${items.length} productos ligados a su envío del ${envio.date.toISOString().slice(0,10)} como PAQUETE ARMADO`);
  out.push(`        cajas ${magda.box_1} liberadas`);
} catch (e) {
  out.push("ERROR: " + e.message);
  process.exitCode = 1;
} finally {
  console.log(out.join("\n"));
  await db.end();
}

// ── Añadido el mismo día, a petición: el envío de @magdaagomez ya salió por
//    paquetería y su entrega estaba marcada como entregada desde el 6 de noviembre,
//    así que sus productos pasan de PAQUETE ARMADO a entregados. ──
const db2 = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  await db2.connect();
  const m = (await db2.query(`select id from clients where instagram='@magdaagomez'`)).rows[0];
  const r = await db2.query(`
    update sale_items i set delivery_status='delivered', delivered_by_name='Ajuste de cajas'
    from sales s
    where s.id=i.sale_id and s.client_id=$1 and i.delivery_status<>'delivered'
      and s.status not in ('cancelled','pending_payment')
    returning i.id`, [m.id]);
  console.log(`@magdaagomez — ${r.rowCount} productos pasados de PAQUETE ARMADO a entregados`);
} finally { await db2.end(); }

// ── @dominnik.s: los 3 productos que se le confirmaron por Instagram el 4 de
//    septiembre y sí se entregaron. Se les pone ESA fecha, no la de hoy: el dato
//    existe, así que inventar otro sería peor que no tener ninguno.
//    El "TARJETERO POLO" del mismo mensaje NO se toca: no está en ninguna venta suya.
const db3 = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  await db3.connect();
  const ids = [
    '1f64544e-56a3-4da3-a6c3-3e97dac1cb4c', // TANGA VICTORIA´S SECRET
    '446b02b0-d581-4fd9-adbc-b097583247ca', // MIST GINGHAM GORGEOUS
    'd16f307f-7fbc-4ede-ba2e-aaecc8b2df35', // BODY WASH GINGHAM GORGEOUS
  ];
  const r = await db3.query(
    `update sale_items set delivery_status='delivered', delivered_by_name='Ajuste de cajas'
     where id = ANY($1::uuid[]) and delivery_status<>'delivered' returning id`, [ids]);
  // El disparador puso la fecha de hoy al cambiar el estado; se corrige a la real.
  // Un segundo cambio que no toca delivery_status ya no lo vuelve a mover.
  await db3.query(
    `update sale_items set delivered_at = timestamptz '2026-09-04 15:00:00-06'
     where id = ANY($1::uuid[])`, [ids]);
  console.log(`@dominnik.s — ${r.rowCount} productos marcados entregados con fecha 4 de septiembre`);
} finally { await db3.end(); }

// ── @dominnik.s, segunda parte: la cartera Steve Madden sigue en la tienda, en el
//    estante. Los otros tres (lentes, rasuradora, sandalias) ya se habían entregado
//    y nadie los marcó; de esos no hay fecha en ningún lado, así que queda la del
//    ajuste, con el nombre diciendo que fue un ajuste y no una persona.
const db4 = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  await db4.connect();
  const entregados = [
    '88d8974e-4413-427c-92f3-d6a4b50c573b', // LENTES FRYE CO
    'ac8677c2-78b8-4fb6-958a-fca06be7ecfe', // RASURADORA BEVERLY HILLS
    '95083bca-b448-4248-a35f-e8ad3d23fb36', // SANDALIAS GBG
  ];
  const r = await db4.query(
    `update sale_items set delivery_status='delivered', delivered_by_name='Ajuste de cajas'
     where id = ANY($1::uuid[]) and delivery_status<>'delivered' returning id`, [entregados]);
  console.log(`@dominnik.s — ${r.rowCount} productos viejos marcados entregados`);

  // La cartera va al estante, por la misma vía que usa el panel.
  const venta = (await db4.query(
    `select s.id from sale_items i join sales s on s.id=i.sale_id
     where i.id='f27eecb7-0004-4327-8887-a0c595c195c8'`)).rows[0].id;
  const token = (await import("./tokenDePrueba.mjs")).tokenDePrueba("admin", "Ajuste de cajas");
  const res = await fetch(`${process.env.BASE_URL || "http://localhost:3000"}/api/panel/ubicacion`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": token },
    body: JSON.stringify({ saleIds: [venta], tipo: "estante" }),
  });
  console.log(`@dominnik.s — cartera Steve Madden al estante: ${res.ok ? "ok" : "ERROR " + res.status}`);

  const fin = (await db4.query(
    `select c.box_1,
      (select count(*) from sale_items i join sales s on s.id=i.sale_id
       where s.client_id=c.id and i.delivery_status<>'delivered'
         and s.status not in ('cancelled','pending_payment')) pendientes
     from clients c where c.instagram='@dominnik.s'`)).rows[0];
  console.log(`@dominnik.s — ficha: ${fin.box_1 ?? "sin cajas"} · pendientes: ${fin.pendientes}`);
} finally { await db4.end(); }

// ── @magda.favela, caja 1: su paquete ya estaba armado. Agendó para hoy en bodega y
//    no pasó a recogerlo (su entrega quedó en "no entregado"), así que la mercancía
//    está fuera de la caja esperando a que vuelva a agendar. Es justo el caso que
//    dejaba cajas ocupadas sin estarlo. Se liga por la vía del módulo.
const db5 = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  await db5.connect();
  const cl = (await db5.query(`select id from clients where instagram='@magda.favela'`)).rows[0].id;
  const items = (await db5.query(
    `select i.id from sale_items i join sales s on s.id=i.sale_id
     where s.client_id=$1 and i.delivery_status<>'delivered' and i.paquete_booking_id is null
       and s.status not in ('cancelled','pending_payment')`, [cl])).rows.map(r => r.id);
  const tok = (await import("./tokenDePrueba.mjs")).tokenDePrueba("admin", "Ajuste de cajas");
  const res = await fetch(`${process.env.BASE_URL || "http://localhost:3000"}/api/panel/paquetes`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-panel-token": tok },
    body: JSON.stringify({
      accion: "armar",
      bookingId: "6deca5f8-a321-46a1-ae28-2f1f9db07d63",
      clientId: cl, itemIds: items,
    }),
  });
  const d = await res.json();
  console.log(`@magda.favela — ${res.ok ? d.empacados + " productos en PAQUETE ARMADO" : "ERROR " + JSON.stringify(d)}`);
} finally { await db5.end(); }

// ── @perlajanet_24, caja 33: su entrega a domicilio del 11 de noviembre ya estaba
//    marcada como entregada y listaba 5 productos, pero sin ligarlos. Se ligan y se
//    marcan con la fecha de esa entrega, no con la de hoy.
const db6 = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  await db6.connect();
  const entregaPerla = '59f6dbbd-99a7-4a9e-9a9b-9e3828d9ccd1';
  const ids = [
    '0a4d517f-0038-482a-a307-15ad0cc75804', // CALCETAS LARGAS UNDER ARMOUR 6 PARES
    '8f6ca5e5-c7af-4667-adfe-5cab47cce19c', // SANDALIAS CROCS ROSAS
    'b4544d9a-5e22-4c5e-968d-4292244e7f26', // PACK 3 PEGAMENTOS ELMER'S   (caja 33)
    '40c6055b-0ebf-4a21-977a-0b0e618e315f', // JABÓN BATH & BODY WORKS     (caja 33)
    'b434eeee-edef-4834-acab-9994d92bb32a', // SET 2PZ SUETER Y PANTS NO BOUNDARIES
  ];
  const r = await db6.query(
    `update sale_items set delivery_status='delivered', delivered_by_name='Ajuste de cajas'
     where id = ANY($1::uuid[]) and delivery_status<>'delivered' returning id`, [ids]);
  await db6.query(
    `update sale_items set delivered_at = timestamptz '2026-11-11 18:00:00-06'
     where id = ANY($1::uuid[])`, [ids]);
  await db6.query(
    `update bookings set sale_item_ids=$1::jsonb where id=$2`, [JSON.stringify(ids), entregaPerla]);

  const quedan = (await db6.query(
    `select count(*) n from sale_items i join sales s on s.id=i.sale_id join clients c on c.id=s.client_id
     where c.instagram='@perlajanet_24' and i.delivery_status<>'delivered'
       and s.status not in ('cancelled','pending_payment')`)).rows[0].n;
  console.log(`@perlajanet_24 — ${r.rowCount} productos marcados entregados con fecha 11 de noviembre · le quedan ${quedan} pendientes`);
} finally { await db6.end(); }

// ── @perlajanet_24, el resto: 14 productos pendientes desde mayo. Casi todos
//    aparecen listados en entregas suyas que YA están marcadas como entregadas —
//    se los dieron y nadie los marcó. Se cruzan por nombre contra esas entregas
//    para usar la fecha de verdad; los que no casen quedan con la del ajuste.
const db7 = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  await db7.connect();
  const limpio = (s) => String(s || "").replace(/^\s*\d+\s*x\s*/i, "").trim().toUpperCase().replace(/\s+/g, " ");

  const entregas = (await db7.query(
    `select id, date, products from bookings
     where instagram ilike '%perlajanet_24%' and delivery_status='entregado'
     order by date`)).rows;

  const pendientes = (await db7.query(
    `select i.id, pr.name from sale_items i
     join sales s on s.id=i.sale_id join products pr on pr.id=i.product_id
     join clients c on c.id=s.client_id
     where c.instagram='@perlajanet_24' and i.delivery_status<>'delivered'
       and s.status not in ('cancelled','pending_payment')`)).rows;

  let conFecha = 0;
  const yaUsados = new Set();
  for (const it of pendientes) {
    // La entrega más antigua que lo mencione y no lo haya usado ya para otro renglón.
    const bk = entregas.find((b) =>
      String(b.products || "").split("\n").some((l) => {
        const k = b.id + "|" + limpio(l);
        return limpio(l) && limpio(l) === limpio(it.name) && !yaUsados.has(k) && yaUsados.add(k);
      }));
    await db7.query(
      `update sale_items set delivery_status='delivered', delivered_by_name='Ajuste de cajas'
       where id=$1 and delivery_status<>'delivered'`, [it.id]);
    if (bk) {
      await db7.query(`update sale_items set delivered_at=$1 where id=$2`, [bk.date, it.id]);
      conFecha++;
    }
  }
  console.log(`@perlajanet_24 — ${pendientes.length} productos marcados entregados (${conFecha} con la fecha real de su entrega)`);
} finally { await db7.end(); }

// ── @anapdroza, caja 80: su paquete ya está armado y fuera de las cajas, con
//    entrega a domicilio hoy. Se liga a esa entrega por la vía del módulo.
//    El monto a cobrar NO se toca: sus tres compras están liquidadas, y los $45 que
//    dice su mensaje son del envío, que nadie puede saber desde aquí si ya pagó.
const db8 = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  await db8.connect();
  const cl = (await db8.query(`select id from clients where instagram='@anapdroza'`)).rows[0].id;
  const items = (await db8.query(
    `select i.id from sale_items i join sales s on s.id=i.sale_id
     where s.client_id=$1 and i.delivery_status<>'delivered' and i.paquete_booking_id is null
       and s.status not in ('cancelled','pending_payment')`, [cl])).rows.map(r => r.id);
  if (items.length) {
    const tok = (await import("./tokenDePrueba.mjs")).tokenDePrueba("admin", "Ajuste de cajas");
    const res = await fetch(`${process.env.BASE_URL || "http://localhost:3000"}/api/panel/paquetes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-panel-token": tok },
      body: JSON.stringify({
        accion: "armar",
        bookingId: "e024cf04-b879-4fa3-8b89-b5eba5088b04",
        clientId: cl, itemIds: items,
      }),
    });
    const d = await res.json();
    console.log(`@anapdroza — ${res.ok ? d.empacados + " productos en PAQUETE ARMADO" : "ERROR " + JSON.stringify(d)}`);
  } else {
    console.log("@anapdroza — ya estaba armado");
  }
} finally { await db8.end(); }

// ── @ximena_glzm, caja 90: igual que Ana Karen, paquete armado y entrega hoy. Aquí
//    sí se sabe el envío: ella confirmó por mensaje que paga $45 en efectivo al
//    recibir, así que va en la tarjeta para que el repartidor lo cobre.
const db9 = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  await db9.connect();
  const cl = (await db9.query(`select id from clients where instagram='@ximena_glzm'`)).rows[0].id;
  const items = (await db9.query(
    `select i.id from sale_items i join sales s on s.id=i.sale_id
     where s.client_id=$1 and i.delivery_status<>'delivered' and i.paquete_booking_id is null
       and s.status not in ('cancelled','pending_payment')`, [cl])).rows.map(r => r.id);
  if (items.length) {
    const tok = (await import("./tokenDePrueba.mjs")).tokenDePrueba("admin", "Ajuste de cajas");
    const res = await fetch(`${process.env.BASE_URL || "http://localhost:3000"}/api/panel/paquetes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-panel-token": tok },
      body: JSON.stringify({
        accion: "armar",
        bookingId: "6132545a-ccd1-4e9d-82f0-c0c2983fc074",
        clientId: cl, itemIds: items, envio: 45,
      }),
    });
    const d = await res.json();
    console.log(`@ximena_glzm — ${res.ok ? d.empacados + " productos en PAQUETE ARMADO, a cobrar $" + d.cobro?.aCobrar : "ERROR " + JSON.stringify(d)}`);
  } else {
    console.log("@ximena_glzm — ya estaba armado");
  }
} finally { await db9.end(); }

// ── @fernandaorozco_, caja 93: su paquete va en la ruta AHORA. Solo van 2 de sus 3
//    productos: ella pidió por mensaje que el shaker no se lo sacaran todavía.
//    Es justo el caso de palomear que resuelve el módulo.
const db10 = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  await db10.connect();
  const cl = (await db10.query(`select id from clients where instagram='@fernandaorozco_'`)).rows[0].id;
  const vanEstos = [
    '61bd9637-ffd0-4be1-993d-91e0d7abc46a', // TSHIRT CAFE GYMSHARK HOMBRE
    'fb79a679-2f52-4940-8802-da1410f65aa2', // MOCHILA PINK VICTORIA´S SECRET
  ];                                        // el SHAKER se queda
  const faltan = (await db10.query(
    `select id from sale_items where id = ANY($1::uuid[]) and paquete_booking_id is null`, [vanEstos])).rows;
  if (faltan.length) {
    const tok = (await import("./tokenDePrueba.mjs")).tokenDePrueba("admin", "Ajuste de cajas");
    const res = await fetch(`${process.env.BASE_URL || "http://localhost:3000"}/api/panel/paquetes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-panel-token": tok },
      body: JSON.stringify({
        accion: "armar",
        bookingId: "7b5aeb99-8044-4231-913a-2d76d6971702",
        clientId: cl, itemIds: vanEstos, envio: 45,
      }),
    });
    const d = await res.json();
    console.log(`@fernandaorozco_ — ${res.ok ? d.empacados + " productos en PAQUETE ARMADO, a cobrar $" + d.cobro?.aCobrar : "ERROR " + JSON.stringify(d)}`);
  } else {
    console.log("@fernandaorozco_ — ya estaba armado");
  }
} finally { await db10.end(); }

// ── @fernandaorozco_, corrección: la entrega fue el 10 de noviembre y ya está
//    marcada como entregada, así que sus 2 productos salieron ese día. El shaker,
//    que ella pidió no sacar, quedó en el estante.
const db11 = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
try {
  await db11.connect();
  const salieron = [
    '61bd9637-ffd0-4be1-993d-91e0d7abc46a', // TSHIRT CAFE GYMSHARK HOMBRE
    'fb79a679-2f52-4940-8802-da1410f65aa2', // MOCHILA PINK VICTORIA´S SECRET
  ];
  const r = await db11.query(
    `update sale_items set delivery_status='delivered', delivered_by_name='Ajuste de cajas'
     where id = ANY($1::uuid[]) and delivery_status<>'delivered' returning id`, [salieron]);
  await db11.query(
    `update sale_items set delivered_at = timestamptz '2026-11-10 14:00:00-06'
     where id = ANY($1::uuid[])`, [salieron]);

  // El shaker al estante, por la misma vía que usa el panel.
  const ventaShaker = '383c2b91-32bb-4fc4-a58a-986a6a0a473a';
  const tok = (await import("./tokenDePrueba.mjs")).tokenDePrueba("admin", "Ajuste de cajas");
  const res = await fetch(`${process.env.BASE_URL || "http://localhost:3000"}/api/panel/ubicacion`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": tok },
    body: JSON.stringify({ saleIds: [ventaShaker], tipo: "estante" }),
  });
  console.log(`@fernandaorozco_ — ${r.rowCount} productos entregados el 10 de noviembre · shaker al estante: ${res.ok ? "ok" : "ERROR " + res.status}`);
} finally { await db11.end(); }
