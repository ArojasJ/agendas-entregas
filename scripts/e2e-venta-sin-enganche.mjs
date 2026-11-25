import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// El cobro abría con el enganche ya puesto en el TOTAL. Al pasar a crédito el campo se
// quedaba así, y quien no lo borraba dejaba apuntada como liquidada una venta que la
// clienta solo había apartado: el dinero aparecía cobrado sin haber entrado al cajón.
// Pasó varias veces.
//
// Ahora nace en cero. Y como cero es el nuevo valor de arranque, dejarlo en cero tiene
// que ser una decisión: se pregunta una vez. Apartar sin dejar un peso se vale y se
// hace seguido, así que diciendo que sí la venta entra igual.
//
// Los productos de prueba llevan stock 2: con más, el Valor del Inventario se infla
// mientras la prueba corre y el dueño lee un número que no es.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_SIN_ENGANCHE";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let clienteId;
const productos = [];

const ventasDe = async () => (await db.query(
  `select id, total, down_payment, status from sales where client_id = $1 order by created_at`,
  [clienteId])).rows;

try {
  await db.connect();

  // Tres productos de $300, stock 2 cada uno
  for (const n of ["UNO", "DOS", "TRES"]) {
    const p = await db.query(
      `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',300,2,100) RETURNING id`,
      [ETIQUETA + " " + n]);
    productos.push(p.rows[0].id);
  }
  const cl = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,'@prueba_sin_enganche','8710005555') RETURNING id`,
    [ETIQUETA]);
  clienteId = cl.rows[0].id;
  ok("3 productos de $300 con stock 2 y una clienta sin cajas");

  const ctx = await browser.newContext({ viewport: { width: 1250, height: 1050 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Antonio");
  }, tokenDePrueba("admin", "Antonio"));
  const page = await ctx.newPage();

  const abrirPos = async () => {
    await page.goto(`${BASE}/panel/pos`, { waitUntil: "networkidle", timeout: 120000 });
    await page.waitForFunction(() => !/Cargando catálogo/i.test(document.body.innerText), { timeout: 90000 }).catch(() => {});
  };
  const cuerpo = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");

  // Deja el carrito con un producto y la clienta puesta, y abre el cobro
  const prepararVenta = async (nombre) => {
    await abrirPos();
    await page.getByPlaceholder(/Buscar|escanea|código/i).first().fill(ETIQUETA + " " + nombre);
    await page.waitForTimeout(1800);
    await page.locator("button:not([disabled])").filter({ hasText: ETIQUETA + " " + nombre }).first().click();
    await page.waitForTimeout(900);
    await page.getByPlaceholder(/@instagram/i).fill("prueba_sin_enganche");
    await page.waitForTimeout(1800);
    await page.getByText("@prueba_sin_enganche", { exact: false }).first().click();
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: /Siguiente/i }).first().click();
    await page.waitForTimeout(3000);
  };

  // Por su etiqueta, no por posición: el primer input numérico de la pantalla es el
  // del descuento, y midiendo ese la prueba pasaba sin estar mirando el enganche.
  const campoEnganche = () => page.getByLabel(/Monto de Apartado/i);

  // ── 1. El campo ya no nace con el total ──
  await prepararVenta("UNO");
  await page.getByRole("button", { name: /A Crédito/i }).first().click();
  await page.waitForTimeout(1200);

  const valor = await campoEnganche().inputValue();
  if (Number(valor) === 0) ok(`el enganche arranca en ${valor}, no en los $300 del total`);
  else fail(`el enganche arrancó en ${valor}: sigue viniendo lleno`);

  // Elegir dónde se guarda, que es obligatorio con clienta
  await page.getByRole("button", { name: /Poner en estante/i }).first().click();
  await page.waitForTimeout(700);

  // ── 2. Cobrar con cero pregunta antes ──
  await page.getByRole("button", { name: /Aprobar Crédito/i }).click();
  await page.waitForTimeout(1500);

  let t = await cuerpo();
  if (/¿Hacer la venta con \$0\?/i.test(t)) ok("al cobrar en cero, pregunta antes de hacerlo");
  else fail("se fue derecho sin preguntar: " + t.slice(-200));

  if (/queda debiendo los \$300\.00 completos/i.test(t))
    ok("y dice qué significa: queda debiendo los $300.00 completos");
  else
    fail("no explica lo que implica");

  await page.screenshot({ path: "scripts/venta-sin-enganche.png" });

  // ── 3. "No" no hace nada ──
  await page.getByRole("button", { name: /^No$/ }).click();
  await page.waitForTimeout(1500);

  if (!/¿Hacer la venta con \$0\?/i.test(await cuerpo())) ok("al decir que no, el aviso se cierra");
  else fail("el aviso no se cerró");

  if ((await ventasDe()).length === 0) ok("y no se registró ninguna venta");
  else fail("se guardó la venta aunque se dijo que no");

  // ── 4. Poniéndole enganche, ni pregunta ──
  await campoEnganche().fill("100");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /Aprobar Crédito/i }).click();
  await page.waitForTimeout(4000);

  if (!/¿Hacer la venta con \$0\?/i.test(await cuerpo()))
    ok("con enganche de $100 no pregunta nada: el aviso es solo para el cero");
  else
    fail("preguntó aunque sí traía enganche");

  let ventas = await ventasDe();
  if (ventas.length === 1 && Number(ventas[0].down_payment) === 100 && ventas[0].status === "credit")
    ok("se guardó a crédito con $100 de enganche, debiendo $200");
  else
    fail("quedó mal: " + JSON.stringify(ventas));

  // ── 5. Diciendo que sí, la venta en cero SÍ entra ──
  await prepararVenta("DOS");
  await page.getByRole("button", { name: /A Crédito/i }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: /Poner en estante|Juntar todo en la caja|^Caja \d+$/i }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /Aprobar Crédito/i }).click();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /Sí, sin enganche/i }).click();
  await page.waitForTimeout(4000);

  ventas = await ventasDe();
  const enCero = ventas.find((v) => Number(v.down_payment) === 0);
  if (ventas.length === 2 && enCero && enCero.status === "credit")
    ok("diciendo que sí, la venta en $0 entra: apartar sin dejar nada se sigue pudiendo");
  else
    fail("no se pudo hacer la venta en cero: " + JSON.stringify(ventas));

  // ── 6. Pago completo sigue cobrando el total ──
  await prepararVenta("TRES");
  await page.getByRole("button", { name: /Poner en estante|Juntar todo en la caja|^Caja \d+$/i }).first().click();
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: /Finalizar Cobro/i }).click();
  await page.waitForTimeout(4000);

  ventas = await ventasDe();
  const pagada = ventas.find((v) => v.status === "paid");
  if (ventas.length === 3 && pagada && Number(pagada.down_payment) === 300)
    ok("y Pago Completo sigue registrando los $300 enteros: el cero no lo tocó");
  else
    fail("se rompió el pago completo: " + JSON.stringify(ventas));
} catch (e) {
  fail(e.message);
} finally {
  try {
    const ids = (await db.query(`select id from sales where client_id = $1`, [clienteId])).rows.map((r) => r.id);
    for (const id of ids) {
      await db.query("DELETE FROM payments WHERE sale_id = $1", [id]);
      await db.query("DELETE FROM sale_items WHERE sale_id = $1", [id]);
      await db.query("DELETE FROM bitacora_tareas WHERE sale_id = $1", [id]);
      await db.query("DELETE FROM pendientes_sacar WHERE sale_id = $1", [id]);
      await db.query("DELETE FROM audit_logs WHERE entity_id = $1", [String(id)]);
      await db.query("DELETE FROM sales WHERE id = $1", [id]);
    }
    if (clienteId) await db.query("DELETE FROM clients WHERE id = $1", [clienteId]);
    await db.query("DELETE FROM products WHERE name LIKE $1", [ETIQUETA + "%"]);
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
