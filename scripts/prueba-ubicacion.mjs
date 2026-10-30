import { Client } from "pg";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const ETIQUETA = "PRUEBA_UBIC";
let token, productoId;
const creados = [];

const api = (url, opts) =>
  fetch(`${BASE}${url}`, { ...opts, headers: { "Content-Type": "application/json", "x-panel-token": token, ...(opts?.headers || {}) } })
    .then((r) => r.json());

async function nuevaClienta(sufijo) {
  const r = await c.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8711234567') RETURNING id`,
    [ETIQUETA + sufijo, "@prueba_ubic_" + sufijo.toLowerCase()]);
  creados.push(r.rows[0].id);
  return r.rows[0].id;
}

async function venderA(clientId, cantidad, ubicacion) {
  const items = Array.from({ length: cantidad }, () => ({
    product_id: productoId, variant_id: null, quantity: 1, unit_price: 100,
  }));
  const r = await api("/api/sales", {
    method: "POST",
    body: JSON.stringify({
      client_id: clientId, total: cantidad * 100, discount: 0, payment_method: "efectivo",
      status: "paid", down_payment: cantidad * 100, items, ubicacion,
    }),
  });
  return r.sale?.id;
}

const proponer = (clientId, n) => api(`/api/panel/ubicacion?clientId=${clientId}&productos=${n}`);

try {
  await c.connect();
  token = (await (await fetch(`${BASE}/api/login-panel`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS }),
  })).json()).token;

  const p = await c.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,500,40) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;

  // REGLA 2 — nada guardado, un solo producto
  const a = await nuevaClienta("A");
  const r2 = await proponer(a, 1);
  if (r2.tipo === "estante") ok(`regla 2: un producto → estante (${r2.motivo})`);
  else fail(`regla 2 propuso "${r2.tipo}"`);

  // REGLA 3 — nada guardado, varios productos
  const b = await nuevaClienta("B");
  const r3 = await proponer(b, 3);
  if (r3.tipo === "caja" && r3.caja) ok(`regla 3: varios productos → caja ${r3.caja}`);
  else fail(`regla 3 propuso "${r3.tipo}"`);

  // REGLA 1 — ya tiene caja: reutiliza y junta lo del estante
  const d = await nuevaClienta("D");
  await venderA(d, 1, { tipo: "estante" });                       // primero al estante
  const cajaAsignada = (await proponer(d, 2)).caja;
  await venderA(d, 2, { tipo: "caja", caja: cajaAsignada, aMover: [] });
  const r1 = await proponer(d, 1);
  if (r1.tipo === "juntar" && r1.caja === cajaAsignada)
    ok(`regla 1: ya tiene la caja ${cajaAsignada} → propone juntar ahí`);
  else fail(`regla 1 propuso "${r1.tipo}" caja ${r1.caja}`);

  // La propuesta trae lo que ya tiene guardado, para poder mostrarlo
  if (r1.guardado?.length >= 1) ok(`muestra lo que ya tiene guardado (${r1.guardado.length} lugar/es)`);
  else fail("no devolvió lo que tiene guardado");

  // Juntar de verdad mueve lo del estante a la caja
  const e = await nuevaClienta("E");
  const ventaEstante = await venderA(e, 1, { tipo: "estante" });
  const prop = await proponer(e, 2);
  await venderA(e, 2, { tipo: "caja", caja: prop.caja, aMover: prop.aMover });
  const movida = await c.query("SELECT ubicacion, caja FROM sales WHERE id=$1", [ventaEstante]);
  if (movida.rows[0].ubicacion === "caja" && Number(movida.rows[0].caja) === prop.caja)
    ok(`juntar movió lo del estante a la caja ${prop.caja}`);
  else fail(`lo del estante quedó en "${movida.rows[0].ubicacion}"`);

  // Y clients.box_1 refleja la caja real
  const cajaCliente = await c.query("SELECT box_1 FROM clients WHERE id=$1", [e]);
  if (Number(cajaCliente.rows[0].box_1) === prop.caja) ok("la ficha de la clienta muestra esa caja");
  else fail(`la ficha quedó con box_1="${cajaCliente.rows[0].box_1}"`);

  // No se asigna dos veces la misma caja
  const f = await nuevaClienta("F");
  const propF = await proponer(f, 2);
  if (propF.caja !== prop.caja) ok(`no reutiliza una caja ocupada (dio la ${propF.caja}, no la ${prop.caja})`);
  else fail("asignó una caja que ya estaba ocupada");

  // Ninguna caja propuesta puede pertenecer ya a alguien. Supabase corta en 1000 filas
  // y hay más clientas que eso: sin paginar, las últimas parecían no tener caja.
  const g = await nuevaClienta("G");
  const propG = await proponer(g, 2);
  const ocupadasReales = await c.query(
    `SELECT DISTINCT b::int AS n FROM (
       SELECT box_1 AS b FROM clients WHERE box_1 ~ '^[0-9]+$'
       UNION ALL SELECT box_2 FROM clients WHERE box_2 ~ '^[0-9]+$'
     ) t`);
  const tomadas = new Set(ocupadasReales.rows.map((r) => r.n));
  const invadidas = (propG.libres || []).filter((n) => tomadas.has(n));
  if (invadidas.length === 0) ok(`las ${propG.libres.length} cajas ofrecidas están libres de verdad`);
  else fail(`ofreció cajas que ya son de alguien: ${invadidas.join(", ")}`);

  if (propG.ocupadas === tomadas.size) ok(`cuenta bien las ocupadas (${propG.ocupadas} de ${propG.total})`);
  else fail(`dice ${propG.ocupadas} ocupadas pero en la base hay ${tomadas.size}`);
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (creados.length) {
      await c.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [creados]);
      await c.query("DELETE FROM sales WHERE client_id = ANY($1)", [creados]);
      await c.query("DELETE FROM clients WHERE id = ANY($1)", [creados]);
    }
    if (productoId) {
      await c.query("DELETE FROM sale_items WHERE product_id=$1", [productoId]);
      await c.query("DELETE FROM products WHERE id=$1", [productoId]);
    }
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await c.end();
}
