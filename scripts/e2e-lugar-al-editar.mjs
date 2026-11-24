import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// El caso de @miroslava.hm: le vendió una cosa, quedó en el estante, y después le
// editó la venta para agregarle una cartera. Acabó con dos productos en el estante y
// el sistema nunca le propuso juntarlos en una caja —al cobrar sí pregunta, al
// corregir la venta no preguntaba nunca— y desde la venta tampoco había forma de
// cambiarlo: el único camino era acordarse de que la ficha de la clienta lo permite.
//
// Dos cosas, entonces: que al AGREGAR productos vuelva a preguntar dónde van, y que
// la venta deje mover el lugar cuando se quiera.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_LUGAR_EDIT";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let clienteId, ventaId;
const productos = {};

const venta = async () => (await db.query(
  `select ubicacion, caja from sales where id = $1`, [ventaId])).rows[0];
const lugaresDeLosProductos = async () => (await db.query(
  `select ubicacion, caja from sale_items where sale_id = $1`, [ventaId])).rows;

try {
  await db.connect();

  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,'@prueba_lugar_edit','8710008888') RETURNING id`, [ETIQUETA]);
  clienteId = c.rows[0].id;

  for (const n of ["SET MIST", "CARTERA"]) {
    const p = await db.query(
      `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',$2,5,50) RETURNING id`,
      [ETIQUETA + " " + n, n === "CARTERA" ? 500 : 130]);
    productos[n] = p.rows[0].id;
  }

  // Un solo producto, en el estante: lo correcto cuando se cobró
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja)
     VALUES ($1,130,0,0,'credit','efectivo',now(),'estante',null) RETURNING id`, [clienteId]);
  ventaId = v.rows[0].id;
  await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,130,'pending')`, [ventaId, productos["SET MIST"]]);
  ok("venta de un solo producto, en el estante: lo correcto para una sola cosa");

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Antonio");
  }, tokenDePrueba("admin", "Antonio"));
  const page = await ctx.newPage();

  const abrir = async () => {
    await page.goto(`${BASE}/panel/ventas/${ventaId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByRole("heading", { name: /Detalle de Venta/i }).waitFor({ state: "visible", timeout: 60000 });
    await page.waitForTimeout(2500);
  };
  const cuerpo = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");

  // ── 1. Cambiar solo el precio NO debe preguntar nada ──
  await abrir();
  await page.getByRole("button", { name: /Editar venta/i }).click();
  await page.waitForTimeout(2500);
  const precio = page.locator('input[type="number"]').first();
  await precio.fill("140");
  await page.waitForTimeout(1200);
  if (!/¿Dónde se guardan\?/i.test(await cuerpo()))
    ok("cambiar un precio no pregunta por el lugar: eso sería ruido");
  else
    fail("preguntó por el lugar sin que se agregara nada");

  // ── 2. Agregar un producto SÍ vuelve a preguntar ──
  await page.getByPlaceholder(/Agregar producto/i).fill(ETIQUETA + " CARTERA");
  await page.waitForTimeout(2500);
  await page.getByRole("button", { name: new RegExp(ETIQUETA + " CARTERA") }).first().click();
  await page.waitForTimeout(3000);

  let t = await cuerpo();
  if (/Ahora son 2 productos\. ¿Dónde se guardan\?/i.test(t))
    ok("al agregar el segundo producto vuelve a preguntar dónde se guardan");
  else
    fail("siguió sin preguntar: " + (t.match(/Ahora son[^¿]{0,40}/i) || ["(nada)"])[0]);

  const sugerida = (t.match(/Caja (\d+)/) || [])[1];
  if (sugerida) ok(`y propone una caja (la ${sugerida}) en vez de dejarlo en el estante`);
  else fail("no propuso caja: " + t.slice(t.indexOf("Ahora son"), t.indexOf("Ahora son") + 300));

  if (/Tiene cosas en estante/i.test(t)) ok("diciendo por qué: ya tiene cosas en estante");
  else fail("no explica el motivo");

  await page.screenshot({ path: "scripts/lugar-al-editar.png" });

  await page.getByRole("button", { name: /Guardar cambios/i }).click();
  await page.waitForTimeout(5000);

  // ── Lo que de verdad importa: que la mercancía quedó anotada en la caja ──
  const vd = await venta();
  if (vd.ubicacion === "caja" && String(vd.caja) === sugerida)
    ok(`la venta quedó guardada en la caja ${sugerida}, no en el estante`);
  else
    fail("la venta no se movió: " + JSON.stringify(vd));

  const lp = await lugaresDeLosProductos();
  if (lp.length === 2 && lp.every((l) => l.ubicacion === "caja" && String(l.caja) === sugerida))
    ok("y los dos productos dicen la misma caja: el disparador les bajó el lugar");
  else
    fail("los productos quedaron en otro lado: " + JSON.stringify(lp));

  // ── 3. Desde la venta se puede cambiar el lugar cuando se quiera ──
  await abrir();
  t = await cuerpo();
  if (new RegExp(`Dónde está .{0,3}Caja ${sugerida}\\b`, "i").test(t))
    ok(`la venta enseña su caja nueva: la ${sugerida}`);
  else
    fail("la venta no enseña la caja: " + (t.match(/Dónde está.{0,40}/i) || ["?"])[0]);

  const cambiar = page.getByRole("button", { name: /^Cambiar$/ }).first();
  if (await cambiar.count() > 0) ok("y ofrece cambiarlo ahí mismo, sin ir a la ficha de la clienta");
  else fail("no hay forma de cambiar el lugar desde la venta");

  await cambiar.click();
  await page.waitForTimeout(3000);
  if (/¿Dónde se guarda\?/i.test(await cuerpo())) ok("abre el mismo cuadro de siempre");
  else fail("no abrió el cuadro de ubicación");

  await page.getByRole("button", { name: /Poner en estante/i }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /^Guardar$/ }).click();
  await page.waitForTimeout(4000);

  const vd2 = await venta();
  if (vd2.ubicacion === "estante" && vd2.caja === null)
    ok("se regresó al estante desde la propia venta");
  else
    fail("no se movió al estante: " + JSON.stringify(vd2));

  const lp2 = await lugaresDeLosProductos();
  if (lp2.every((l) => l.ubicacion === "estante"))
    ok("y los productos se fueron con ella");
  else
    fail("los productos se quedaron atrás: " + JSON.stringify(lp2));

  // ── 4. Y la caja queda libre otra vez, no apartada a nombre de nadie ──
  const ficha = await db.query(`select box_1, box_2 from clients where id = $1`, [clienteId]);
  if (!ficha.rows[0].box_1 && !ficha.rows[0].box_2)
    ok("la ficha de la clienta ya no dice que ocupe caja: la caja quedó libre");
  else
    fail("le quedó una caja apuntada: " + JSON.stringify(ficha.rows[0]));
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (ventaId) {
      await db.query("DELETE FROM pendientes_sacar WHERE sale_id = $1", [ventaId]);
      await db.query("DELETE FROM sale_items WHERE sale_id = $1", [ventaId]);
      await db.query("DELETE FROM bitacora_tareas WHERE sale_id = $1", [ventaId]);
      await db.query("DELETE FROM audit_logs WHERE entity_id = $1", [String(ventaId)]);
      await db.query("DELETE FROM sales WHERE id = $1", [ventaId]);
    }
    if (clienteId) await db.query("DELETE FROM clients WHERE id = $1", [clienteId]);
    await db.query("DELETE FROM products WHERE name LIKE $1", [ETIQUETA + "%"]);
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
