import { Client } from "pg";
import crypto from "crypto";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const ETIQUETA = "PRUEBA_WEBHOOK";
let productoId, clienteIds = [];

const avisar = async (recursoId, { firmar = true } = {}) => {
  const secreto = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const ts = Math.floor(Date.now() / 1000);
  const reqId = crypto.randomUUID();
  const headers = { "Content-Type": "application/json", "x-request-id": reqId };

  if (secreto) {
    const manifiesto = `id:${recursoId};request-id:${reqId};ts:${ts};`;
    const v1 = firmar
      ? crypto.createHmac("sha256", secreto).update(manifiesto).digest("hex")
      : "0".repeat(64);
    headers["x-signature"] = `ts=${ts},v1=${v1}`;
  }

  const r = await fetch(`${BASE}/api/mercadopago/webhook?data.id=${recursoId}`, {
    method: "POST", headers,
    body: JSON.stringify({ type: "payment", data: { id: recursoId } }),
  });
  return { status: r.status, body: await r.json() };
};

const estado = async (id) =>
  (await c.query("SELECT status, down_payment FROM sales WHERE id=$1", [id])).rows[0];

try {
  await c.connect();
  const p = await c.query(
    `INSERT INTO products (name, category, price, stock, cost) VALUES ($1,'PRUEBA',250,5,100) RETURNING id`,
    [ETIQUETA]
  );
  productoId = p.rows[0].id;

  const pedido = await (await fetch(`${BASE}/api/public/checkout-pago`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cart: [{ id: productoId, variant_id: null, quantity: 1 }],
      clientData: { name: ETIQUETA, phone: "8711234567", instagram: "@" + ETIQUETA.toLowerCase() },
    }),
  })).json();

  if (!pedido.ventaId) throw new Error("no se pudo crear el pedido de prueba");
  ok("pedido de prueba creado, esperando pago");

  // 1. Un aviso de un recurso inexistente no debe cobrar nada
  const r1 = await avisar("999999999999");
  const e1 = await estado(pedido.ventaId);
  if (r1.status === 200 && e1.status === "pending_payment")
    ok("un aviso de un pago inexistente no marca la venta pagada");
  else fail(`la venta quedó en "${e1.status}" tras un aviso falso`);

  // 2. Siempre 200, para que MercadoPago no reintente para siempre
  if (r1.status === 200) ok("responde 200 aunque el aviso no aplique");
  else fail(`respondió ${r1.status}`);

  // 3. Con firma inválida se ignora
  if (process.env.MERCADOPAGO_WEBHOOK_SECRET) {
    const r3 = await avisar("999999999999", { firmar: false });
    if (r3.body?.nota === "firma inválida") ok("rechaza un aviso con firma inválida");
    else fail(`no rechazó la firma inválida: ${JSON.stringify(r3.body)}`);
  } else {
    out.push("  --    (sin secreto configurado: la firma se probará en producción)");
  }

  // 4. La idempotencia: marcar pagada a mano y avisar dos veces no debe duplicar abonos
  await c.query("UPDATE sales SET status='paid', down_payment=250 WHERE id=$1", [pedido.ventaId]);
  await c.query("INSERT INTO payments (sale_id, amount) VALUES ($1, 250)", [pedido.ventaId]);
  await avisar("999999999999");
  const abonos = await c.query("SELECT COUNT(*) n FROM payments WHERE sale_id=$1", [pedido.ventaId]);
  if (Number(abonos.rows[0].n) === 1) ok("un aviso repetido no duplica el abono");
  else fail(`quedaron ${abonos.rows[0].n} abonos`);

  const ids = await c.query("SELECT id FROM clients WHERE name=$1", [ETIQUETA]);
  clienteIds = ids.rows.map((r) => r.id);
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (clienteIds.length) {
      await c.query(`DELETE FROM payments WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clienteIds]);
      await c.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clienteIds]);
      await c.query("DELETE FROM sales WHERE client_id = ANY($1)", [clienteIds]);
      await c.query("DELETE FROM clients WHERE id = ANY($1)", [clienteIds]);
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
