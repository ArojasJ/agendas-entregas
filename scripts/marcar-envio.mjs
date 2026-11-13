import { Client } from "pg";

// Marca entregado lo que salió en un envío y todo lo anterior.
//
// El caso se repite con las clientas de paquetería: no agendan entrega, así que sus
// compras se quedan pendientes para siempre aunque hace meses que las recibieron. Lo
// único que hay es el mensaje donde se les confirmó qué se les mandaba.
//
// A los productos NOMBRADOS en ese mensaje se les pone la fecha del envío, que se
// sabe. A los anteriores no: salieron en envíos de los que no quedó registro, y
// ponerles una fecha sería inventarla.
//
//   node scripts/marcar-envio.mjs @usuario 2026-07-28 "PRODUCTO UNO" "PRODUCTO DOS"
//
// La fecha es la del ENVÍO, no la de la compra: una cosa comprada el 15 de junio pudo
// mandarse el 28 de julio. El corte —hasta dónde marcar— sale solo: es la compra más
// nueva de entre los productos nombrados, porque si eso se mandó, lo anterior también.
//
// Sin --aplicar solo informa.

const APLICAR = process.argv.includes("--aplicar");
const args = process.argv.slice(2).filter((a) => a !== "--aplicar");
const [usuario, fechaEnvio, ...nombrados] = args;

if (!usuario || !/^\d{4}-\d{2}-\d{2}$/.test(fechaEnvio || "")) {
  console.error('Uso: node scripts/marcar-envio.mjs @usuario AAAA-MM-DD "PRODUCTO" ... [--aplicar]');
  process.exit(1);
}

const limpio = (s) => String(s || "").trim().toUpperCase().replace(/\s+/g, " ");
const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();

  const todos = (await db.query(`
    select i.id, pr.name, s.created_at::date comprada
    from sale_items i
    join sales s on s.id = i.sale_id
    join products pr on pr.id = i.product_id
    join clients c on c.id = s.client_id
    where c.instagram = $1
      and i.delivery_status <> 'delivered'
      and s.status not in ('cancelled','pending_payment')
    order by s.created_at`, [usuario])).rows;

  const enElEnvio = new Set(nombrados.map(limpio));
  const delEnvio = todos.filter((p) => enElEnvio.has(limpio(p.name)));
  if (delEnvio.length === 0) {
    console.error("Ninguno de esos productos está entre sus pendientes. Revisa los nombres.");
    process.exit(1);
  }

  // El corte: la compra más nueva de lo que se mandó. Lo anterior salió antes.
  const corte = delEnvio
    .map((p) => p.comprada.toISOString().slice(0, 10))
    .sort().at(-1);

  const pendientes = todos.filter((p) => p.comprada.toISOString().slice(0, 10) <= corte);
  const conFecha = pendientes.filter((p) => enElEnvio.has(limpio(p.name)));
  const sinFecha = pendientes.filter((p) => !enElEnvio.has(limpio(p.name)));

  // Un producto nombrado que no aparezca entre los pendientes es señal de que el
  // nombre no coincide con el del inventario: se avisa en vez de pasarlo por alto.
  const encontrados = new Set(conFecha.map((p) => limpio(p.name)));
  for (const n of enElEnvio) {
    if (!encontrados.has(n)) console.log(`  AVISO: "${n}" no está entre sus pendientes`);
  }

  console.log(`${usuario}: envío del ${fechaEnvio}, corte en compras del ${corte} o antes`);
  console.log(`  ${conFecha.length} nombrados en el envío  →  entregados el ${fechaEnvio}`);
  console.log(`  ${sinFecha.length} anteriores             →  entregados, sin fecha`);

  if (!APLICAR) { console.log("\n(Sin aplicar. Agrega --aplicar para escribirlo.)"); }
  else {
    await db.query(
      `update sale_items set delivery_status='delivered', delivered_by_name='Enviado por paquetería'
       where id = ANY($1::uuid[]) and delivery_status <> 'delivered'`,
      [pendientes.map((p) => p.id)]);
    await db.query(
      `update sale_items set delivered_at = ($1::date + time '12:00') at time zone 'America/Monterrey'
       where id = ANY($2::uuid[])`, [fechaEnvio, conFecha.map((p) => p.id)]);
    await db.query(
      `update sale_items set delivered_at = null where id = ANY($1::uuid[])`,
      [sinFecha.map((p) => p.id)]);
    console.log(`\nAPLICADO: ${pendientes.length} productos marcados entregados.`);
  }

  const quedan = (await db.query(`
    select pr.name producto, s.created_at::date comprada,
           (current_date - s.created_at::date) dias,
           case when s.total - s.down_payment
                     - coalesce((select sum(p.amount) from payments p where p.sale_id = s.id), 0) > 0
                then 'DEBE' else 'pagado' end pago
    from sale_items i join sales s on s.id = i.sale_id join products pr on pr.id = i.product_id
    join clients c on c.id = s.client_id
    where c.instagram = $1 and i.delivery_status <> 'delivered'
      and s.status not in ('cancelled','pending_payment')
    order by s.created_at`, [usuario])).rows;

  console.log(`\nLE QUEDAN ${quedan.length}:`);
  for (const q of quedan) {
    console.log(`  ${q.producto.trim().padEnd(50)} ${q.comprada.toISOString().slice(0, 10)}  ${q.dias}d  ${q.pago}`);
  }
} finally {
  await db.end();
}
