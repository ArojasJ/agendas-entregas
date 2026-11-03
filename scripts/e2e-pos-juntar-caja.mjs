import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// "Juntar todo en la caja N" no se pintaba de verde al picarle, pero "Poner en estante"
// sí. La opción pedía que hubiera algo que mover del estante a la caja; cuando la
// clienta ya tenía caja y nada en estante, esa lista venía vacía y la opción se veía
// apagada aunque de verdad estuviera elegida.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_JUNTAR_CAJA";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();

let productoId, clienteId, caja, cortePrevio;

// Una opción está elegida cuando trae el punto relleno; el color es lo mismo visto
// desde el CSS, pero el glifo se lee igual aunque cambien las clases de Tailwind.
const elegida = async (boton) => (await boton.innerText()).includes("◉");

try {
  await db.connect();

  // Hace falta una caja de verdad libre: si se le asigna una ocupada, el sistema la
  // propondría compartida con otra clienta y la prueba estaría midiendo otra cosa.
  const libre = await db.query(`
    with ocupadas as (
      select distinct nullif(regexp_replace(box_1,'\\D','','g'),'')::int n from clients
      where box_1 ~ '^[0-9]+$'
      union
      select distinct nullif(regexp_replace(box_2,'\\D','','g'),'')::int from clients
      where box_2 ~ '^[0-9]+$'
      union
      select distinct caja::int from sales where ubicacion='caja' and caja is not null
    )
    select n from generate_series(1,120) n
    where n not in (select n from ocupadas where n is not null)
    order by n desc limit 1`);
  if (!libre.rows[0]) throw new Error("no hay ninguna caja libre para la prueba");
  caja = libre.rows[0].n;
  ok(`la caja ${caja} está libre y se usa para la prueba`);

  const corte = await db.query(
    `select coalesce(sum(total),0) t from sales where pos_cut_id is null and status='paid'`);
  cortePrevio = Number(corte.rows[0].t);

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',150,99,60) RETURNING id`,
    [ETIQUETA]);
  productoId = p.rows[0].id;

  // Con box_1 puesta y nada en estante, el sistema propone "juntar" con la lista de
  // cosas por mover vacía: justamente el caso que no se pintaba.
  const cl = await db.query(
    `INSERT INTO clients (name,instagram,phone,box_1) VALUES ($1,$2,'8711234567',$3) RETURNING id`,
    [ETIQUETA, "@prueba_juntar", String(caja)]);
  clienteId = cl.rows[0].id;

  const ctx = await browser.newContext({ viewport: { width: 1250, height: 1050 } });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Prueba Admin"));

  await page.goto(`${BASE}/panel/pos`, { waitUntil: "networkidle", timeout: 90000 });

  // El catálogo son más de 2000 productos y tarda; sin esperarlo la búsqueda sale vacía
  await page.waitForFunction(
    () => !/Cargando catálogo/i.test(document.body.innerText),
    { timeout: 60000 }
  ).catch(() => {});

  const buscador = page.getByPlaceholder(/Buscar|escanea|código/i).first();
  await buscador.fill(ETIQUETA);
  await page.waitForTimeout(1500);
  await page.locator("button:not([disabled])").filter({ hasText: ETIQUETA }).first().click();
  await page.waitForTimeout(700);

  await page.getByPlaceholder(/@instagram/i).fill("prueba_juntar");
  await page.waitForTimeout(1500);
  await page.getByText("@prueba_juntar", { exact: false }).first().click();
  await page.waitForTimeout(900);
  ok("se agrega el producto y se asigna la clienta");

  await page.getByRole("button", { name: /Siguiente/i }).first().click();
  await page.waitForTimeout(2500);

  const juntar = page.getByRole("button", { name: new RegExp(`Juntar todo en la caja ${caja}`) }).first();
  const estante = page.getByRole("button", { name: /Poner en estante/ }).first();

  if (await juntar.count() === 0) throw new Error(`no apareció la opción "Juntar todo en la caja ${caja}"`);

  // 1. Al abrir el cobro ya viene elegida: es la sugerida
  if (await elegida(juntar)) ok("al abrir el cobro, 'Juntar todo en la caja' ya se ve elegida");
  else fail("al abrir el cobro, la opción sugerida se ve apagada (el bug)");

  if (!(await elegida(estante))) ok("y 'Poner en estante' se ve apagada, como debe");
  else fail("'Poner en estante' se ve elegida sin haberla picado");

  // 2. Cambiar al estante
  await estante.click();
  await page.waitForTimeout(400);
  if (await elegida(estante)) ok("al picar 'Poner en estante' se enciende");
  else fail("'Poner en estante' no se encendió");
  if (!(await elegida(juntar))) ok("y 'Juntar todo en la caja' se apaga");
  else fail("quedaron las dos encendidas al mismo tiempo");

  // 3. Volver a juntar: esto es lo que el dueño reportó que no respondía
  await juntar.click();
  await page.waitForTimeout(400);
  if (await elegida(juntar)) ok("al picar 'Juntar todo en la caja' se enciende");
  else fail("picar 'Juntar todo en la caja' no hace nada (el bug reportado)");
  if (!(await elegida(estante))) ok("y 'Poner en estante' se apaga");
  else fail("'Poner en estante' se quedó encendida");

  // 4. Elegir otra caja no debe dejar dos opciones encendidas
  const chips = page.locator("div").filter({ hasText: /^O elige otra caja/ }).locator("button");
  if (await chips.count() > 0) {
    const otra = chips.first();
    const numeroOtra = (await otra.innerText()).trim();
    await otra.click();
    await page.waitForTimeout(400);
    if (!(await elegida(juntar)))
      ok(`al elegir la caja ${numeroOtra} de abajo, la de arriba se apaga`);
    else
      fail(`eligiendo la caja ${numeroOtra} quedó también encendida la caja ${caja}`);

    await juntar.click();
    await page.waitForTimeout(400);
    if (await elegida(juntar)) ok("y se puede regresar a la caja sugerida");
    else fail("ya no se pudo regresar a la caja sugerida");
  }

  await page.screenshot({ path: "scripts/pos-juntar-caja.png" });

  // 5. Lo que se ve encendido es lo que se guarda
  await page.getByRole("button", { name: /Finalizar Cobro|Aprobar Crédito/ }).first().click();
  await page.waitForTimeout(3500);

  const venta = await db.query(
    "SELECT id, ubicacion, caja FROM sales WHERE client_id=$1 ORDER BY created_at DESC LIMIT 1", [clienteId]);
  const v = venta.rows[0];
  if (v && v.ubicacion === "caja" && Number(v.caja) === caja)
    ok(`la venta se guardó en la caja ${caja}, que es la que se veía encendida`);
  else
    fail(`se veía la caja ${caja} y la venta quedó en ubicacion="${v?.ubicacion}" caja="${v?.caja}"`);
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (clienteId) {
      await db.query(`DELETE FROM bitacora_tareas WHERE client_id=$1`, [clienteId]);
      await db.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id=$1)`, [clienteId]);
      await db.query("DELETE FROM sales WHERE client_id=$1", [clienteId]);
      await db.query("DELETE FROM clients WHERE id=$1", [clienteId]);
    }
    if (productoId) {
      await db.query("DELETE FROM sale_items WHERE product_id=$1", [productoId]);
      await db.query("DELETE FROM products WHERE id=$1", [productoId]);
    }
    out.push("  --    datos de prueba eliminados");

    // El corte pendiente no se puede quedar con el dinero de la prueba
    const corte = await db.query(
      `select coalesce(sum(total),0) t from sales where pos_cut_id is null and status='paid'`);
    const ahora = Number(corte.rows[0].t);
    if (cortePrevio !== null && ahora === cortePrevio)
      out.push(`  ok    el corte pendiente quedó igual que antes ($${ahora})`);
    else
      out.push(`  FALLA el corte pendiente pasó de $${cortePrevio} a $${ahora}`);
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
