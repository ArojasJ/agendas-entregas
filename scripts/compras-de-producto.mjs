import { Client } from "pg";

// ¿CUANTO SE COMPRO DE MERCANCIA DEL 10-OCT-2026 A HOY?
//
// El sistema NO guarda compras. No hay tabla de entradas, ni de proveedores, ni de
// facturas. Y la bitácora que debería llevarlas, `stock_logs`, está VACIA: el código
// de app/api/products/route.js le manda columnas que la tabla no tiene —staff_id y
// staff_name—, así que cada inserción falla y el catch se la traga en silencio.
// Lo único que quedó escrito son los `audit_logs` con action stock_add / stock_remove.
//
// Entonces el número se RECONSTRUYE. Para lo que nació en el periodo, el stock de hoy
// ya no sirve: vender lo baja sin dejar rastro. Se rearma hacia atrás:
//
//   al nacer = stock de hoy + lo vendido (no cancelado) - lo subido a mano
//              + lo bajado a mano
//
// Cancelar una venta REGRESA el stock y deja el renglón, así que lo cancelado no
// cuenta como salida. Borrar una venta también regresa el stock, pero se lleva el
// renglón: no hay nada que descontar.
//
// OJO CON LAS VARIANTES: un producto con variantes guarda la mercancía en las
// variantes, pero su propio renglón conserva un `stock` de adorno. Los 50 casos del
// periodo traen cost = 0, así que no inflan el dinero, pero sí inflarían las piezas.
// Se excluye al padre y se cuentan sus variantes.

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();
const DESDE = "2026-10-10";
const peso = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dia = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);

const movs = await db.query(
  `select a.entity_id id,
          sum(case when a.action='stock_add'    then (a.entity_snapshot->>'diff')::int else 0 end)::int subido,
          sum(case when a.action='stock_remove' then (a.entity_snapshot->>'diff')::int else 0 end)::int bajado
   from audit_logs a
   where a.action in ('stock_add','stock_remove') and a.created_at >= $1
   group by a.entity_id`, [DESDE]);
const mano = new Map(movs.rows.map((r) => [r.id, r]));

// A1) Productos sueltos (sin variantes) nacidos en el periodo
const nuevos = await db.query(
  `select p.id, p.name, p.category, p.cost::numeric cost, p.stock, p.created_at::date nacio,
          coalesce(vend.q, 0)::int vendidas
   from products p
   left join (
     select si.product_id pid, sum(si.quantity)::int q
     from sale_items si join sales s on s.id = si.sale_id
     where si.variant_id is null and s.status <> 'cancelled'
     group by si.product_id
   ) vend on vend.pid = p.id
   where p.created_at >= $1
     and not exists (select 1 from product_variants v where v.product_id = p.id)`, [DESDE]);

// A2) Variantes nacidas en el periodo
const nuevasVar = await db.query(
  `select v.id, (p.name || ' / ' || v.name) name, coalesce(p.category, 'General') category,
          v.cost::numeric cost, v.stock, v.created_at::date nacio, coalesce(vend.q, 0)::int vendidas
   from product_variants v
   join products p on p.id = v.product_id
   left join (
     select si.variant_id vid, sum(si.quantity)::int q
     from sale_items si join sales s on s.id = si.sale_id
     where si.variant_id is not null and s.status <> 'cancelled'
     group by si.variant_id
   ) vend on vend.vid = v.id
   where v.created_at >= $1`, [DESDE]);

const nacidas = [...nuevos.rows, ...nuevasVar.rows].map((r) => {
  const m = mano.get(r.id) || { subido: 0, bajado: 0 };
  return { ...r, alNacer: Number(r.stock) + r.vendidas - m.subido + m.bajado, bajadoDespues: m.bajado };
});

// B) Existencias agregadas a algo que ya existía antes del 10-oct
const resurtido = await db.query(
  `select a.entity_id id,
          coalesce(p.name, pv.name || ' / ' || v.name) name,
          coalesce(p.category, pv.category, 'General') category,
          coalesce(p.cost, v.cost)::numeric cost,
          sum((a.entity_snapshot->>'diff')::int)::int unidades,
          count(*)::int veces, max(a.created_at)::date ultima
   from audit_logs a
   left join products p on p.id::text = a.entity_id and p.created_at < $1
   left join product_variants v on v.id::text = a.entity_id and v.created_at < $1
   left join products pv on pv.id = v.product_id
   where a.action = 'stock_add' and a.created_at >= $1
     and (p.id is not null or v.id is not null)
   group by a.entity_id, p.name, pv.name, v.name, p.category, pv.category, p.cost, v.cost`, [DESDE]);

// C) Productos que NACIERON en el periodo y después alguien los borró: la compra pasó,
//    el renglón ya no está. Sale de la foto que guarda el borrado.
const borrados = await db.query(
  `select entity_snapshot->>'name' name,
          coalesce(entity_snapshot->>'category','General') category,
          (entity_snapshot->>'cost')::numeric cost,
          (entity_snapshot->>'stock')::int unidades,
          (entity_snapshot->>'created_at')::date nacio
   from audit_logs
   where action = 'delete_product' and created_at >= $1
     and (entity_snapshot->>'created_at')::date >= $1`, [DESDE]);

