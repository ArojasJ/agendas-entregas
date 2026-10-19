import { chromium } from "playwright";
import { Client } from "pg";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 1000 } });
const page = await ctx.newPage();

const ETIQUETA = "PRUEBA_TIENDA_E2E";
let productoId, clienteIds = [];

try {
  await db.connect();
  const p = await db.query(
    `INSERT INTO products (name, category, price, stock, cost, description)
     VALUES ($1,'PRUEBA',349,4,150,'Producto de prueba') RETURNING id`, [ETIQUETA]
  );
  productoId = p.rows[0].id;

  // Vista previa de pago en línea, sin tocar lo que ven las clientas
  await page.addInitScript(() => localStorage.setItem("noreste_checkout_preview", "tienda"));
  await page.goto(`${BASE}/catalogo/producto/${productoId}`, { waitUntil: "networkidle", timeout: 60000 });
  ok("abre la página del producto");

  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await page.waitForTimeout(1200);

  // El botón del carrito es el del ícono con el contador
  await page.getByRole("button", { name: /🛒/ }).first().click();
  await page.waitForTimeout(900);

  const botonPagar = page.getByRole("button", { name: /Pagar \$/ });
  if (await botonPagar.count() > 0) ok(`el botón dice "${(await botonPagar.first().textContent()).trim()}"`);
  else fail("el carrito no muestra el botón de pagar");

  // Llenar datos y pagar
  await page.getByPlaceholder("Tu nombre *").fill("Prueba E2E");
  await page.getByPlaceholder("WhatsApp *").fill("8711234567");
  await page.getByPlaceholder("instagram *").fill("@" + ETIQUETA.toLowerCase());

  const navegacion = page.waitForURL(/mercadopago\.com/, { timeout: 30000 }).then(() => true).catch(() => false);
  await botonPagar.first().click();
  const llego = await navegacion;

  if (llego) ok("redirige a MercadoPago para cobrar");
  else fail(`no redirigió; quedó en ${page.url()}`);

  // La venta debe existir, esperando pago, con el inventario apartado
  const v = await db.query(
    `SELECT s.id, s.status, s.total, s.expires_at FROM sales s
     JOIN clients c ON c.id = s.client_id WHERE c.name = $1 ORDER BY s.created_at DESC LIMIT 1`,
    ["Prueba E2E"]
  );
  if (v.rows[0]?.status === "pending_payment") ok(`la venta quedó esperando pago ($${v.rows[0].total})`);
  else fail(`la venta quedó en "${v.rows[0]?.status ?? "no existe"}"`);

  const st = await db.query("SELECT stock FROM products WHERE id=$1", [productoId]);
  if (Number(st.rows[0].stock) === 3) ok("apartó el inventario (4 → 3)");
  else fail(`el stock quedó en ${st.rows[0].stock}`);

  // La pantalla de regreso
  const ventaId = v.rows[0].id;
  await page.goto(`${BASE}/compra/${ventaId}?pago=ok`, { waitUntil: "networkidle", timeout: 60000 });
  await page.getByText("¡Pago recibido!").waitFor({ timeout: 10000 });
  ok("la pantalla de regreso confirma el pago");

  const carrito = await page.evaluate(() => localStorage.getItem("noreste_cart_v2"));
  if (!carrito) ok("al pagar, el carrito se vacía");
  else fail("el carrito siguió lleno después de pagar");

  await page.goto(`${BASE}/compra/${ventaId}?pago=fallo`, { waitUntil: "networkidle", timeout: 60000 });
  await page.getByText("El pago no se completó").waitFor({ timeout: 10000 });
  ok("también avisa cuando el pago falla");

  const ids = await db.query("SELECT id FROM clients WHERE name=$1", ["Prueba E2E"]);
  clienteIds = ids.rows.map((r) => r.id);
} catch (e) {
  fail(e.message);
  await page.screenshot({ path: "scripts/e2e-fallo.png" }).catch(() => {});
} finally {
  try {
    if (clienteIds.length) {
      await db.query(`DELETE FROM payments WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clienteIds]);
      await db.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1))`, [clienteIds]);
      await db.query("DELETE FROM sales WHERE client_id = ANY($1)", [clienteIds]);
      await db.query("DELETE FROM clients WHERE id = ANY($1)", [clienteIds]);
    }
    if (productoId) {
      await db.query("DELETE FROM sale_items WHERE product_id=$1", [productoId]);
      await db.query("DELETE FROM products WHERE id=$1", [productoId]);
    }
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
