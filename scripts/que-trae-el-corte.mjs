import { Client } from "pg";

// Qué va a sumar el próximo corte de caja, antes de cerrarlo.
//
// El corte barre TODAS las ventas y abonos que todavía no tienen corte, sin importar
// su fecha: suma el enganche de cada venta más los abonos sueltos. Si quedó algo
// viejo sin cortar, entra aquí junto con lo de hoy.
//
// Sirve para contestar una pregunta concreta: marcar productos como entregados, ¿mete
// dinero al corte? La respuesta debería ser no —entregar no es cobrar— y esto lo
// enseña en números en vez de prometerlo.

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();

  const { rows: ventas } = await db.query(`
    select s.id, s.created_at, s.created_at::date fecha, s.status,
           s.down_payment, s.penalty_amount, s.total,
           coalesce(c.instagram, c.name, '(mostrador)') quien
    from sales s left join clients c on c.id = s.client_id
    where s.pos_cut_id is null
    order by s.created_at`);

  const cuenta = (s) =>
    s.status === "cancelled" ? Number(s.penalty_amount || 0)
    : s.status === "catalog_pending" ? 0
    : Number(s.down_payment);

  const { rows: abonos } = await db.query(`
    select p.id, p.created_at::date fecha, p.amount,
           coalesce(c.instagram, c.name, '(sin clienta)') quien
    from payments p
    left join sales s on s.id = p.sale_id
    left join clients c on c.id = s.client_id
    where p.pos_cut_id is null
    order by p.created_at`);

  const totalVentas = ventas.reduce((a, s) => a + cuenta(s), 0);
  const totalAbonos = abonos.reduce((a, p) => a + Number(p.amount), 0);

  console.log("LO QUE ENTRARIA AL PROXIMO CORTE\n");
  const porDia = new Map();
  for (const s of ventas) {
    const d = s.fecha.toISOString().slice(0, 10);
    if (!porDia.has(d)) porDia.set(d, { ventas: 0, monto: 0, abonos: 0, montoAbonos: 0 });
    porDia.get(d).ventas++;
    porDia.get(d).monto += cuenta(s);
  }
  for (const p of abonos) {
    const d = p.fecha.toISOString().slice(0, 10);
    if (!porDia.has(d)) porDia.set(d, { ventas: 0, monto: 0, abonos: 0, montoAbonos: 0 });
    porDia.get(d).abonos++;
    porDia.get(d).montoAbonos += Number(p.amount);
  }
  for (const [d, v] of [...porDia.entries()].sort()) {
    console.log(`   ${d}   ${String(v.ventas).padStart(3)} ventas $${String(v.monto).padStart(7)}   ${String(v.abonos).padStart(3)} abonos $${String(v.montoAbonos).padStart(6)}`);
  }

  console.log(`\n   ventas: ${ventas.length}  ->  $${totalVentas}`);
  console.log(`   abonos: ${abonos.length}  ->  $${totalAbonos}`);
  console.log(`   TOTAL DEL CORTE: $${totalVentas + totalAbonos}`);

  // Lo que de verdad preocupa: algo viejo arrastrado hasta el corte de hoy.
  const viejas = ventas.filter((s) => (Date.now() - new Date(s.created_at)) > 35 * 86400000);
  if (viejas.length) {
    console.log(`\n   OJO: ${viejas.length} ventas de hace mas de 35 dias siguen sin corte y entrarian aqui:`);
    for (const s of viejas) console.log(`     ${s.fecha.toISOString().slice(0, 10)}  ${String(s.quien).padEnd(24)} $${cuenta(s)}  (${s.status})`);
  } else {
    console.log(`\n   Ninguna venta de mas de 35 dias quedo sin cortar: el corte solo trae lo de este periodo.`);
  }
} finally {
  await db.end();
}
