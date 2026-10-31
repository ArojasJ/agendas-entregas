import { chromium } from "playwright";
import { Client } from "pg";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1250, height: 1000 } });
const page = await ctx.newPage();

const ETIQUETA = "PRUEBA_FICHA";
const IG = "prueba_ficha_ubic";
let clienteId, productoId, ventaId;

try {
  await db.connect();
  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',200,30,80) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const cl = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8711234567') RETURNING id`,
    [ETIQUETA, "@" + IG]);
  clienteId = cl.rows[0].id;

  // Una compra guardada en el estante, para poder moverla
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,ubicacion)
     VALUES ($1,200,200,0,'paid','efectivo','estante') RETURNING id`, [clienteId]);
  ventaId = v.rows[0].id;
  await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,200,'pending')`, [ventaId, productoId]);

  const r = await page.request.post(`${BASE}/api/login-panel`, {
    data: { username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS },
  });
  const { token, role, displayName } = await r.json();
  await page.addInitScript(([t, ro, dn]) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", ro);
    localStorage.setItem("staffName", dn || "");
  }, [token, role, displayName]);

  await page.goto(`${BASE}/panel/clientes`, { waitUntil: "networkidle", timeout: 90000 });
  await page.getByPlaceholder(/Buscar/i).first().fill(IG);
  await page.waitForTimeout(1500);

  // Abrir la ficha (el lapicito)
  await page.getByText("@" + IG, { exact: false }).first().click();
  await page.waitForTimeout(600);
  const lapiz = page.getByRole("button", { name: /editar|✏/i }).first();
  if (await lapiz.count() > 0) await lapiz.click();
  await page.waitForTimeout(2000);

  const t = await page.locator("body").innerText();
  if (t.toUpperCase().includes("GUARDADO")) ok("la ficha muestra la sección Guardado");
  else fail("no aparece la sección Guardado");

  if (t.toUpperCase().includes("ESTANTE")) ok("muestra que está en estante");
  else fail("no muestra el estante");

  if (t.includes(ETIQUETA)) ok("muestra qué producto hay guardado");
  else fail("no muestra el producto");

  await page.screenshot({ path: "scripts/ficha.png" });

  // Mover a una caja
  const btnMover = page.getByRole("button", { name: "Mover" }).first();
  if (await btnMover.count() === 0) { fail("no hay botón Mover"); throw new Error("sin botón Mover"); }
  await btnMover.click();
  await page.waitForTimeout(800);

  const texto2 = await page.locator("body").innerText();
  if (texto2.toUpperCase().includes("A OTRA CAJA")) ok("ofrece cajas libres para mover");
  else fail("no ofrece cajas");

  // Elegir la primera caja libre
  const libres = await (await page.request.get(
    `${BASE}/api/panel/ubicacion?clientId=${clienteId}&productos=1`,
    { headers: { "x-panel-token": token } })).json();
  const destino = libres.libres[0];
  await page.getByRole("button", { name: String(destino), exact: true }).first().click();
  await page.waitForTimeout(2500);

  const vFinal = await db.query("SELECT ubicacion, caja FROM sales WHERE id=$1", [ventaId]);
  if (vFinal.rows[0].ubicacion === "caja" && Number(vFinal.rows[0].caja) === destino)
    ok(`movió del estante a la caja ${destino}`);
  else fail(`quedó en "${vFinal.rows[0].ubicacion}" caja ${vFinal.rows[0].caja}`);

  const ficha = await db.query("SELECT box_1 FROM clients WHERE id=$1", [clienteId]);
  if (Number(ficha.rows[0].box_1) === destino) ok("la ficha de la clienta refleja la caja nueva");
  else fail(`box_1 quedó en "${ficha.rows[0].box_1}"`);
} catch (e) {
  fail(e.message);
  await page.screenshot({ path: "scripts/ficha-fallo.png" }).catch(() => {});
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
