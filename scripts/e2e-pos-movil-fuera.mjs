import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// Fuera de la bodega se vende desde el celular. Ahí la pantalla de Nueva Venta
// repartía mal el espacio: la lista de productos quedaba en un carril de 60vh
// mientras el carrito VACÍO se comía media pantalla, y había que bajar para cobrar.
//
// Ahora, solo fuera de bodega y solo en celular: la lista usa toda la altura, el
// carrito se esconde y queda una barra fija con lo que llevas, el total y Cobrar.
//
// El ajuste de bodega no se toca: se finge la respuesta en el navegador.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_MOVIL";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
const productos = [];

try {
  await db.connect();
  for (let i = 1; i <= 12; i++) {
    const p = await db.query(
      `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',160,9,40) RETURNING id`,
      [`BLUSA ${ETIQUETA} ${i}`]);
    productos.push(p.rows[0].id);
  }
  ok("doce productos que coinciden con la búsqueda");

  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Prueba Admin"));
  const page = await ctx.newPage();

  let dentroDeBodega = true;
  await page.route("**/api/settings**", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ settings: { en_bodega: String(dentroDeBodega) } }),
  }));

  const abrir = async () => {
    await page.goto(`${BASE}/panel/pos`, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.getByPlaceholder(/nombre, SKU o código/i).first().waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(2000);
  };
  const buscar = async () => {
    await page.getByPlaceholder(/nombre, SKU o código/i).first().fill(`BLUSA ${ETIQUETA}`);
    await page.waitForTimeout(1500);
  };
  // Lo que de verdad importa en un celular: cuántos productos alcanzas a ver sin
  // bajar la pantalla. Medir la altura de un contenedor diría menos que esto.
  const visiblesSinBajar = async () => {
    const filas = page.getByText(`BLUSA ${ETIQUETA}`, { exact: false });
    let n = 0;
    for (let i = 0; i < await filas.count(); i++) {
      const c = await filas.nth(i).boundingBox();
      if (c && c.y >= 0 && c.y + c.height <= 844) n++;
    }
    return n;
  };

  // ── En bodega: todo como antes ──
  dentroDeBodega = true;
  await abrir();
  await buscar();
  const veAntes = await visiblesSinBajar();
  if (await page.getByRole("button", { name: /Cobrar →/ }).count() === 0)
    ok("en bodega no sale la barra del celular, nada cambia");
  else fail("la barra aparece estando en bodega");
  // Estando en bodega, bajando se topa uno con el carrito antes del último producto.
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(600);
  const topaConCarrito = /Tu carrito está vacío/i.test(
    (await page.locator("body").innerText()).replace(/\s+/g, " "));
  if (topaConCarrito) ok("en bodega, al bajar se topa uno con el carrito vacío");
  else out.push("  --    (en bodega no se alcanzó el carrito al bajar)");

  // ── Fuera de bodega ──
  dentroDeBodega = false;
  await abrir();
  await buscar();
  const veDespues = await visiblesSinBajar();
  if (veDespues >= veAntes) ok(`se ven ${veDespues} productos de entrada, igual que antes`);
  else fail(`se perdió espacio: ${veAntes} productos antes, ${veDespues} ahora`);

  // Lo que cambia es lo de abajo: la lista sigue y ya no interrumpe el carrito.
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(800);
  const alFinal = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (new RegExp(`BLUSA ${ETIQUETA} 12`).test(alFinal))
    ok("y bajando se llega hasta el último producto, sin que el carrito interrumpa");
  else
    fail("no se alcanza el último producto: " + alFinal.slice(0, 300));

  let texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (!/Tu carrito está vacío/i.test(texto)) ok("el carrito vacío ya no ocupa media pantalla");
  else fail("sigue el carrito vacío estorbando");
  if (/Busca un producto para empezar/i.test(texto)) ok("y en su lugar queda una barra que dice qué hacer");
  else fail("no aparece la barra");

  // ── Agregar al carrito ──
  await page.getByText(`BLUSA ${ETIQUETA} 1`, { exact: false }).first().click();
  await page.waitForTimeout(1200);

  const barra = page.getByRole("button", { name: /Cobrar →/ });
  if (await barra.count() === 1) ok("al agregar algo, la barra ofrece Cobrar sin bajar la pantalla");
  else fail("no aparece el botón de cobrar en la barra");

  const caja = await barra.boundingBox();
  if (caja && caja.y + caja.height <= 844) ok(`el botón de cobrar se alcanza sin bajar (y=${Math.round(caja.y)})`);
  else fail(`el botón queda fuera de la vista: ${JSON.stringify(caja)}`);

  texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  // La etiqueta va en mayúsculas por diseño, así que se compara sin distinguirlas.
  if (/1 producto/i.test(texto) && /\$160\.00/.test(texto)) ok("y la barra dice cuántos llevas y el total");
  else fail("la barra no muestra el resumen: " + texto.slice(-250));

  await page.screenshot({ path: "scripts/movil-fuera-barra.png" });

  // ── Abrir el carrito desde la barra ──
  await page.getByText("toca para ver o editar").click();
  await page.waitForTimeout(1200);
  texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/ASIGNAR CLIENTE/i.test(texto) && /Cerrar/i.test(texto))
    ok("al tocar la barra sube el carrito completo, con la clienta y el descuento");
  else
    fail("no se abrió el carrito: " + texto.slice(-300));

  await page.screenshot({ path: "scripts/movil-fuera-carrito.png" });

  await page.getByRole("button", { name: /Cerrar/ }).first().click();
  await page.waitForTimeout(1000);
  if (await page.getByRole("button", { name: /Cobrar →/ }).count() === 1)
    ok("y al cerrarlo vuelve la barra, sin perder lo que llevas");
  else
    fail("no volvió la barra al cerrar");
} catch (e) {
  fail(e.message);
} finally {
  try {
    for (const id of productos) {
      await db.query("DELETE FROM sale_items WHERE product_id=$1", [id]);
      await db.query("DELETE FROM products WHERE id=$1", [id]);
    }
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
