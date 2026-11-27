import { Client } from "pg";

// Lo mismo que scripts/compras-de-producto.mjs, pero valuando las MISMAS piezas
// de dos maneras: a lo que se pagó (cost) y a lo que se pide por ellas (price).
// Sirve para no confundir una cosa con la otra: la compra es el costo.

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const DESDE = "2026-10-10";
const peso = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const movs = await db.query(
  `select a.entity_id id,
          sum(case when a.action='stock_add'    then (a.entity_snapshot->>'diff')::int else 0 end)::int subido,
          sum(case when a.action='stock_remove' then (a.entity_snapshot->>'diff')::int else 0 end)::int bajado
   from audit_logs a
   where a.action in ('stock_add','stock_remove') and a.created_at >= $1
   group by a.entity_id`, [DESDE]);
const mano = new Map(movs.rows.map((r) => [r.id, r]));

const nuevos = await db.query(
  `select p.id, p.cost::numeric cost, p.price::numeric price, p.stock, coalesce(vend.q,0)::int vendidas
   from products p
   left join (select si.product_id pid, sum(si.quantity)::int q from sale_items si
              join sales s on s.id=si.sale_id where si.variant_id is null and s.status<>'cancelled'
              group by si.product_id) vend on vend.pid = p.id
   where p.created_at >= $1 and not exists (select 1 from product_variants v where v.product_id = p.id)`, [DESDE]);

const nuevasVar = await db.query(
  `select v.id, v.cost::numeric cost, v.price::numeric price, v.stock, coalesce(vend.q,0)::int vendidas
   from product_variants v
   left join (select si.variant_id vid, sum(si.quantity)::int q from sale_items si
              join sales s on s.id=si.sale_id where si.variant_id is not null and s.status<>'cancelled'
              group by si.variant_id) vend on vend.vid = v.id
   where v.created_at >= $1`, [DESDE]);

const A = [...nuevos.rows, ...nuevasVar.rows].map((r) => {
  const m = mano.get(r.id) || { subido: 0, bajado: 0 };
  return { ...r, u: Number(r.stock) + r.vendidas - m.subido + m.bajado, bajado: m.bajado };
}).filter((x) => x.u > 0);

const B = (await db.query(
  `select coalesce(p.cost, v.cost)::numeric cost, coalesce(p.price, v.price)::numeric price,
          sum((a.entity_snapshot->>'diff')::int)::int u
   from audit_logs a
   left join products p on p.id::text = a.entity_id and p.created_at < $1
   left join product_variants v on v.id::text = a.entity_id and v.created_at < $1
   where a.action='stock_add' and a.created_at >= $1 and (p.id is not null or v.id is not null)
   group by a.entity_id, p.cost, v.cost, p.price, v.price`, [DESDE])).rows.filter((x) => x.u > 0);

const C = (await db.query(
  `select (entity_snapshot->>'cost')::numeric cost, (entity_snapshot->>'price')::numeric price,
          (entity_snapshot->>'stock')::int u
   from audit_logs where action='delete_product' and created_at >= $1
     and (entity_snapshot->>'created_at')::date >= $1`, [DESDE])).rows.filter((x) => x.u > 0);

const todo = [...A, ...B, ...C];
const sum = (f) => todo.reduce((s, x) => s + f(x), 0);
const piezas = sum((x) => x.u);
const costo = sum((x) => (Number(x.cost) > 0 ? x.u * Number(x.cost) : 0));
const venta = sum((x) => (Number(x.price) > 0 ? x.u * Number(x.price) : 0));
const bajadoCosto = A.reduce((s, x) => s + (Number(x.cost) > 0 ? x.bajado * Number(x.cost) : 0), 0);

console.log("LAS MISMAS 844 PIEZAS, VALUADAS DE LAS DOS MANERAS\n");
console.log(`   piezas compradas             ${piezas}`);
console.log(`   lo que PAGASTE (costo)       ${peso(costo)}`);
console.log(`   lo que PIDES por ellas       ${peso(venta)}`);
console.log(`   ganancia si se vende todo    ${peso(venta - costo)}`);
console.log(`   margen                       ${((1 - costo / venta) * 100).toFixed(1)}%`);
console.log(`   multiplicas el costo por     ${(venta / costo).toFixed(2)}\n`);
console.log(`   descontando las ${A.reduce((s, x) => s + x.bajado, 0)} pz bajadas a mano: costo ${peso(costo - bajadoCosto)}`);

// ¿Cuánto de esa mercancía ya se vendió de verdad?
const vendidas = A.reduce((s, x) => s + x.vendidas, 0);
const vendidasCosto = A.reduce((s, x) => s + (Number(x.cost) > 0 ? x.vendidas * Number(x.cost) : 0), 0);
const vendidasVenta = A.reduce((s, x) => s + (Number(x.price) > 0 ? x.vendidas * Number(x.price) : 0), 0);
console.log(`\nDe lo que dio de alta en el periodo, ya se vendieron ${vendidas} pz:`);
console.log(`   costaron ${peso(vendidasCosto)} y se vendieron en ${peso(vendidasVenta)} de lista`);
console.log(`   sigue en bodega: ${piezas - vendidas} pz, ${peso(costo - vendidasCosto)} a costo`);

await db.end();
