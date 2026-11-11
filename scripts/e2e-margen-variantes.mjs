import { chromium } from "playwright";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// Al poner precio y costo en una variante no salía el margen: el recuadro de
// "Margen estimado" se escondía en cuanto se prendían las variantes, porque arriba
// ya no hay precio ni costo — viven en cada variante. Ahora el margen se ve en cada
// variante y el resumen de todas junto al botón de agregar.
// Esta prueba no guarda nada: es sólo el formulario, no toca la base.

const BASE = process.env.BASE_URL || "http://localhost:3000";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const browser = await chromium.launch();

try {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Prueba Admin"));
  const page = await ctx.newPage();

  await page.goto(`${BASE}/panel/inventario`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByRole("button", { name: "+ Nuevo" }).first().click();
  await page.getByText("Nuevo Producto").first().waitFor({ state: "visible", timeout: 30000 });
  ok("se abre el formulario de producto nuevo");

  // ── Sin variantes: el margen de siempre tiene que seguir ahí ──
  const modal = page.locator("form").first();
  const precioSimple = modal.locator('input[type="number"][step="0.01"]');
  await precioSimple.nth(0).fill("500");   // costo
  await precioSimple.nth(1).fill("1000");  // precio
  await page.waitForTimeout(400);
  let texto = (await modal.innerText()).replace(/\s+/g, " ");
  if (/Margen estimado 50\.0%/i.test(texto)) ok("sin variantes sigue saliendo el margen (50.0%)");
  else fail("sin variantes ya no sale el margen: " + texto.slice(0, 200));

  // ── Prender variantes ──
  const bloque = page.locator("div")
    .filter({ has: page.getByRole("heading", { name: "Variantes del producto" }) })
    .filter({ has: page.locator("button") })
    .last();
  await bloque.locator("button").first().click();
  await page.waitForTimeout(600);

  const tarjetas = page.locator('[class*="space-y-2.5"]');
  if (await tarjetas.count() === 0) throw new Error("no se creó ninguna variante al prender el interruptor");
  ok("al prender variantes aparece la primera variante");

  const leerTarjeta = async (i) => (await tarjetas.nth(i).innerText()).replace(/\s+/g, " ");

  // ── Una variante con sólo el precio no debe inventar un 100% ──
  const uno = tarjetas.nth(0);
  await uno.locator('input[inputmode="decimal"]').nth(1).fill(""); // costo vacío
  await uno.locator('input[inputmode="decimal"]').nth(0).fill("990");
  await page.waitForTimeout(400);
  if (!/margen/i.test(await leerTarjeta(0))) ok("con el costo aún vacío no enseña un margen falso");
  else fail("enseña margen sin tener el costo: " + (await leerTarjeta(0)));

  // ── Precio y costo: el caso del reporte ──
  await uno.locator('input[inputmode="decimal"]').nth(1).fill("505.87");
  await page.waitForTimeout(400);
  let t1 = await leerTarjeta(0);
  if (/margen/i.test(t1)) ok("al escribir precio y costo la variante ya dice su margen");
  else fail("la variante sigue sin decir el margen: " + t1);
  if (/48\.9%/.test(t1)) ok("y el número es el correcto: 48.9% de $990 con costo $505.87");
  else fail("el margen no cuadra: " + t1);

  // ── Resumen de todas las variantes ──
  const form = page.locator("form").first();
  texto = (await form.innerText()).replace(/\s+/g, " ");
  if (/Margen estimado 48\.9%/i.test(texto)) ok("el resumen de abajo también dice 48.9%");
  else fail("no aparece el resumen con variantes: " + texto.slice(-300));

  // ── Segunda variante con otro margen: el resumen tiene que dar el rango ──
  await page.getByRole("button", { name: "+ Agregar variante" }).click();
  await page.waitForTimeout(500);
  const dos = tarjetas.nth(1);
  await dos.locator('input[inputmode="decimal"]').nth(0).fill("500");
  await dos.locator('input[inputmode="decimal"]').nth(1).fill("400");
  await page.waitForTimeout(500);
  let t2 = await leerTarjeta(1);
  if (/20\.0%/.test(t2)) ok("la segunda variante calcula su propio margen (20.0%)");
  else fail("la segunda variante no calcula lo suyo: " + t2);

  texto = (await form.innerText()).replace(/\s+/g, " ");
  if (/Margen estimado 20\.0% – 48\.9%/i.test(texto))
    ok("y como no ganan lo mismo, el resumen enseña el rango 20.0% – 48.9%");
  else
    fail("el resumen no enseña el rango: " + texto.slice(-300));

  // ── Vender por debajo del costo tiene que avisar ──
  await dos.locator('input[inputmode="decimal"]').nth(0).fill("100");
  await dos.locator('input[inputmode="decimal"]').nth(1).fill("150");
  await page.waitForTimeout(500);
  t2 = await leerTarjeta(1);
  if (/p[ée]rdida/i.test(t2) && /-50\.0%/.test(t2)) ok("si el precio queda abajo del costo avisa Pérdida -50.0%");
  else fail("no avisa la pérdida: " + t2);

  await tarjetas.nth(0).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "scripts/margen-variantes.png" });
} catch (e) {
  fail(e.message);
} finally {
  console.log(out.join("\n"));
  await browser.close();
}
