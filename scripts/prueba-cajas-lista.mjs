import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { cajasDeTexto, cajasATexto } from "../lib/constants.js";

// Las trabajadoras anotaban varias cajas en el mismo campo ("19, 42"). El sistema
// exigía un número solo, así que ignoraba el campo entero: esa caja quedaba invisible,
// se daba por libre, y la validación de choques tampoco la veía. Encima, al
// sincronizar se recortaba a dos y la tercera se borraba de la ficha para siempre.
//
// Las cajas de la prueba se toman libres en el momento: usar números fijos chocaría
// con los de una clienta real y la prueba estaría midiendo sus datos, no los suyos.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_LISTA";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let token, productoId;
const creados = [];

const api = (url, opts) =>
  fetch(`${BASE}${url}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-panel-token": token, ...(opts?.headers || {}) },
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));

async function cajasLibres(cuantas) {
  const r = await c.query(`
    with ocupadas as (
      select (regexp_matches(coalesce(box_1,'')||','||coalesce(box_2,''), '\\d+', 'g'))[1]::int n from clients
      union select caja::int from sales where ubicacion='caja' and caja is not null)
    select n from generate_series(1,120) n
    where n not in (select n from ocupadas where n is not null)
    order by n desc limit $1`, [cuantas]);
  if (r.rows.length < cuantas) throw new Error(`solo hay ${r.rows.length} cajas libres, hacen falta ${cuantas}`);
  return r.rows.map((x) => x.n);
}

async function nuevaClienta(sufijo, box1 = null, box2 = null) {
  const r = await c.query(
    `INSERT INTO clients (name,instagram,phone,box_1,box_2) VALUES ($1,$2,'8711234567',$3,$4) RETURNING id`,
    [ETIQUETA + "_" + sufijo, "@prueba_lista_" + sufijo.toLowerCase(), box1, box2]);
  creados.push(r.rows[0].id);
  return r.rows[0].id;
}

async function venderA(clientId, { ubicacion = null, caja = null } = {}) {
  const v = await c.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja)
     VALUES ($1,100,100,0,'paid','efectivo',now(),$2,$3) RETURNING id`, [clientId, ubicacion, caja]);
  await c.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,100,'pending')`, [v.rows[0].id, productoId]);
  return v.rows[0].id;
}

const ficha = async (id) =>
  (await c.query("SELECT box_1, box_2 FROM clients WHERE id=$1", [id])).rows[0];

const mover = (saleIds, tipo, caja) =>
  api("/api/panel/ubicacion", { method: "PATCH", body: JSON.stringify({ saleIds, tipo, caja }) });

const proponer = (clientId, n) =>
  api(`/api/panel/ubicacion?clientId=${clientId}&productos=${n}`).then((r) => r.body);

try {
  await c.connect();
  token = tokenDePrueba();

  const p = await c.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,500,40) RETURNING id`,
    [ETIQUETA]);
  productoId = p.rows[0].id;

  // ── 1. El lector, sin tocar la base ──
  const casos = [
    ["19, 42", [19, 42], "una coma"],
    ["5", [5], "un número solo"],
    [" 7 , 8 ", [7, 8], "espacios de sobra"],
    ["caja 11 y 12", [11, 12], "escrito con palabras"],
    ["19,19", [19], "repetida"],
    ["0", [], "la caja 0, que no existe"],
    ["", [], "campo vacío"],
    [null, [], "campo nulo"],
  ];
  let leeBien = true;
  for (const [texto, esperado, porque] of casos) {
    const dio = cajasDeTexto(texto);
    if (JSON.stringify(dio) !== JSON.stringify(esperado)) {
      fail(`"${texto}" (${porque}) se leyó ${JSON.stringify(dio)}, esperaba ${JSON.stringify(esperado)}`);
      leeBien = false;
    }
  }
  if (leeBien) ok(`lee bien las ${casos.length} formas de escribir las cajas`);

  if (cajasDeTexto("5", "19, 42").join() === "5,19,42")
    ok("junta los dos campos viejos en una sola lista");
  else
    fail(`juntar los dos campos dio ${JSON.stringify(cajasDeTexto("5", "19, 42"))}`);

  // ── 2. El caso reportado: una caja escondida detrás de la coma ──
  const [cA, cB, cC, cD, cE, cF, cG] = await cajasLibres(7);
  ok(`se usan las cajas libres ${[cA,cB,cC,cD,cE,cF,cG].join(", ")}`);

  // Igual que la ficha real: una en el primer campo y dos juntas en el segundo
  const tres = await nuevaClienta("TRES", String(cA), `${cB}, ${cC}`);

  const prop = await proponer(tres, 1);
  const ofrecidas = [cA, cB, cC].filter((n) => (prop.libres || []).includes(n));
  if (ofrecidas.length === 0)
    ok(`ninguna de sus 3 cajas se ofrece como libre (antes la ${cC} sí se ofrecía)`);
  else
    fail(`se siguen ofreciendo como libres: ${ofrecidas.join(", ")}`);

  const guard = (await api("/api/panel/ubicacion", {
    method: "POST", body: JSON.stringify({ clientId: tres }),
  })).body.guardado || [];
  const vistas = guard.filter((g) => g.ubicacion === "caja").map((g) => Number(g.caja)).sort((a, b) => a - b);
  if (JSON.stringify(vistas) === JSON.stringify([cA, cB, cC].sort((a, b) => a - b)))
    ok(`su ficha muestra las 3 cajas: ${vistas.join(", ")}`);
  else
    fail(`su ficha muestra ${JSON.stringify(vistas)} en vez de las 3`);

  // ── 3. El choque: esa caja ya no se le puede dar a nadie más ──
  const otra = await nuevaClienta("OTRA");
  const choque = await api("/api/clients", {
    method: "PATCH", body: JSON.stringify({ id: otra, box_1: String(cC) }),
  });
  if (choque.status === 409 && new RegExp(String(cC)).test(choque.body.message || ""))
    ok(`avisa del choque al querer darle la ${cC} a otra clienta`);
  else
    fail(`dejó asignar la caja ${cC} dos veces (status ${choque.status}: ${choque.body.message})`);

  const aviso = (await api(`/api/clients?checkBox=${encodeURIComponent(`${cB}, ${cC}`)}&excludeId=${otra}`)).body;
  if ((aviso.conflicts || []).length === 2)
    ok("escribiendo varias juntas, avisa de todas las que ya son de alguien");
  else
    fail(`esperaba 2 choques y llegaron ${(aviso.conflicts || []).length}`);

  // ── 4. Sincronizar ya no le borra una caja ──
  const ventaEnCaja = await venderA(tres, { ubicacion: "caja", caja: cC });
  await venderA(tres);                       // pendiente sin ubicar: las otras siguen en uso
  const suelta = await venderA(tres);
  await mover([suelta], "estante");          // dispara la sincronización

  const f = await ficha(tres);
  const quedaron = cajasDeTexto(f.box_1, f.box_2);
  if ([cA, cB, cC].every((n) => quedaron.includes(n)))
    ok(`conserva sus 3 cajas al sincronizar: "${f.box_1}" (antes recortaba a 2)`);
  else
    fail(`perdió cajas al sincronizar: quedó "${f.box_1}" / "${f.box_2}"`);

  if (f.box_2 === null) ok("y las deja juntas en un solo campo, sin repartirlas");
  else fail(`quedaron repartidas: box_1="${f.box_1}" box_2="${f.box_2}"`);

  // ── 5. Con 3 cajas el cobro sigue proponiendo juntar, no inventa una cuarta ──
  const prop2 = await proponer(tres, 3);
  if (prop2.tipo === "juntar" && quedaron.includes(Number(prop2.caja)))
    ok(`con ${quedaron.length} cajas, propone juntar en la ${prop2.caja}, que ya es suya`);
  else
    fail(`propuso "${prop2.tipo}" caja "${prop2.caja}" teniendo ${quedaron.join(", ")}`);

  // ── 6. Entregar lo de una caja la libera, sin tocar las otras ──
  await c.query(`UPDATE sale_items SET delivery_status='delivered' WHERE sale_id=$1`, [ventaEnCaja]);
  await c.query(`UPDATE sales SET ubicacion=NULL, caja=NULL WHERE id=$1`, [ventaEnCaja]);
  await mover([suelta], "estante");

  const f2 = cajasDeTexto((await ficha(tres)).box_1);
  if (f2.includes(cA) && f2.includes(cB))
    ok(`sigue conservando la ${cA} y la ${cB} después de entregar lo de la ${cC}`);
  else
    fail(`quedó con ${JSON.stringify(f2)}`);

  // ── 7. Al guardar se normaliza, venga como venga escrito ──
  const limpia = await nuevaClienta("LIMPIA");
  await api("/api/clients", {
    method: "PATCH", body: JSON.stringify({ id: limpia, box_1: `caja ${cD} y ${cE}`, box_2: "" }),
  });
  const fl = await ficha(limpia);
  if (fl.box_1 === `${cD}, ${cE}` && fl.box_2 === null)
    ok(`"caja ${cD} y ${cE}" se guarda normalizado como "${fl.box_1}"`);
  else
    fail(`se guardó box_1="${fl.box_1}" box_2="${fl.box_2}"`);

  if (cajasATexto([]) === null) ok("sin cajas, el campo queda nulo y no en blanco");
  else fail(`sin cajas devolvió ${JSON.stringify(cajasATexto([]))}`);

  // ── 8. El punto de venta guarda por otra ruta: ahí también tiene que valer ──
  const desdePos = await nuevaClienta("POS");
  const guardadoPos = await api(`/api/clients/${desdePos}`, {
    method: "PATCH", body: JSON.stringify({ box_1: `${cF}, ${cG}`, box_2: "" }),
  });
  const fp = await ficha(desdePos);
  if (guardadoPos.status === 200 && fp.box_1 === `${cF}, ${cG}` && fp.box_2 === null)
    ok(`guardando desde el cobro también normaliza: "${fp.box_1}"`);
  else
    fail(`desde el cobro quedó box_1="${fp.box_1}" box_2="${fp.box_2}" (status ${guardadoPos.status})`);

  const choquePos = await api(`/api/clients/${desdePos}`, {
    method: "PATCH", body: JSON.stringify({ box_1: String(cA) }),
  });
  if (choquePos.status === 409)
    ok(`y desde el cobro también avisa del choque con la caja ${cA}`);
  else
    fail(`desde el cobro dejó pisar la caja ${cA} (status ${choquePos.status})`);

  // Cambiar solo el nombre no debe tocarle las cajas
  await api(`/api/clients/${desdePos}`, {
    method: "PATCH", body: JSON.stringify({ name: ETIQUETA + "_POS2" }),
  });
  const fp2 = await ficha(desdePos);
  if (fp2.box_1 === `${cF}, ${cG}`) ok("y editar solo el nombre no le mueve las cajas");
  else fail(`editar el nombre dejó las cajas en "${fp2.box_1}"`);
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (creados.length) {
      await c.query(
        `DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1::uuid[]))`, [creados]);
      await c.query("DELETE FROM sales WHERE client_id = ANY($1::uuid[])", [creados]);
      await c.query("DELETE FROM clients WHERE id = ANY($1::uuid[])", [creados]);
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
