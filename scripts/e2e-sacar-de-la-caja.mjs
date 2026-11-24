import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// El caso de @areeluu: compró dos casas de gengibre a crédito, las dos quedaron en la
// caja 71, y al final solo quiso una.
//
// Quitar la otra con el bote de basura hacía tres cosas bien —la sacaba de la venta,
// la devolvía a existencias y rehacía la deuda— y una mal: no decía nada de la caja.
// La mercancía se quedaba dentro, apartada a nombre de una clienta que ya no la había
// comprado, y como ya volvía a existencias se le podía vender a otra persona.
//
// El sistema no puede ir por ella. Lo único honesto es decir dónde está y no soltar el
// aviso hasta que alguien conteste que ya fue.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_SACAR_CAJA";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let clienteId, ventaId, caja;
const productos = {};
const items = {};

try {
  await db.connect();

  const libre = await db.query(`
    with o as (
      select (regexp_matches(coalesce(box_1,'')||','||coalesce(box_2,''),'\\d+','g'))[1]::int n from clients
      union select caja::int from sales where ubicacion='caja' and caja is not null)
    select n from generate_series(1,120) n where n not in (select n from o where n is not null) order by n desc limit 1`);
  caja = libre.rows[0].n;

  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,'@prueba_sacar_caja','8710007777') RETURNING id`, [ETIQUETA]);
  clienteId = c.rows[0].id;

  // Dos productos, los dos agotados: al quitar uno tiene que volver a existencias
  for (const n of ["QUE SE QUEDA", "QUE SE VA"]) {
    const p = await db.query(
      `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',240,0,100) RETURNING id`,
      [ETIQUETA + " " + n]);
    productos[n] = p.rows[0].id;
  }

  // Venta a crédito de $480 con $100 abonados, igual que la suya
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja)
     VALUES ($1,480,0,0,'credit','efectivo',now(),'caja',$2) RETURNING id`, [clienteId, caja]);
  ventaId = v.rows[0].id;
  for (const n of ["QUE SE QUEDA", "QUE SE VA"]) {
    const i = await db.query(
      `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
       VALUES ($1,$2,1,240,'pending') RETURNING id`, [ventaId, productos[n]]);
    items[n] = i.rows[0].id;
  }
  await db.query(`INSERT INTO payments (sale_id,amount) VALUES ($1,100)`, [ventaId]);

  // El disparador le baja el lugar de la compra a cada producto
  const heredado = await db.query(
    `select ubicacion, caja from sale_items where id = $1`, [items["QUE SE VA"]]);
  if (heredado.rows[0].ubicacion === "caja" && Number(heredado.rows[0].caja) === caja)
    ok(`venta a crédito de $480 con $100 abonados, los 2 productos en la caja ${caja}`);
  else
    fail("el producto no heredó el lugar de la compra: " + JSON.stringify(heredado.rows[0]));

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
    await page.waitForTimeout(2000);
  };
  const cuerpo = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");

  await abrir();
  if (/Caja 71|Caja \d+/.test(await cuerpo())) ok("la venta enseña su caja");

  // ── Quitar el que no quiere ──
  await page.getByRole("button", { name: /Editar venta/i }).click();
  await page.waitForTimeout(2500);

  const renglon = page.locator("div").filter({ hasText: new RegExp("^" + ETIQUETA + " QUE SE VA$") }).first();
  await renglon.waitFor({ state: "visible", timeout: 20000 });
  // El bote vive en el mismo renglón del producto
  await page.locator(`div:has(> div > div > p:text-is("${ETIQUETA} QUE SE VA"))`).first()
    .getByTitle("Quitar de la venta").click();
  await page.waitForTimeout(1500);

  let t = await cuerpo();

  // ── Lo que antes no decía ──
  if (/Hay que sacarlo de la bodega a mano/i.test(t))
    ok("antes de guardar ya avisa que hay que sacarlo a mano");
  else
    fail("no avisa nada al quitarlo");

  if (new RegExp(`Caja ${caja} ${ETIQUETA} QUE SE VA`, "i").test(t))
    ok(`y dice exactamente cuál y de dónde: caja ${caja}`);
  else
    fail("no dice cuál producto ni de qué caja: " + (t.match(/Caja \d+ [^·]{0,50}/i) || ["(nada)"])[0]);

  if (!new RegExp(`Caja ${caja} ${ETIQUETA} QUE SE QUEDA`, "i").test(t))
    ok("y no manda sacar el que sí se queda");
  else
    fail("mandó sacar el producto que se queda en la venta");

  if (/Total nuevo \$240/.test(t)) ok("el total baja a $240");
  else fail("el total no se rehizo: " + (t.match(/Total nuevo [^Y]{0,12}/) || ["?"])[0]);

  // En una venta a crédito, deber es lo normal: no debe venir marcado "me pagó todo"
  if (/Sigue debiendo/i.test(t)) ok("y pregunta por los $140 que faltan, sin darlos por cobrados");
  else fail("no preguntó qué pasa con lo que falta");

  await page.screenshot({ path: "scripts/sacar-de-la-caja-aviso.png" });

  await page.getByRole("button", { name: /Guardar/i }).first().click();
  await page.waitForTimeout(4000);

  // ── El aviso se queda en la pantalla, no en un mensajito de 4 segundos ──
  t = await cuerpo();
  if (/Falta sacarlo de la bodega/i.test(t)) ok("al guardar, el aviso se queda en la venta");
  else fail("el aviso desapareció al guardar");

  await page.waitForTimeout(5000); // más de lo que dura un toast
  await abrir();
  t = await cuerpo();
  if (/Falta sacarlo de la bodega/i.test(t))
    ok("y sigue ahí después de recargar: no se pierde al cambiar de pantalla");
  else
    fail("se perdió al recargar");

  if (new RegExp(`Caja ${caja} ${ETIQUETA} QUE SE VA`, "i").test(t))
    ok("recordando cuál y de qué caja");
  else
    fail("el aviso ya no dice qué sacar");

  // ── Lo demás que ya hacía bien, que no se rompa ──
  const vuelta = await db.query(`select stock from products where id = $1`, [productos["QUE SE VA"]]);
  if (Number(vuelta.rows[0].stock) === 1) ok("el producto volvió a existencias: de 0 a 1");
  else fail("no volvió a existencias: " + vuelta.rows[0].stock);

  const queda = await db.query(`select id from sale_items where sale_id = $1`, [ventaId]);
  if (queda.rows.length === 1 && queda.rows[0].id === items["QUE SE QUEDA"])
    ok("en la venta queda solo el producto que sí quiso");
  else
    fail("la venta quedó con " + queda.rows.length + " productos");

  const vd = await db.query(
    `select total, down_payment, status,
            (select coalesce(sum(amount),0) from payments where sale_id=$1) abonado
     from sales where id = $1`, [ventaId]);
  const s = vd.rows[0];
  if (Number(s.total) === 240 && Number(s.down_payment) === 0 && Number(s.abonado) === 100 && s.status === "credit")
    ok("y sigue debiendo $140: no se le dio por pagada ni se inventó dinero en el cajón");
  else
    fail("el dinero quedó mal: " + JSON.stringify(s));

  // ── "Ya lo saqué" cierra el pendiente, y se queda cerrado ──
  await page.getByRole("button", { name: /^Ya lo saqué$/ }).click();
  await page.waitForTimeout(1500);
  if (!/Falta sacarlo de la bodega/i.test(await cuerpo())) ok("'Ya lo saqué' quita el aviso");
  else fail("el aviso no se fue");

  await abrir();
  if (!/Falta sacarlo de la bodega/i.test(await cuerpo()))
    ok("y no vuelve a salir al recargar: el pendiente quedó cerrado");
  else
    fail("el aviso volvió después de darlo por hecho");

  // ── Y lo entregado sigue sin poderse quitar ──
  await db.query(`update sale_items set delivery_status='delivered' where id=$1`, [items["QUE SE QUEDA"]]);
  await abrir();
  await page.getByRole("button", { name: /Editar venta/i }).click();
  await page.waitForTimeout(2500);
  t = await cuerpo();
  if (/no se puede quitar/i.test(t)) ok("un producto ya entregado sigue sin poderse quitar: eso sería devolución");
  else fail("dejó quitar algo ya entregado");
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (ventaId) {
      await db.query("DELETE FROM payments WHERE sale_id = $1", [ventaId]);
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
