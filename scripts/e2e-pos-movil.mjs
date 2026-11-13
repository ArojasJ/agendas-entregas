import { chromium, devices } from "playwright";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const browser = await chromium.launch();

const sesion = (page, token) =>
  page.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, token);

// Esta prueba revisa el cobro de siempre, el que lleva el carrito en la misma
// pantalla. Fuera de la bodega el celular usa otra disposición —el carrito se
// esconde tras una barra—, así que se fija el ajuste en "en bodega" para no
// depender del interruptor real, que cambia según dónde ande la administradora.
const enBodega = (page) =>
  page.route("**/api/settings**", (r) => r.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify({ settings: { en_bodega: "true" } }),
  }));

try {
  const token = tokenDePrueba("admin", "Prueba Admin");
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();
  await sesion(page, token);
  await enBodega(page);

  await page.goto(`${BASE}/panel/pos`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const alto = await page.evaluate(() => window.innerHeight);

  // El teclado no debe saltar solo al entrar: tapa media pantalla
  const conFoco = await page.evaluate(() => document.activeElement?.tagName);
  if (conFoco !== "INPUT") ok("al entrar no se abre el teclado solo");
  else fail("el buscador se enfoca solo y abre el teclado en el celular");

  // Lo de hasta abajo tiene que alcanzarse
  const boton = page.getByRole("button", { name: /Siguiente/ });
  if (await boton.count() === 1) ok("el botón Siguiente existe");
  else fail(`botones Siguiente: ${await boton.count()}`);

  await boton.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const caja = await boton.boundingBox();
  if (caja && caja.y >= 0 && caja.y + caja.height <= alto + 1)
    ok(`se puede bajar hasta el botón Siguiente (y=${Math.round(caja.y)} de ${alto}px)`);
  else fail(`no se alcanza el botón Siguiente: ${JSON.stringify(caja)} en ${alto}px`);

  if (await page.locator("text=Total").first().isVisible()) ok("el Total se ve");
  else fail("el Total no se ve");

  const ancho = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  if (ancho[0] <= ancho[1] + 2) ok(`no se sale de la pantalla a lo ancho (${ancho[0]} <= ${ancho[1]})`);
  else fail(`se desborda a lo ancho: ${ancho[0]} > ${ancho[1]}`);

  await page.screenshot({ path: "scripts/pos-movil-abajo.png" });

  // ── Buscar un producto y que el carrito siga alcanzable ──
  await page.locator("input[placeholder*='Buscar por nombre']").fill("lipstick");
  await page.waitForTimeout(800);
  const resultados = page.locator("button", { hasText: /Stock:/ });
  const nRes = await resultados.count();
  if (nRes > 0) ok(`la búsqueda de producto da ${nRes} resultados`);
  else fail("la búsqueda de producto no dio resultados");

  const zona = page.locator("div[class*='60vh']").first();
  const cajaZona = await zona.boundingBox();
  if (cajaZona && cajaZona.height <= alto * 0.62)
    ok(`los resultados no empujan el carrito fuera de alcance (${Math.round(cajaZona.height)}px)`);
  else fail(`la lista de resultados crece de más: ${JSON.stringify(cajaZona)}`);

  const disponible = page.locator("button:not([disabled])", { hasText: /Stock:/ }).first();
  await disponible.click();
  await page.waitForTimeout(600);
  if ((await page.locator("text=Tu carrito está vacío").count()) === 0) ok("el producto entra al carrito");
  else fail("el producto no entró al carrito");

  await page.getByRole("button", { name: /Siguiente/ }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const caja2 = await page.getByRole("button", { name: /Siguiente/ }).boundingBox();
  if (caja2 && caja2.y + caja2.height <= alto + 1)
    ok("con producto en el carrito también se alcanza el botón");
  else fail(`con producto no se alcanza el botón: ${JSON.stringify(caja2)}`);

  // ── Buscar clienta ──
  const campoCliente = page.locator("input[placeholder*='instagram']");
  await campoCliente.scrollIntoViewIfNeeded();
  await campoCliente.click();
  await page.waitForTimeout(600);

  const lista = page.locator("div.absolute.z-50").first();
  if (await lista.isVisible()) ok("se abre el listado de clientas");
  else fail("no se abre el listado de clientas");

  const cajaLista = await lista.boundingBox();
  const cajaCampo = await campoCliente.boundingBox();
  if (cajaLista && cajaCampo && cajaLista.y + cajaLista.height <= cajaCampo.y + 2)
    ok("el listado se abre HACIA ARRIBA, donde no lo tapa el teclado");
  else fail(`el listado se abre abajo del campo: lista=${JSON.stringify(cajaLista)} campo=${JSON.stringify(cajaCampo)}`);

  const cajaHeader = await page.locator("header").boundingBox();
  const cajaNav = await page.locator("nav").last().boundingBox();
  if (cajaLista && cajaLista.y >= cajaHeader.y + cajaHeader.height - 1 && cajaLista.y + cajaLista.height <= cajaNav.y + 1)
    ok("cabe completo: ni detrás del encabezado ni debajo de la barra de abajo");
  else fail(`el listado se sale: lista=${JSON.stringify(cajaLista)}, encabezado hasta ${cajaHeader.y + cajaHeader.height}, barra desde ${cajaNav.y}`);

  const cajaCrear = await lista.locator("button", { hasText: /Crear nuevo/ }).first().boundingBox();
  if (cajaCrear && cajaCrear.y >= cajaHeader.y + cajaHeader.height - 1)
    ok("y 'Crear nuevo cliente' queda a la vista, no tapado por el encabezado");
  else fail(`'Crear nuevo cliente' queda tapado: ${JSON.stringify(cajaCrear)}`);

  const pintadas = await lista.locator("button").count();
  if (pintadas <= 32) ok(`sin escribir solo pinta ${pintadas} renglones, no las mil y pico`);
  else fail(`pinta ${pintadas} renglones de un jalón: el celular se traba`);

  if ((await lista.innerText()).includes("escribe un poco más")) ok("y avisa cuántas coinciden");
  else fail("no avisa que hay más clientas");

  await page.screenshot({ path: "scripts/pos-movil-clientas.png" });

  await campoCliente.fill("gabriela_mg06");
  await page.waitForTimeout(700);
  const opcion = lista.locator("button", { hasText: "@gabriela_mg06" }).first();
  if (await opcion.count() > 0) ok("al escribir el @ aparece la clienta");
  else fail("al escribir el @ no apareció la clienta");

  await opcion.click();
  await page.waitForTimeout(500);
  if ((await page.locator("text=@gabriela_mg06").count()) > 0) ok("se asigna al picarla");
  else fail("no se asignó la clienta");

  // ── Cerrar picando afuera ──
  await page.locator("button", { hasText: /^✕$/ }).first().click();
  await page.waitForTimeout(400);
  await page.locator("input[placeholder*='instagram']").click();
  await page.waitForTimeout(500);
  if (await page.locator("div.absolute.z-50").first().isVisible()) {
    await page.locator("text=Subtotal").first().click({ force: true });
    await page.waitForTimeout(500);
    if ((await page.locator("div.absolute.z-50").count()) === 0)
      ok("se cierra picando fuera, ya no se queda tapando");
    else fail("el listado se queda abierto tapando la pantalla");
  } else fail("no se pudo reabrir el listado");

  // ── Que la vista de computadora no se haya roto ──
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page2 = await ctx2.newPage();
  await enBodega(page2);
  await sesion(page2, token);
  await page2.goto(`${BASE}/panel/pos`, { waitUntil: "networkidle" });
  await page2.waitForTimeout(1200);

  const enfocado = await page2.evaluate(() => document.activeElement?.tagName);
  if (enfocado === "INPUT") ok("en computadora el buscador sigue enfocado para el escáner");
  else fail(`en computadora el foco quedó en ${enfocado}: el escáner dejaría de servir`);

  const sinScroll = await page2.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 2);
  if (sinScroll) ok("en computadora sigue sin barra de desplazamiento general");
  else fail("en computadora apareció desplazamiento general: cambió la vista grande");

  const b2 = await page2.getByRole("button", { name: /Siguiente/ }).boundingBox();
  if (b2 && b2.y + b2.height <= 901) ok("en computadora el botón Siguiente sigue a la vista");
  else fail(`en computadora el botón quedó fuera: ${JSON.stringify(b2)}`);

  await page2.screenshot({ path: "scripts/pos-escritorio.png" });
} catch (e) {
  fail(e.message);
} finally {
  console.log(out.join("\n"));
  await browser.close();
}
