import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { cajasDeTexto } from "../lib/constants.js";

// El formulario tenía dos casillas de un número ("Caja 1" / "Caja 2"). Al anotar dos
// juntas en una, esa caja se volvía invisible para el sistema. Ahora es un solo campo
// donde caben las que sean, separadas por comas.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_UI_CAJAS";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
const creados = [];

try {
  await db.connect();

  const libres = await db.query(`
    with ocupadas as (
      select (regexp_matches(coalesce(box_1,'')||','||coalesce(box_2,''), '\\d+', 'g'))[1]::int n from clients
      union select caja::int from sales where ubicacion='caja' and caja is not null)
    select n from generate_series(1,120) n
    where n not in (select n from ocupadas where n is not null)
    order by n desc limit 3`);
  const [cA, cB, cC] = libres.rows.map((r) => r.n);
  ok(`se usan las cajas libres ${cA}, ${cB} y ${cC}`);

  // Igual que la ficha real que reportó el dueño: una sola y dos juntas tras una coma
  const r = await db.query(
    `INSERT INTO clients (name,instagram,phone,box_1,box_2) VALUES ($1,$2,'8711234567',$3,$4) RETURNING id`,
    [ETIQUETA, "@prueba_ui_cajas", String(cA), `${cB}, ${cC}`]);
  creados.push(r.rows[0].id);

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
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

  const cuerpo = await page.locator("body").innerText();
  const faltan = [cA, cB, cC].filter((n) => !new RegExp(`Caja ${n}\\b`).test(cuerpo));
  if (faltan.length === 0) ok(`la lista le pinta sus 3 cajas: ${cA}, ${cB}, ${cC}`);
  else fail(`en la lista no se ven las cajas ${faltan.join(", ")}`);

  if (!/Caja 1:|Caja 2:/.test(cuerpo)) ok('ya no dice "Caja 1:" ni "Caja 2:"');
  else fail('la lista sigue con las etiquetas viejas "Caja 1/2"');

  // Buscar por la caja que estaba escondida detrás de la coma
  const buscaCaja = page.getByPlaceholder(/caja/i).first();
  if (await buscaCaja.count() > 0) {
    await buscaCaja.fill(String(cC));
    await page.waitForTimeout(900);
    if ((await page.locator("body").innerText()).includes(ETIQUETA))
      ok(`buscando por la caja ${cC} sí la encuentra (antes no, por la coma)`);
    else
      fail(`buscando por la caja ${cC} no la encuentra`);
    await buscaCaja.fill("");
    await page.waitForTimeout(500);
  }

  // Abrir su ficha: un solo campo con las tres
  // La ficha se abre con el lápiz de su renglón, no picando el nombre
  const renglon = page.locator('div').filter({ hasText: ETIQUETA })
    .filter({ has: page.getByRole('button', { name: '✏️' }) }).last();
  await renglon.getByRole('button', { name: '✏️' }).first().click();
  await page.waitForTimeout(1200);

  const campo = page.getByPlaceholder(/Ej\. 5, 19, 42/);
  if (await campo.count() === 0) throw new Error("no apareció el campo único de Cajas");
  ok("el formulario tiene un solo campo de Cajas");

  const valor = await campo.inputValue();
  if (cajasDeTexto(valor).length === 3 && [cA, cB, cC].every((n) => cajasDeTexto(valor).includes(n)))
    ok(`el campo trae las tres juntas: "${valor}"`);
  else
    fail(`el campo trae "${valor}"`);

  // Guardar una cuarta y comprobar que se conserva todo
  await campo.fill(`${cA}, ${cB}, ${cC}`);
  await page.getByRole("button", { name: /^Guardar$/ }).first().click();
  await page.waitForTimeout(2000);

  const ficha = await db.query("SELECT box_1, box_2 FROM clients WHERE id=$1", [creados[0]]);
  const guardadas = cajasDeTexto(ficha.rows[0].box_1, ficha.rows[0].box_2);
  if ([cA, cB, cC].every((n) => guardadas.includes(n)))
    ok(`al guardar conserva las 3: "${ficha.rows[0].box_1}"`);
  else
    fail(`al guardar quedó "${ficha.rows[0].box_1}" / "${ficha.rows[0].box_2}"`);

  if (ficha.rows[0].box_2 === null) ok("y las deja en un solo campo");
  else fail(`quedaron repartidas: box_2="${ficha.rows[0].box_2}"`);

  await page.screenshot({ path: "scripts/cajas-lista.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (creados.length) await db.query("DELETE FROM clients WHERE id = ANY($1::uuid[])", [creados]);
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
