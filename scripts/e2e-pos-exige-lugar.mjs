import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// El punto de venta proponía dónde guardar pero no obligaba: se podía cobrar sin
// lugar y la mercancía acababa en la bolsa de "no se sabe dónde está".
//
// Ahora lo exige SOLO cuando hay clienta. Sin clienta es una venta de mostrador: el
// producto sale por la puerta en ese momento, nunca se guarda, y pedir caja estorba.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_EXIGE";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let clienteId, productoId;

const ventasDe = async (nombre) => (await db.query(
  `select s.id, s.ubicacion, s.caja, s.client_id from sales s
   join sale_items i on i.sale_id = s.id join products p on p.id = i.product_id
   where p.name = $1`, [nombre])).rows;

try {
  await db.connect();

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,99,40) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8711234567') RETURNING id`,
    [ETIQUETA, "@prueba_exige"]);
  clienteId = c.rows[0].id;

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Prueba Admin"));
  const page = await ctx.newPage();

  const abrirPos = async () => {
    await page.goto(`${BASE}/panel/pos`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.getByPlaceholder(/nombre, SKU o código/i).first().waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(1200);
  };
  const agregarProducto = async () => {
    await page.getByPlaceholder(/nombre, SKU o código/i).first().fill(ETIQUETA);
    await page.waitForTimeout(1500);
    await page.getByText(ETIQUETA, { exact: false }).first().click();
    await page.waitForTimeout(900);
  };

  // ── Venta de mostrador: sin clienta, tiene que poder cobrarse ──
  await abrirPos();
  await agregarProducto();
  // El cobro va en dos pasos: "Siguiente" abre el método de pago y ahí se finaliza.
  await page.getByRole("button", { name: "Siguiente →" }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /Finalizar Cobro/i }).click();
  await page.waitForTimeout(3500);

  let ventas = await ventasDe(ETIQUETA);
  const mostrador = ventas.filter((v) => !v.client_id);
  if (mostrador.length === 1) ok("sin clienta, la venta de mostrador se cobra sin pedir caja");
  else fail(`esperaba 1 venta de mostrador y hay ${mostrador.length}`);

  // ── Con clienta y sin lugar: no debe dejar ──
  await abrirPos();
  await agregarProducto();
  await page.getByPlaceholder(/@instagram o por nombre/i).first().fill(ETIQUETA);
  await page.waitForTimeout(1800);
  await page.getByText("@prueba_exige", { exact: false }).first().click();
  await page.waitForTimeout(2500);

  // Quitar la sugerencia: se toca la opción ya elegida para dejarla sin lugar no se
  // puede, así que se comprueba al revés — que venga sugerida y que al cobrar se
  // guarde con lugar.
  // El selector de lugar vive dentro del cuadro de método de pago, no en la lista.
  await page.getByRole("button", { name: "Siguiente →" }).click();
  await page.waitForTimeout(2500);
  const texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/Poner en estante/i.test(texto)) ok("al elegir clienta, el cobro pregunta dónde guardarlo");
  else fail("no propone lugar con clienta: " + texto.slice(0, 400));
  if (/Sugerido/i.test(texto)) ok("y trae una sugerida, para no frenar la venta");
  else fail("no sugiere ninguna");

  await page.getByRole("button", { name: /Finalizar Cobro/i }).click();
  await page.waitForTimeout(3500);

  ventas = await ventasDe(ETIQUETA);
  const conClienta = ventas.filter((v) => v.client_id === clienteId);
  if (conClienta.length === 1) ok("la venta con clienta se registra");
  else fail(`esperaba 1 venta con clienta y hay ${conClienta.length}`);
  if (conClienta[0]?.ubicacion) ok(`y queda con lugar anotado: ${conClienta[0].ubicacion}${conClienta[0].caja ? " " + conClienta[0].caja : ""}`);
  else fail("la venta con clienta quedó SIN lugar");

  await page.screenshot({ path: "scripts/pos-exige-lugar.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    const ventas = await ventasDe(ETIQUETA);
    if (ventas.length) {
      const ids = ventas.map((v) => v.id);
      await db.query("DELETE FROM payments WHERE sale_id = ANY($1::uuid[])", [ids]);
      await db.query("DELETE FROM sale_items WHERE sale_id = ANY($1::uuid[])", [ids]);
      await db.query("DELETE FROM sales WHERE id = ANY($1::uuid[])", [ids]);
    }
    if (clienteId) await db.query("DELETE FROM clients WHERE id=$1", [clienteId]);
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
