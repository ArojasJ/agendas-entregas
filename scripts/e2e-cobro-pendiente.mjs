import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// Marcar entregado el último producto de una venta a crédito daba la venta por pagada
// sin avisar: a Michelle Ac le habría borrado $590. Ahora la pantalla pregunta.
// Esta prueba es la pantalla misma: que salga el cuadro, que diga el monto correcto,
// y que las dos respuestas hagan lo que prometen.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_COBRO";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let productoId;
const clientes = [];

// Chequeo solo lista lo que lleva más de 10 días sin lugar asignado, así que la
// venta de prueba se fecha atrás para que aparezca.
async function clientaConDeuda(sufijo, total, enganche) {
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8711234567') RETURNING id`,
    [`${ETIQUETA} ${sufijo}`, `@prueba_cobro_${sufijo}`]);
  const clienteId = c.rows[0].id;
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,due_date)
     VALUES ($1,$2,$3,0,'credit','efectivo',now() - interval '20 days',current_date + 15) RETURNING id`,
    [clienteId, total, enganche]);
  await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,$3,'pending')`, [v.rows[0].id, productoId, total]);
  clientes.push(clienteId);
  return { clienteId, saleId: v.rows[0].id };
}

const estado = async (saleId) => (await db.query(
  `select s.status, s.down_payment,
          coalesce((select sum(p.amount) from payments p where p.sale_id=s.id),0) abonos
   from sales s where s.id=$1`, [saleId])).rows[0];

try {
  await db.connect();

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',790,50,400) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;

  const debe = await clientaConDeuda("debe", 790, 200);     // debe $590
  const pago = await clientaConDeuda("pago", 790, 200);     // la misma, pero sí paga
  ok("dos clientas con una compra a crédito de $790 y $200 de enganche");

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Prueba Admin"));
  const page = await ctx.newPage();

  const abrirChequeo = async () => {
    await page.goto(`${BASE}/panel/chequeo`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.getByRole("heading", { name: "Chequeo" }).waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(2500);
  };

  const tarjetaDe = (sufijo) =>
    page.locator("div").filter({ hasText: `@prueba_cobro_${sufijo}` })
      .filter({ has: page.getByRole("button", { name: /Ya entregado/ }) }).last();

  // ── Marcar entregado al que sigue debiendo ──
  await abrirChequeo();
  let tarjeta = tarjetaDe("debe");
  if (await tarjeta.count() === 0) throw new Error("la clienta de prueba no aparece en Chequeo");
  await tarjeta.getByRole("button", { name: /Ya entregado/ }).first().click();

  const cuadro = page.getByText("¿Ya te pagó?");
  await cuadro.waitFor({ state: "visible", timeout: 20000 });
  ok("al marcar entregado, la pantalla pregunta en vez de dar la venta por pagada");

  let texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/\$590\.00/.test(texto)) ok("dice exactamente cuánto falta por cobrar: $590.00");
  else fail("no dice el monto correcto: " + texto.slice(0, 300));
  if (/De \$790\.00 lleva pagado \$200\.00/.test(texto)) ok("y de dónde sale: de $790.00 lleva pagado $200.00");
  else fail("no explica de dónde sale el saldo");

  // ── "No, queda a deber" ──
  await page.getByRole("button", { name: "No, queda a deber" }).click();
  await page.waitForTimeout(2000);
  let e = await estado(debe.saleId);
  if (e.status === "credit") ok('al responder "no", la venta sigue a crédito');
  else fail(`la venta quedó en "${e.status}" después de responder que no`);
  if (Number(e.down_payment) === 200 && Number(e.abonos) === 0)
    ok("y no se le tocó ni el enganche ni se inventó un abono");
  else
    fail(`se tocó el dinero: enganche $${e.down_payment}, abonos $${e.abonos}`);
  if (await page.getByText("¿Ya te pagó?").count() === 0) ok("el cuadro se cierra al responder");
  else fail("el cuadro se queda abierto");

  // ── "Sí, me pagó" ──
  await abrirChequeo();
  tarjeta = tarjetaDe("pago");
  if (await tarjeta.count() === 0) throw new Error("la segunda clienta no aparece en Chequeo");
  await tarjeta.getByRole("button", { name: /Ya entregado/ }).first().click();
  await page.getByText("¿Ya te pagó?").waitFor({ state: "visible", timeout: 20000 });

  const botonSi = page.getByRole("button", { name: /Sí, me pagó/ });
  if (/\$590\.00/.test(await botonSi.innerText())) ok("el botón de cobrar dice el monto: Sí, me pagó $590.00");
  else fail("el botón no dice el monto: " + (await botonSi.innerText()));
  await page.screenshot({ path: "scripts/cobro-pendiente.png" });
  await botonSi.click();
  await page.waitForTimeout(3000);

  e = await estado(pago.saleId);
  if (Number(e.abonos) === 590) ok('al responder "sí", entran $590 como abono real que sí cuenta en el corte');
  else fail(`el abono quedó en $${e.abonos}`);
  if (e.status === "paid") ok("y ahí sí la venta queda pagada");
  else fail(`la venta sigue en "${e.status}"`);
  if (Number(e.down_payment) === 200) ok("el enganche se respeta: siguen siendo los $200 que dio");
  else fail(`el enganche se infló a $${e.down_payment}`);
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (clientes.length) {
      await db.query(`DELETE FROM payments WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1::uuid[]))`, [clientes]);
      await db.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id = ANY($1::uuid[]))`, [clientes]);
      await db.query(`DELETE FROM sales WHERE client_id = ANY($1::uuid[])`, [clientes]);
      await db.query(`DELETE FROM clients WHERE id = ANY($1::uuid[])`, [clientes]);
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
