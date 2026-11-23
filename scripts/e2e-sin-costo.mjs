import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// El recuadro del valor del inventario avisaba "5 sin costo capturado" y ahí se moría:
// no decía cuáles, y con 2,200 productos en el catálogo no hay forma de encontrarlos a
// mano. Un producto sin costo cuenta como ganancia completa, así que ese aviso estaba
// señalando dinero mal contado sin dejar llegar a él.
//
// Ahora el aviso es un botón: deja la lista solo con los que les falta el costo, y
// cuando el costo vive en una variante dice en cuál.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_SIN_COSTO";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
const creados = [];

async function producto(nombre, stock, cost) {
  const r = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',500,$2,$3) RETURNING id`,
    [ETIQUETA + " " + nombre, stock, cost]);
  creados.push(r.rows[0].id);
  return r.rows[0].id;
}

try {
  await db.connect();

  const sinCosto = await producto("SIN COSTO", 3, 0);
  const conCosto = await producto("CON COSTO", 3, 120);

  // Y uno con variantes: el costo vive en ellas, no en la fila padre
  const padre = await producto("CON VARIANTES", 0, 0);
  await db.query(
    `INSERT INTO product_variants (product_id,name,stock,price,cost,option_type)
     VALUES ($1,'ROJO',2,500,0,'Color'), ($1,'AZUL',2,500,80,'Color')`, [padre]);
  ok("3 productos de prueba: uno sin costo, uno con costo, y uno con 2 variantes (una sin costo)");

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Antonio");
  }, tokenDePrueba("admin", "Antonio"));
  const page = await ctx.newPage();

  await page.goto(`${BASE}/panel/inventario`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByText("Valor del inventario", { exact: false }).first()
    .waitFor({ state: "visible", timeout: 60000 });
  await page.waitForTimeout(4000);

  // ── 1. El aviso ahora invita a verlos ──
  const aviso = page.getByRole("button", { name: /sin costo capturado/i }).first();
  if (await aviso.count() === 0) throw new Error("no salió el aviso de piezas sin costo");
  const textoAviso = (await aviso.innerText()).replace(/\s+/g, " ");
  if (/ver cu[aá]les/i.test(textoAviso)) ok(`el aviso dice cómo verlos: "${textoAviso}"`);
  else fail("el aviso sigue sin ofrecer nada: " + textoAviso);

  // ── 2. Al tocarlo, la lista queda solo con los que les falta ──
  await aviso.click();
  await page.waitForTimeout(2000);

  const cuerpo = () => page.locator("body").innerText().then((t) => t.replace(/\s+/g, " "));
  let t = await cuerpo();

  if (/Solo los que les falta el costo/i.test(t)) ok("avisa que la lista está filtrada");
  else fail("no avisa que la lista está filtrada");

  if (t.includes(ETIQUETA + " SIN COSTO")) ok("el que no tiene costo sí aparece");
  else fail("no aparece el que no tiene costo");

  if (!t.includes(ETIQUETA + " CON COSTO")) ok("y el que sí lo tiene queda fuera");
  else fail("se coló uno que sí tiene costo");

  if (t.includes(ETIQUETA + " CON VARIANTES")) ok("el de variantes aparece: una de sus variantes no tiene costo");
  else fail("se perdió el de variantes, donde el costo vive en la variante");

  // ── 3. Y dice EN CUÁL variante falta, que es la pregunta que de verdad se hace ──
  if (/Falta el costo de: ROJO/i.test(t)) ok("dice en cuál variante falta: ROJO");
  else fail("no dice en qué variante falta: " + (t.match(/Falta el costo de:[^·]{0,40}/i) || ["(nada)"])[0]);

  if (!/Falta el costo de: (ROJO, AZUL|AZUL)/i.test(t)) ok("y no acusa a AZUL, que sí tiene su costo");
  else fail("señala una variante que sí tiene costo");

  // ── 4. El renglón se delata solo, aunque después se quite el filtro ──
  if (/Sin costo · 3 pz/i.test(t)) ok("cada renglón trae cuántas piezas van sin costo");
  else fail("el renglón no dice cuántas piezas: " + (t.match(/Sin costo[^A-Z]{0,20}/i) || ["(nada)"])[0]);

  await page.screenshot({ path: "scripts/sin-costo-filtrado.png" });

  // ── 5. Se puede volver a ver todo ──
  await page.getByRole("button", { name: /^Ver todos$/ }).click();
  await page.waitForTimeout(2000);
  t = await cuerpo();
  if (t.includes(ETIQUETA + " CON COSTO")) ok("'Ver todos' devuelve el catálogo completo");
  else fail("no se pudo quitar el filtro");

  if (/Sin costo · 3 pz/i.test(t)) ok("y el aviso del renglón sigue ahí sin el filtro: se ve al pasar");
  else fail("fuera del filtro ya no se nota cuál le falta");

  // ── 6. Una empleada no ve nada de esto: son costos ──
  const ctxW = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctxW.addInitScript((t2) => {
    localStorage.setItem("panelToken", t2);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "worker");
    localStorage.setItem("staffName", "Gaby");
  }, tokenDePrueba("worker", "Gaby"));
  const pw = await ctxW.newPage();
  await pw.goto(`${BASE}/panel/inventario`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pw.waitForTimeout(5000);
  const tw = (await pw.locator("body").innerText()).replace(/\s+/g, " ");
  if (!/sin costo capturado/i.test(tw) && !/Sin costo ·/i.test(tw))
    ok("la empleada no ve el aviso ni las marcas: los costos son solo de admin");
  else
    fail("se le enseñó a la empleada algo de costos");
  await ctxW.close();
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (creados.length) {
      await db.query("DELETE FROM product_variants WHERE product_id = ANY($1::uuid[])", [creados]);
      await db.query("DELETE FROM products WHERE id = ANY($1::uuid[])", [creados]);
    }
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
