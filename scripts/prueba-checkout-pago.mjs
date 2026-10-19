import { Client } from "pg";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const ETIQUETA = "PRUEBA_CHECKOUT_PAGO";
let productoId, clienteIds = [];

const stock = async () =>
  Number((await c.query("SELECT stock FROM products WHERE id=$1", [productoId])).rows[0].stock);

const pedir = async (cantidad) => {
  const r = await fetch(`${BASE}/api/public/checkout-pago`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cart: [{ id: productoId, variant_id: null, quantity: cantidad }],
      clientData: { name: ETIQUETA, phone: "8711234567", instagram: "@" + ETIQUETA.toLowerCase() },
    }),
  });
  return { status: r.status, body: await r.json() };
};

try {
  await c.connect();
  const p = await c.query(
    `INSERT INTO products (name, category, price, stock, cost) VALUES ($1,'PRUEBA',199,5,80) RETURNING id`,
    [ETIQUETA]
  );
  productoId = p.rows[0].id;

  // 1. Compra normal
  const r1 = await pedir(2);
  if (r1.status === 200 && r1.body.checkoutUrl?.startsWith("https://www.mercadopago.com.mx/"))
    ok("devuelve un enlace de pago de MercadoPago");
  else fail(`respuesta ${r1.status}: ${JSON.stringify(r1.body).slice(0, 160)}`);

  if (await stock() === 3) ok("apartó el inventario (5 → 3)");
  else fail(`el stock quedó en ${await stock()}, debía ser 3`);

  // 2. La venta quedó esperando pago y con vencimiento
  const v = await c.query("SELECT status, total, expires_at, payment_method FROM sales WHERE id=$1", [r1.body.ventaId]);
  const venta = v.rows[0];
  if (venta.status === "pending_payment") ok("la venta quedó esperando pago");
  else fail(`la venta quedó en "${venta.status}"`);

  const minutos = Math.round((new Date(venta.expires_at) - Date.now()) / 60000);
  if (minutos >= 28 && minutos <= 31) ok(`vence en ${minutos} minutos`);
  else fail(`vence en ${minutos} minutos, debía ser ~30`);

  if (Number(venta.total) === 398) ok("el total lo calculó el servidor (2 × $199 = $398)");
  else fail(`el total quedó en ${venta.total}`);

  // 3. El precio del navegador no debe mandar
  const rTrampa = await fetch(`${BASE}/api/public/checkout-pago`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cart: [{ id: productoId, variant_id: null, quantity: 1, price: 1, unit_price: 1 }],
      clientData: { name: ETIQUETA, phone: "8711234567", instagram: "@" + ETIQUETA.toLowerCase() },
    }),
  });
  const jTrampa = await rTrampa.json();
  const vTrampa = await c.query("SELECT total FROM sales WHERE id=$1", [jTrampa.ventaId]);
  if (Number(vTrampa.rows[0].total) === 199) ok("ignora el precio que manda el navegador ($1 → $199)");
  else fail(`cobró ${vTrampa.rows[0].total} en vez de 199`);

  // 4. No se puede comprar más de lo que hay
  const r4 = await pedir(99);
  if (r4.status === 409) ok("rechaza una compra sin existencias suficientes");
  else fail(`respondió ${r4.status} a una compra de 99 piezas`);

  const antes = await stock();
  await pedir(99);
  if (await stock() === antes) ok("una compra rechazada no se come el inventario");
  else fail(`el stock pasó de ${antes} a ${await stock()} tras una compra rechazada`);

  const ids = await c.query("SELECT id FROM clients WHERE name=$1", [ETIQUETA]);
  clienteIds = ids.rows.map((r) => r.id);
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (clienteIds.length) {
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
