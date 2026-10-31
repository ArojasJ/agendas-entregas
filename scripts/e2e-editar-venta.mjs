import { chromium, devices } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const ETIQUETA = "PRUEBA_E2E_EDITAR";
const token = tokenDePrueba("admin", "Prueba Admin");
const tokenRepa = tokenDePrueba("driver", "Prueba Repartidor");

let browser, productoId, clienteId, ventaId, corteId;

// El catálogo son 2 mil y pico de productos: tarda un par de segundos en llegar
const esperarCatalogo = (pg) =>
  pg.waitForSelector("input[placeholder*='Agregar producto']", { timeout: 25000 });

const sesion = (page, t, rol) =>
  page.addInitScript(([tk, r]) => {
    localStorage.setItem("panelToken", tk);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", r);
    localStorage.setItem("staffName", "Prueba");
  }, [t, rol]);

try {
  await c.connect();
  browser = await chromium.launch();

  const p = await c.query(
    "INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,50,40) RETURNING id", [ETIQUETA]);
  productoId = p.rows[0].id;
  await c.query(
    "INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,20,40)", [ETIQUETA + "_SEGUNDO"]);
  const cl = await c.query(
    "INSERT INTO clients (name,instagram,phone,saldo_favor) VALUES ($1,$2,'8711234567',0) RETURNING id",
    [ETIQUETA, "@prueba_e2e_editar"]);
  clienteId = cl.rows[0].id;

  const creada = await (await fetch(`${BASE}/api/sales`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-panel-token": token },
    body: JSON.stringify({
      client_id: clienteId, total: 200, discount: 0, payment_method: "efectivo",
      status: "paid", down_payment: 200,
      items: [{ product_id: productoId, variant_id: null, quantity: 2, unit_price: 100 }],
    }),
  })).json();
  ventaId = creada.sale?.id;
  if (!ventaId) throw new Error("no se pudo crear la venta de prueba");

  // ── En el celular, que es desde donde cobran ──
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await sesion(page, token, "admin");
  await page.goto(`${BASE}/panel/ventas/${ventaId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const botonEditar = page.getByRole("button", { name: /Editar venta/ });
  if (await botonEditar.count() === 1) ok("el botón Editar venta aparece en la ficha");
  else fail(`botones Editar venta: ${await botonEditar.count()}`);

  await botonEditar.click();
  await esperarCatalogo(page);
  await page.waitForTimeout(400);
  if (await page.getByText("Total nuevo").isVisible()) ok("abre la pantalla de edición");
  else fail("no abrió la pantalla de edición");

  const alto = await page.evaluate(() => window.innerHeight);
  const ancho = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (ancho[0] <= ancho[1] + 2) ok(`no se sale de la pantalla a lo ancho (${ancho[0]} <= ${ancho[1]})`);
  else fail(`se desborda: ${ancho[0]} > ${ancho[1]}`);

  const guardar = page.getByRole("button", { name: /Guardar cambios/ });
  const cajaGuardar = await guardar.boundingBox();
  if (cajaGuardar && cajaGuardar.y + cajaGuardar.height <= alto + 1)
    ok("el botón de guardar se alcanza sin pelearse con la pantalla");
  else fail(`el botón de guardar queda fuera: ${JSON.stringify(cajaGuardar)}`);

  if ((await page.getByText("Catálogo $100.00").count()) > 0) ok("muestra el precio de catálogo a un lado");
  else fail("no muestra el precio de catálogo");

  await page.screenshot({ path: "scripts/editar-venta-movil.png" });

  // ── Bajar la cantidad: debe avisar que sobra dinero ──
  await page.getByRole("button", { name: "-", exact: true }).first().click();
  await page.waitForTimeout(500);
  if ((await page.getByText(/Sobran \$100\.00/).count()) > 0) ok("al quitar una pieza avisa que sobran $100.00");
  else fail("no avisó que sobraba dinero");

  const devolver = page.getByRole("button", { name: /Devolver en efectivo/ });
  if (await devolver.count() === 1) ok("ofrece devolver en efectivo como opción principal");
  else fail("no ofrece devolver en efectivo");

  // El aviso del dinero es la decisión que importa: no puede quedar bajo el doblez
  const cajaAviso = await page.getByText(/Sobran \$100\.00/).boundingBox();
  if (cajaAviso && cajaAviso.y + cajaAviso.height <= alto + 1)
    ok("el aviso del dinero se ve sin tener que bajarle");
  else fail(`el aviso del dinero queda fuera de la pantalla: ${JSON.stringify(cajaAviso)}`);

  // ── Bajarle el precio al renglón ──
  const campoPrecio = page.locator("input[type='number']").first();
  await campoPrecio.fill("80");
  await page.waitForTimeout(500);
  const clases = await campoPrecio.getAttribute("class");
  if (clases.includes("amber")) ok("el precio cambiado se marca en color");
  else fail("el precio cambiado no se marca");

  if ((await page.getByText(/Sobran \$120\.00/).count()) > 0) ok("y el total se recalcula solo: sobran $120.00");
  else fail("el total no se recalculó al cambiar el precio");

  await page.screenshot({ path: "scripts/editar-venta-sobra.png" });

  await guardar.click();
  await page.waitForTimeout(2500);

  const v = (await c.query("select total, down_payment, status from sales where id=$1", [ventaId])).rows[0];
  if (Number(v.total) === 80 && Number(v.down_payment) === 80) ok("se guardó: total $80 y enganche $80");
  else fail(`quedó total ${v.total}, enganche ${v.down_payment}`);

  const stock = Number((await c.query("select stock from products where id=$1", [productoId])).rows[0].stock);
  if (stock === 49) ok("y la pieza que se quitó regresó al inventario");
  else fail(`el inventario quedó en ${stock}, esperaba 49`);

  if ((await page.getByText(/Devuélvele/).count()) > 0) ok("le dice a la trabajadora cuánto devolver");
  else fail("no avisó cuánto devolver");

  // ── Agregar un producto desde la edición ──
  await page.getByRole("button", { name: /Editar venta/ }).click();
  await esperarCatalogo(page);
  await page.waitForTimeout(400);
  await page.getByPlaceholder(/Agregar producto/).fill("_SEGUNDO");
  await page.waitForTimeout(700);
  const resultado = page.locator("div.absolute button", { hasText: "_SEGUNDO" }).first();
  if (await resultado.count() > 0) ok("el buscador encuentra productos para agregar");
  else fail("el buscador no encontró nada");
  await resultado.click();
  await page.waitForTimeout(500);

  if ((await page.getByText(/Faltan \$100\.00/).count()) > 0) ok("al agregar un producto avisa que faltan $100.00");
  else fail("no avisó que faltaba dinero");

  const quedaDebiendo = page.getByRole("button", { name: /queda debiendo/ });
  if (await quedaDebiendo.count() === 1) ok("ofrece dejarla a crédito");
  else fail("no ofrece dejarla a crédito");
  // Volver a agregar lo que ya está en la venta le sube la cantidad, no duplica el renglón
  await page.getByPlaceholder(/Agregar producto/).fill("_SEGUNDO");
  await page.waitForTimeout(700);
  await page.locator("div.absolute button", { hasText: "_SEGUNDO" }).first().click();
  await page.waitForTimeout(500);
  if ((await page.getByText(/Faltan \$200\.00/).count()) > 0) ok("agregar otra vez el mismo producto le sube la cantidad");
  else fail("agregar dos veces el mismo producto no subió la cantidad");
  await page.getByRole("button", { name: "-", exact: true }).last().click();
  await page.waitForTimeout(400);

  await quedaDebiendo.click();
  await page.getByRole("button", { name: /Guardar cambios/ }).click();
  await page.waitForTimeout(2500);

  const v2 = (await c.query("select total, status from sales where id=$1", [ventaId])).rows[0];
  if (Number(v2.total) === 180 && v2.status === "credit") ok("se guardó a crédito con total $180");
  else fail(`quedó total ${v2.total}, estado ${v2.status}`);

  // ── A crédito: deber no es un faltante que cobrar ──
  await page.getByRole("button", { name: /Editar venta/ }).click();
  await esperarCatalogo(page);
  await page.waitForTimeout(400);

  if ((await page.getByText(/Queda debiendo \$100\.00/).count()) > 0)
    ok("en una venta a crédito dice 'queda debiendo', no 'faltan'");
  else fail("no usa el lenguaje de crédito");

  const sigueDebiendo = page.getByRole("button", { name: /Sigue debiendo/ });
  const clasesSigue = await sigueDebiendo.getAttribute("class");
  if (clasesSigue.includes("emerald")) ok("y viene marcada la opción de que siga debiendo");
  else fail("la opción marcada por omisión no es 'sigue debiendo'");

  const clasesPago = await page.getByRole("button", { name: /Me pagó todo/ }).getAttribute("class");
  if (!clasesPago.includes("emerald")) ok("'me pagó todo' NO viene marcada: hay que escogerla a propósito");
  else fail("'me pagó todo' viene marcada sola: daría por liquidada una venta sin pagar");

  await page.screenshot({ path: "scripts/editar-venta-credito.png" });

  // Guardar sin tocar nada no debe liquidarle la venta
  await page.getByRole("button", { name: /Guardar cambios/ }).click();
  await page.waitForTimeout(2500);
  const v3 = (await c.query("select status, down_payment from sales where id=$1", [ventaId])).rows[0];
  if (v3.status === "credit" && Number(v3.down_payment) === 80)
    ok("guardar sin tocar nada la deja igual de a crédito: no se liquida sola");
  else fail(`la venta quedó ${v3.status} con enganche ${v3.down_payment}`);

  const anchoFicha = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (anchoFicha[0] <= anchoFicha[1] + 2) ok(`la ficha de la venta no se desborda a lo ancho (${anchoFicha[0]} <= ${anchoFicha[1]})`);
  else fail(`la ficha se desborda: ${anchoFicha[0]} > ${anchoFicha[1]}`);

  // ── Una venta ya cortada queda con candado ──
  const corte = await c.query(
    "INSERT INTO pos_cuts (from_datetime, to_datetime, total_amount) VALUES (now(), now(), 0) RETURNING id");
  corteId = corte.rows[0].id;
  await c.query("UPDATE sales SET pos_cut_id=$1 WHERE id=$2", [corteId, ventaId]);
  await page.goto(`${BASE}/panel/ventas/${ventaId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  if ((await page.getByRole("button", { name: /Editar venta/ }).count()) === 0) ok("en una venta cortada no hay botón de editar");
  else fail("una venta cortada deja editar");
  if ((await page.getByText(/Cerrada por corte/).count()) > 0) ok("y explica por qué: cerrada por corte");
  else fail("no explica por qué no se puede editar");
  await page.screenshot({ path: "scripts/editar-venta-cortada.png" });
  await c.query("UPDATE sales SET pos_cut_id=NULL WHERE id=$1", [ventaId]);

  // ── El repartidor no ──
  const ctx2 = await browser.newContext({ ...devices["iPhone 13"] });
  const page2 = await ctx2.newPage();
  await sesion(page2, tokenRepa, "driver");
  await page2.goto(`${BASE}/panel/ventas/${ventaId}`, { waitUntil: "networkidle" });
  await page2.waitForTimeout(1200);
  if ((await page2.getByRole("button", { name: /Editar venta/ }).count()) === 0) ok("al repartidor no le sale el botón");
  else fail("el repartidor ve el botón de editar");

  // ── Y en computadora ──
  const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page3 = await ctx3.newPage();
  await sesion(page3, token, "admin");
  await page3.goto(`${BASE}/panel/ventas/${ventaId}`, { waitUntil: "networkidle" });
  await page3.waitForTimeout(1200);
  await page3.getByRole("button", { name: /Editar venta/ }).click();
  await esperarCatalogo(page3);
  await page3.waitForTimeout(400);
  if (await page3.getByText("Total nuevo").isVisible()) ok("en computadora también abre bien");
  else fail("en computadora no abrió");
  await page3.screenshot({ path: "scripts/editar-venta-escritorio.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (ventaId) {
      await c.query("UPDATE sales SET pos_cut_id=NULL WHERE id=$1", [ventaId]);
      await c.query("DELETE FROM bitacora_tareas WHERE sale_id=$1", [ventaId]);
      await c.query("DELETE FROM payments WHERE sale_id=$1", [ventaId]);
      await c.query("DELETE FROM sale_items WHERE sale_id=$1", [ventaId]);
      await c.query("DELETE FROM audit_logs WHERE entity_id=$1", [String(ventaId)]);
      await c.query("DELETE FROM sales WHERE id=$1", [ventaId]);
    }
    if (corteId) await c.query("DELETE FROM pos_cuts WHERE id=$1", [corteId]);
    if (clienteId) await c.query("DELETE FROM clients WHERE id=$1", [clienteId]);
    await c.query("DELETE FROM sale_items WHERE product_id IN (SELECT id FROM products WHERE name LIKE $1)", [ETIQUETA + "%"]);
    await c.query("DELETE FROM products WHERE name LIKE $1", [ETIQUETA + "%"]);
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  if (browser) await browser.close();
  await c.end();
}
