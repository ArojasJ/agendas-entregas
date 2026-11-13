import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// Vendiendo fuera de la bodega no se tiene el producto enfrente para leerle el código
// y de memoria no siempre se sabe cómo quedó registrado. El precio sí se sabe: es el
// que se publicó en la historia. Por eso, SOLO en modo fuera de bodega, aparece un
// recuadro de precio que acota la búsqueda.
//
// El ajuste de bodega NO se toca: es un interruptor real que cambia cómo se registran
// las ventas mientras el negocio trabaja. En su lugar se finge la respuesta de
// /api/settings en el navegador, que es lo único que la pantalla mira.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_PRECIO";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
const productos = [];

try {
  await db.connect();
  // Tres productos con el mismo nombre y distinto precio: sin el precio no hay forma
  // de distinguirlos, que es justo el problema.
  for (const precio of [160, 260, 360]) {
    const p = await db.query(
      `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',$2,9,40) RETURNING id`,
      [`BLUSA DEPORTIVA ${ETIQUETA}`, precio]);
    productos.push({ id: p.rows[0].id, precio });
  }
  ok("tres productos con el mismo nombre y precios 160, 260 y 360");

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Prueba Admin"));
  const page = await ctx.newPage();

  // Se finge el ajuste, sin tocar el de verdad.
  let dentroDeBodega = true;
  await page.route("**/api/settings**", async (ruta) => {
    await ruta.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ settings: { en_bodega: String(dentroDeBodega) } }),
    });
  });

  const abrir = async () => {
    await page.goto(`${BASE}/panel/pos`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.getByPlaceholder(/nombre, SKU o código/i).first().waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(2000);
  };

  // ── En bodega: el recuadro de precio NO debe aparecer ──
  dentroDeBodega = true;
  await abrir();
  if (await page.getByPlaceholder("Precio").count() === 0) ok("en bodega no aparece el recuadro de precio, para no estorbar");
  else fail("el recuadro de precio aparece estando en bodega");

  // ── Fuera de bodega: sí aparece ──
  dentroDeBodega = false;
  await abrir();
  const campoPrecio = page.getByPlaceholder("Precio");
  if (await campoPrecio.count() === 1) ok("fuera de bodega sí aparece, junto al buscador");
  else fail("no aparece el recuadro de precio fuera de bodega");

  // ── Buscar solo por nombre: salen los tres ──
  await page.getByPlaceholder(/nombre, SKU o código/i).first().fill(ETIQUETA);
  await page.waitForTimeout(1200);
  let filas = await page.getByText(`BLUSA DEPORTIVA ${ETIQUETA}`, { exact: false }).count();
  if (filas >= 3) ok(`buscando solo por nombre salen los ${filas}, sin forma de distinguirlos`);
  else fail(`esperaba al menos 3 y salieron ${filas}`);

  // ── Con el precio: solo uno ──
  await campoPrecio.fill("260");
  await page.waitForTimeout(1200);
  let texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/Mostrando solo lo que cuesta \$260/i.test(texto)) ok("avisa que está filtrando por $260");
  else fail("no avisa del filtro de precio");

  const visibles = await page.locator("button, div").filter({ hasText: new RegExp(`BLUSA DEPORTIVA ${ETIQUETA}`) }).count();
  if (/\$260/.test(texto) && !/\$360/.test(texto) && !/\$160/.test(texto))
    ok("y solo queda el de $260: los de $160 y $360 desaparecen");
  else
    fail("el filtro de precio no acotó: " + texto.slice(0, 400));
  void visibles;

  // ── Solo con precio, sin escribir nombre ──
  await page.getByPlaceholder(/nombre, SKU o código/i).first().fill("");
  await page.waitForTimeout(1200);
  texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/\$260/.test(texto)) ok("y se puede buscar solo por precio, sin escribir el nombre");
  else fail("sin nombre no encuentra nada aunque haya precio");

  // ── Quitar el filtro ──
  await page.getByRole("button", { name: "quitar" }).click();
  await page.waitForTimeout(1000);
  if (await page.getByPlaceholder("Precio").inputValue() === "") ok("el enlace de quitar limpia el precio");
  else fail("no se limpió el precio");

  await page.getByPlaceholder(/nombre, SKU o código/i).first().fill(ETIQUETA);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "scripts/buscar-por-precio.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    for (const p of productos) {
      await db.query("DELETE FROM sale_items WHERE product_id=$1", [p.id]);
      await db.query("DELETE FROM products WHERE id=$1", [p.id]);
    }
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
