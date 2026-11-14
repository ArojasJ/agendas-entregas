import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// Una venta de mostrador no tiene a quién guardarle nada: la persona llega, paga y se
// va con el producto. Si nace "pendiente" se queda pendiente para siempre, porque no
// hay entrega que marcar. Con clienta sí tiene que nacer pendiente: eso se le va a
// guardar hasta que pase por ello.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_MOSTRADOR";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
let productoId, clienteId;
const ventas = [];

const vender = async (clientId, extra = {}) => {
  const r = await fetch(`${BASE}/api/sales`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("admin", "Gaby") },
    body: JSON.stringify({
      client_id: clientId,
      total: 300, discount: 0, payment_method: "efectivo", status: "paid", down_payment: 300,
      items: [{ product_id: productoId, quantity: 1, unit_price: 300 }],
      ...extra,
    }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(`la venta falló (${r.status}): ${d.message || JSON.stringify(d)}`);
  const id = d.sale?.id || d.id || d.saleId;
  if (!id) throw new Error("la respuesta no trae el id de la venta: " + JSON.stringify(d).slice(0, 200));
  ventas.push(id);
  return id;
};

const renglones = async (saleId) => (await db.query(
  `select delivery_status, delivered_at, delivered_by_name from sale_items where sale_id = $1`,
  [saleId])).rows;

try {
  await db.connect();
  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',300,50,100) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,'@prueba_mostrador','8710000000') RETURNING id`, [ETIQUETA]);
  clienteId = c.rows[0].id;

  // ── Sin clienta: nace entregado ──
  const sinClienta = await vender(null);
  let r = await renglones(sinClienta);
  if (r.length === 1 && r[0].delivery_status === "delivered")
    ok("una venta de mostrador nace entregada: no deja un pendiente que nadie va a marcar");
  else
    fail("la venta sin clienta no quedó entregada: " + JSON.stringify(r));

  if (r[0].delivered_at) ok("y con su fecha, aunque el disparador de la base solo corra al actualizar");
  else fail("quedó entregado pero SIN fecha: el disparador no cubre las altas");

  if (r[0].delivered_by_name === "Gaby") ok("firmada por quien la cobró");
  else fail("no quedó firmada: " + r[0].delivered_by_name);

  // ── Con clienta: sigue naciendo pendiente ──
  const conClienta = await vender(clienteId, { ubicacion: { tipo: "estante" } });
  r = await renglones(conClienta);
  if (r.length === 1 && r[0].delivery_status === "pending")
    ok("con clienta sigue naciendo pendiente: eso se le guarda hasta que pase por ello");
  else
    fail("la venta con clienta no quedó pendiente: " + JSON.stringify(r));

  if (!r[0].delivered_at && !r[0].delivered_by_name)
    ok("y sin fecha ni firma, porque todavía no se ha entregado");
  else
    fail("le inventó una entrega: " + JSON.stringify(r[0]));

  // ── Agregar un producto a una venta de mostrador ya hecha ──
  // Por la API, no importando editarVenta: ese módulo resuelve "@/lib/..." con el
  // alias de Next, que fuera del servidor no existe.
  const viejos = (await db.query(
    `select id, product_id, quantity, unit_price from sale_items where sale_id=$1`, [sinClienta])).rows;
  const edicion = await fetch(`${BASE}/api/sales/${sinClienta}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("admin", "Gaby") },
    body: JSON.stringify({
      action: "edit",
      discount: 0,
      resolucion: { sobrante: "efectivo", faltante: "efectivo" },
      items: [
        ...viejos.map((v) => ({ id: v.id, product_id: v.product_id, variant_id: null, quantity: v.quantity, unit_price: Number(v.unit_price) })),
        { product_id: productoId, variant_id: null, quantity: 1, unit_price: 300 },
      ],
    }),
  });
  if (!edicion.ok) throw new Error("no se pudo editar la venta: " + (await edicion.text()).slice(0, 200));
  r = await renglones(sinClienta);
  const nuevos = r.filter((x) => x.delivery_status !== "delivered");
  if (r.length === 2 && nuevos.length === 0)
    ok("y si luego se le agrega un producto a esa venta, también nace entregado");
  else
    fail("el producto agregado quedó pendiente: " + JSON.stringify(r));
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (ventas.length) {
      await db.query("DELETE FROM payments WHERE sale_id = ANY($1::uuid[])", [ventas]);
      await db.query("DELETE FROM sale_items WHERE sale_id = ANY($1::uuid[])", [ventas]);
      await db.query("DELETE FROM sales WHERE id = ANY($1::uuid[])", [ventas]);
    }
    if (clienteId) await db.query("DELETE FROM clients WHERE id=$1", [clienteId]);
    if (productoId) {
      await db.query("DELETE FROM sale_items WHERE product_id=$1", [productoId]);
      await db.query("DELETE FROM products WHERE id=$1", [productoId]);
    }
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await db.end();
}
