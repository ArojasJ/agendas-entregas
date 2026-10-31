import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const ETIQUETA = "PRUEBA_CHEQUEO";
let clienteId, productoId, token, ventaCredito, ventaContado;

const api = (metodo, cuerpo) =>
  fetch(`${BASE}/api/panel/chequeo`, {
    method: metodo,
    headers: { "Content-Type": "application/json", "x-panel-token": token },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  }).then((r) => r.json());

async function crearVenta({ estado, items, viejaDias }) {
  const v = await c.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at)
     VALUES ($1,$2,$3,0,$4,'efectivo', now() - ($5 || ' days')::interval) RETURNING id`,
    [clienteId, items * 100, estado === "credit" ? 0 : items * 100, estado, viejaDias]
  );
  const saleId = v.rows[0].id;
  const ids = [];
  for (let i = 0; i < items; i++) {
    const si = await c.query(
      `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
       VALUES ($1,$2,1,100,'pending') RETURNING id`, [saleId, productoId]);
    ids.push(si.rows[0].id);
  }
  return { saleId, ids };
}

try {
  await c.connect();
  token = tokenDePrueba();

  const p = await c.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,50,40) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  // Sin caja: el rezago es justo de quienes se quedaron sin lugar registrado
  const cl = await c.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8711234567') RETURNING id`,
    [ETIQUETA, "@pruebachequeo"]);
  clienteId = cl.rows[0].id;

  ventaCredito = await crearVenta({ estado: "credit", items: 2, viejaDias: 40 });
  ventaContado = await crearVenta({ estado: "paid", items: 1, viejaDias: 40 });

  // 1. Aparece en la lista
  const lista = await api("GET");
  const yo = (lista.clientes || []).find((x) => x.id === clienteId);
  if (yo && yo.productos.length === 3) ok(`aparece con sus 3 productos (${lista.totalClientes} clientas en total)`);
  else fail(`esperaba 3 productos, llegaron ${yo?.productos?.length ?? 0}`);

  // 1b. Quien SÍ tiene caja no debe aparecer: su lugar ya se sabe
  const conCaja = await c.query(
    `INSERT INTO clients (name,instagram,phone,box_1) VALUES ($1,$2,'8711234567','7') RETURNING id`,
    [ETIQUETA + "_CONCAJA", "@pruebaconcaja"]);
  const otroId = conCaja.rows[0].id;
  const v = await c.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at)
     VALUES ($1,100,100,0,'paid','efectivo', now() - interval '40 days') RETURNING id`, [otroId]);
  await c.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,100,'pending')`, [v.rows[0].id, productoId]);

  const lista1b = await api("GET");
  if (!(lista1b.clientes || []).some((x) => x.id === otroId)) ok("quien ya tiene caja NO aparece en el chequeo");
  else fail("apareció una clienta que sí tiene caja asignada");

  await c.query(`DELETE FROM sale_items WHERE sale_id=$1`, [v.rows[0].id]);
  await c.query("DELETE FROM sales WHERE id=$1", [v.rows[0].id]);
  await c.query("DELETE FROM clients WHERE id=$1", [otroId]);

  // 2. Marcar EN ESTANTE escribe la ubicación real
  await api("PATCH", { accion: "estante", saleIds: [ventaContado.saleId] });
  const ub = await c.query("SELECT ubicacion, caja FROM sales WHERE id=$1", [ventaContado.saleId]);
  if (ub.rows[0].ubicacion === "estante" && ub.rows[0].caja === null)
    ok("marcar en estante queda guardado en la venta");
  else fail(`la venta quedó en ubicacion="${ub.rows[0].ubicacion}"`);

  // 3. Marcar ENTREGADO propaga al resto del sistema
  await api("PATCH", { accion: "entregado", itemIds: ventaCredito.ids, clientId: clienteId });

  const items = await c.query(
    "SELECT COUNT(*) n FROM sale_items WHERE id = ANY($1) AND delivery_status='delivered'",
    [ventaCredito.ids]);
  if (Number(items.rows[0].n) === 2) ok("los productos quedan marcados como entregados");
  else fail(`solo ${items.rows[0].n} de 2 quedaron entregados`);

  const venta = await c.query("SELECT status, down_payment FROM sales WHERE id=$1", [ventaCredito.saleId]);
  if (venta.rows[0].status === "paid") ok("la venta a crédito se liquidó sola al salir todo");
  else fail(`la venta quedó en "${venta.rows[0].status}", debía liquidarse`);

  // 4. Lo marcado en estante conserva su ubicación mientras no se entregue
  const sigue = await c.query("SELECT ubicacion FROM sales WHERE id=$1", [ventaContado.saleId]);
  if (sigue.rows[0].ubicacion === "estante") ok("lo del estante conserva su ubicación");
  else fail(`la ubicación se perdió: "${sigue.rows[0].ubicacion}"`);

  // 5. Al entregar lo último, la ubicación se limpia
  await api("PATCH", { accion: "entregado", itemIds: [ventaContado.ids[0]], clientId: clienteId });
  const ubFinal = await c.query("SELECT ubicacion FROM sales WHERE id=$1", [ventaContado.saleId]);
  if (ubFinal.rows[0].ubicacion === null) ok("al salir lo último, se limpia la ubicación");
  else fail(`quedó ubicación colgada: "${ubFinal.rows[0].ubicacion}"`);

  // 6. Y desaparece de la lista
  const lista2 = await api("GET");
  if (!(lista2.clientes || []).some((x) => x.id === clienteId)) ok("desaparece de la lista al resolverse");
  else fail("sigue apareciendo en el chequeo");
} catch (e) {
  fail(e.message);
} finally {
  try {
    await c.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id=$1)`, [clienteId]);
    await c.query("DELETE FROM sales WHERE client_id=$1", [clienteId]);
    await c.query("DELETE FROM clients WHERE id=$1", [clienteId]);
    await c.query("DELETE FROM products WHERE id=$1", [productoId]);
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await c.end();
}
