import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// Con dos compras en estante, al mandar la primera a una caja ya no se podía mandar la
// segunda a esa misma caja: la lista de "mover" solo ofrecía cajas LIBRES, y esa había
// dejado de estarlo justo por ser suya. Obligaba a quemar una segunda caja.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_MOVER";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let clienteId, productoId;

try {
  await db.connect();

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,50,40) RETURNING id`,
    [ETIQUETA]);
  productoId = p.rows[0].id;

  const cl = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8711234567') RETURNING id`,
    [ETIQUETA, "@prueba_mover"]);
  clienteId = cl.rows[0].id;

  // Dos ventas distintas, las dos en estante, como en el caso reportado
  const ventas = [];
  for (const nombre of ["PRIMERA", "SEGUNDA"]) {
    const v = await db.query(
      `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion)
       VALUES ($1,100,100,0,'paid','efectivo',now(),'estante') RETURNING id`, [clienteId]);
    await db.query(
      `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
       VALUES ($1,$2,1,100,'pending')`, [v.rows[0].id, productoId]);
    ventas.push({ nombre, id: v.rows[0].id });
  }
  ok("la clienta arranca con 2 compras en estante");

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Prueba Admin"));
  const page = await ctx.newPage();

  await page.goto(`${BASE}/panel/clientes`, { waitUntil: "networkidle", timeout: 90000 });
  await page.getByPlaceholder(/Buscar/i).first().fill(ETIQUETA);
  await page.waitForTimeout(1200);

  const renglon = page.locator("div").filter({ hasText: ETIQUETA })
    .filter({ has: page.getByRole("button", { name: "✏️" }) }).last();
  await renglon.getByRole("button", { name: "✏️" }).first().click();
  await page.waitForTimeout(1500);

  const botonesMover = page.getByRole("button", { name: "Mover" });
  if (await botonesMover.count() !== 2) throw new Error(`esperaba 2 botones Mover y hay ${await botonesMover.count()}`);
  ok("su ficha muestra las 2 compras con su botón de Mover");

  // ── Primera compra a una caja nueva ──
  await botonesMover.first().click();
  await page.waitForTimeout(600);
  // Tolerante al nombre viejo ("A otra caja") para que la prueba sirva de
  // comparación contra el código anterior
  const nuevas = page.locator("p", { hasText: /^A (una caja nueva|otra caja)$/ }).locator("..").locator("button");
  if (await nuevas.count() === 0) throw new Error("no se ofrecen cajas nuevas");
  const caja = (await nuevas.first().innerText()).trim();
  await nuevas.first().click();
  await page.waitForTimeout(2500);
  ok(`la primera compra se mandó a la caja ${caja}`);

  // ── Segunda compra: su caja tiene que aparecer ──
  const moverDespues = page.getByRole("button", { name: "Mover" });
  await moverDespues.last().click();
  await page.waitForTimeout(800);

  const suyas = page.locator("p", { hasText: /^A una caja suya$/ }).locator("..").locator("button");
  if (await suyas.count() === 0) {
    fail(`no se ofrece la caja ${caja}, que ya es suya (era el bug)`);
  } else {
    const ofrecidas = [];
    for (let i = 0; i < await suyas.count(); i++) ofrecidas.push((await suyas.nth(i).innerText()).trim());
    if (ofrecidas.includes(caja)) ok(`se ofrece su propia caja ${caja} para juntar ahí`);
    else fail(`en "sus cajas" salen ${ofrecidas.join(", ")} pero no la ${caja}`);

    await suyas.nth(ofrecidas.indexOf(caja)).click();
    await page.waitForTimeout(2500);
  }

  // ── Las dos compras tienen que haber quedado en la misma caja ──
  const estado = await db.query(
    `SELECT ubicacion, caja FROM sales WHERE client_id=$1 ORDER BY created_at`, [clienteId]);
  const enLaCaja = estado.rows.filter((r) => r.ubicacion === "caja" && String(r.caja) === caja).length;
  if (enLaCaja === 2) ok(`las 2 compras quedaron juntas en la caja ${caja}`);
  else fail(`solo ${enLaCaja} de 2 quedaron en la caja ${caja}: ${JSON.stringify(estado.rows)}`);

  const fichaFinal = await db.query("SELECT box_1, box_2 FROM clients WHERE id=$1", [clienteId]);
  if (String(fichaFinal.rows[0].box_1) === caja && fichaFinal.rows[0].box_2 === null)
    ok(`y su ficha quedó con una sola caja, la ${caja}, sin quemar otra`);
  else
    fail(`su ficha quedó box_1="${fichaFinal.rows[0].box_1}" box_2="${fichaFinal.rows[0].box_2}"`);

  // El cuadro crece con cada caja y cada compra guardada; Guardar tiene que seguir a
  // la vista sin hacer zoom, igual que se arregló en el cobro.
  for (const alto of [1100, 700, 560]) {
    await page.setViewportSize({ width: 1400, height: alto });
    await page.waitForTimeout(400);
    const caja = await page.getByRole("button", { name: /^Guardar$/ }).first().boundingBox();
    if (caja && caja.y >= 0 && caja.y + caja.height <= alto)
      ok(`en una pantalla de ${alto}px, Guardar se alcanza sin hacer zoom`);
    else
      fail(`en ${alto}px, Guardar queda fuera: ${JSON.stringify(caja)}`);
  }

  await page.screenshot({ path: "scripts/mover-a-su-caja.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (clienteId) {
      await db.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id=$1)`, [clienteId]);
      await db.query("DELETE FROM sales WHERE client_id=$1", [clienteId]);
      await db.query("DELETE FROM clients WHERE id=$1", [clienteId]);
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