const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0);
const conCosto = (x) => Number(x.cost) > 0;
const vale = (x, u) => (conCosto(x) ? u * Number(x.cost) : 0);

const A = nacidas.filter((x) => x.alNacer > 0);
const B = resurtido.rows.filter((x) => x.unidades > 0);
const C = borrados.rows.filter((x) => x.unidades > 0);

const aU = sum(A, (x) => x.alNacer), aC = sum(A, (x) => vale(x, x.alNacer));
const bU = sum(B, (x) => x.unidades), bC = sum(B, (x) => vale(x, x.unidades));
const cU = sum(C, (x) => x.unidades), cC = sum(C, (x) => vale(x, x.unidades));

const sinCosto = [...A.filter((x) => !conCosto(x)).map((x) => ({ n: x.name, u: x.alNacer })),
                  ...B.filter((x) => !conCosto(x)).map((x) => ({ n: x.name, u: x.unidades }))];
const bajado = sum(nacidas, (x) => x.bajadoDespues);
const bajadoC = sum(nacidas, (x) => vale(x, x.bajadoDespues));

console.log("COMPRAS DE MERCANCIA — 10 de octubre al 26 de noviembre de 2026\n");
console.log("A) Dado de alta nuevo (producto que no existía en el sistema)");
console.log(`   ${nuevos.rows.length} productos sueltos + ${nuevasVar.rows.length} variantes`);
console.log(`   ${aU} piezas        ${peso(aC)}\n`);
console.log("B) Existencias agregadas a producto que ya estaba en el sistema");
console.log(`   ${B.length} renglones, ${bU} piezas        ${peso(bC)}\n`);
console.log("C) Dado de alta en el periodo y borrado después (la compra sí pasó)");
console.log(`   ${C.length} renglones, ${cU} piezas        ${peso(cC)}\n`);
console.log(`TOTAL A COSTO     ${aU + bU + cU} piezas        ${peso(aC + bC + cC)}\n`);
console.log("Lo que queda fuera o en duda:");
console.log(`   · ${sinCosto.length} renglones (${sum(sinCosto, (x) => x.u)} pz) sin costo capturado: no suman nada`);
console.log(`   · ${bajado} piezas se bajaron a mano después del alta (${peso(bajadoC)});`);
console.log(`     si fue error de captura y no merma, el total baja a ${peso(aC + bC + cC - bajadoC)}`);

const mete = (t, k, u, c) => { t[k] = t[k] || { p: 0, c: 0 }; t[k].p += u; t[k].c += c; };
const todo = [...A.map((x) => ({ ...x, u: x.alNacer, f: x.nacio })),
              ...B.map((x) => ({ ...x, u: x.unidades, f: x.ultima })),
              ...C.map((x) => ({ ...x, u: x.unidades, f: x.nacio }))];

console.log("\n-- Por mes --");
const porMes = {};
for (const x of todo) mete(porMes, dia(x.f).slice(0, 7), x.u, vale(x, x.u));
for (const k of Object.keys(porMes).sort()) console.log(`   ${k}   ${String(porMes[k].p).padStart(4)} pz   ${peso(porMes[k].c)}`);

console.log("\n-- Por quincena --");
const porQ = {};
for (const x of todo) { const d = dia(x.f); mete(porQ, d.slice(0, 8) + (Number(d.slice(8)) <= 15 ? "01 al 15" : "16 en adelante"), x.u, vale(x, x.u)); }
for (const k of Object.keys(porQ).sort()) console.log(`   ${k}   ${String(porQ[k].p).padStart(4)} pz   ${peso(porQ[k].c)}`);

console.log("\n-- Por categoría --");
const porCat = {};
for (const x of todo) mete(porCat, (x.category || "General").trim(), x.u, vale(x, x.u));
for (const k of Object.keys(porCat).sort((a, b) => porCat[b].c - porCat[a].c))
  console.log(`   ${String(porCat[k].p).padStart(4)} pz   ${peso(porCat[k].c).padStart(13)}   ${k}`);

console.log("\n-- Renglones sin costo capturado --");
for (const f of sinCosto.sort((a, b) => b.u - a.u)) console.log(`   ${String(f.u).padStart(3)} pz   ${f.n}`);

console.log("\n-- B) renglón por renglón: lo agregado a producto que ya existía --");
for (const x of B.sort((a, b) => vale(b, b.unidades) - vale(a, a.unidades)))
  console.log(`   ${String(x.unidades).padStart(3)} pz x ${String(x.cost ?? 0).padStart(9)} = ${peso(vale(x, x.unidades)).padStart(12)}   ${dia(x.ultima)}  ${x.name}`);

await db.end();
