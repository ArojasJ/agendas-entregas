import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";

// La pantalla de Preparación de paquetes, como la va a usar la empleada: ver cuántos
// faltan, iniciar, que el sistema proponga a la clienta sola, palomear qué se lleva,
// ver qué caja se libera y armar.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_PANTALLA";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let clienteId, productoId, bookingId, cajaA, cajaB;
const ventas = [];

const cajaOcupada = async (n) => (await db.query(`
  select exists (
    select 1 from sales s
    where s.ubicacion='caja' and s.caja::int=$1
      and s.status not in ('cancelled','pending_payment')
      and exists (select 1 from sale_items i where i.sale_id=s.id
                  and i.delivery_status<>'delivered' and i.paquete_booking_id is null)) o`, [n])).rows[0].o;

async function ventaEnCaja(caja, n) {
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja)
     VALUES ($1,$2,$2,0,'paid','efectivo',now(),'caja',$3) RETURNING id`, [clienteId, 100 * n, caja]);
  const ids = [];
  for (let i = 0; i < n; i++) {
    const r = await db.query(
      `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
       VALUES ($1,$2,1,100,'pending') RETURNING id`, [v.rows[0].id, productoId]);
    ids.push(r.rows[0].id);
  }
  ventas.push(v.rows[0].id);
  return ids;
}

try {
  await db.connect();

  const libres = await db.query(`
    with o as (
      select (regexp_matches(coalesce(box_1,'')||','||coalesce(box_2,''),'\\d+','g'))[1]::int n from clients
      union select caja::int from sales where ubicacion='caja' and caja is not null)
    select n from generate_series(1,120) n where n not in (select n from o where n is not null) order by n desc limit 2`);
  cajaA = libres.rows[0].n; cajaB = libres.rows[1].n;

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,99,40) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone,box_1) VALUES ($1,$2,'8711234567',$3) RETURNING id`,
    [ETIQUETA, "@prueba_pantalla", `${cajaA}, ${cajaB}`]);
  clienteId = c.rows[0].id;

  await ventaEnCaja(cajaA, 2);
  await ventaEnCaja(cajaB, 1);

  const b = await db.query(
    `INSERT INTO bookings (type,date,instagram,"fullName",phone,status,delivery_status,products,sale_item_ids)
     VALUES ('domicilio','${isoDePrueba()}','@prueba_pantalla',$1,'8711234567','confirmed','pendiente',
             '1x lo que la clienta escribió','[]'::jsonb) RETURNING id`, [ETIQUETA]);
  bookingId = b.rows[0].id;
  ok(`clienta con la caja ${cajaA} (2 productos) y la ${cajaB} (1), y una entrega sin ligar`);

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("worker", "Gaby"));
  const page = await ctx.newPage();

  // Se abre en la fecha de prueba, no en hoy: así la pantalla solo ve el paquete
  // falso y no se mezcla con la ruta real que alguien pueda estar trabajando.
  await page.goto(`${BASE}/panel/entregas/preparacion?tipo=domicilio&fecha=${isoDePrueba()}`,
    { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByRole("heading", { name: "Preparación de paquetes" }).waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(2500);
  ok("abre el módulo de preparación");

  let texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/Paquetes por preparar/i.test(texto)) ok("dice cuántos paquetes hay por preparar hoy");
  else fail("no dice cuántos faltan: " + texto.slice(0, 250));

  // Entrar al paquete de la clienta de prueba
  await page.getByText(ETIQUETA, { exact: false }).first().click();
  await page.waitForTimeout(2500);
  texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");

  if (/¿De quién es este paquete\?/i.test(texto)) ok("pregunta de quién es el paquete, porque no venía ligado");
  else fail("no pregunta de quién es: " + texto.slice(0, 400));
  if (/3 productos esperando/i.test(texto)) ok("y propone sola a la clienta diciendo que la esperan 3 productos");
  else fail("no propone a la clienta con sus pendientes");
  if (/Lo que escribió la clienta/i.test(texto) && /lo que la clienta escribió/i.test(texto))
    ok("enseña lo que la clienta había anotado al agendar");
  else fail("no enseña lo que escribió la clienta");

  // Ligar
  await page.getByText("3 productos esperando", { exact: false }).first().click();
  await page.waitForTimeout(2000);
  texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/¿Qué se lleva\? \(0 de 3\)/i.test(texto)) ok("al ligarla, lista sus 3 productos para palomear");
  else fail("no lista los productos: " + texto.slice(0, 400));
  if (new RegExp(`Caja ${cajaA}`).test(texto) && new RegExp(`Caja ${cajaB}`).test(texto))
    ok(`y dice en qué caja está cada uno (${cajaA} y ${cajaB}), para ir por ellos`);
  else fail("no dice dónde está cada producto");

  // Palomear los dos de la caja A
  const filas = page.locator(`button:has-text("Caja ${cajaA}")`);
  const cuantas = await filas.count();
  if (cuantas < 2) throw new Error(`esperaba 2 productos en la caja ${cajaA}, hay ${cuantas}`);
  await filas.nth(0).click();
  await page.waitForTimeout(900);
  await filas.nth(1).click();
  await page.waitForTimeout(1800);

  texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (new RegExp(`Se libera la caja ${cajaA}`, "i").test(texto))
    ok(`avisa en pantalla que se va a liberar la caja ${cajaA}`);
  else
    fail("no avisa qué caja se libera: " + texto.slice(-500));
  if (new RegExp(`queda 1 producto en la caja ${cajaB}`, "i").test(texto))
    ok(`y que le queda 1 producto en la caja ${cajaB}, que no se libera`);
  else
    fail("no avisa de lo que queda guardado");

  // Armar
  await page.getByRole("button", { name: /Armar paquete \(2\)/ }).click();
  await page.waitForTimeout(3500);

  if (!(await cajaOcupada(cajaA))) ok(`al armar desde la pantalla, la caja ${cajaA} queda libre`);
  else fail(`la caja ${cajaA} sigue ocupada`);
  if (await cajaOcupada(cajaB)) ok(`y la ${cajaB} sigue ocupada, como debe ser`);
  else fail(`se liberó de más la caja ${cajaB}`);

  const bk = await db.query("select sale_item_ids, preparado_por_name from bookings where id=$1", [bookingId]);
  if ((bk.rows[0].sale_item_ids || []).length === 2 && bk.rows[0].preparado_por_name === "Gaby")
    ok("la entrega queda ligada a los 2 productos y firmada por Gaby");
  else
    fail("no quedó bien guardada: " + JSON.stringify(bk.rows[0]));

  await page.waitForTimeout(1500);
  texto = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  // La etiqueta va en mayúsculas por diseño, así que se compara sin distinguirlas.
  if (/✓ Armado \(2\)/i.test(texto)) ok("y en la lista el paquete ya aparece como armado");
  else fail("la lista no muestra el paquete como armado: " + texto.slice(0, 400));

  await page.screenshot({ path: "scripts/preparacion-paquetes.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (bookingId) await db.query("DELETE FROM bookings WHERE id=$1", [bookingId]);
    if (ventas.length) {
      await db.query("DELETE FROM sale_items WHERE sale_id = ANY($1::uuid[])", [ventas]);
      await db.query("DELETE FROM sales WHERE id = ANY($1::uuid[])", [ventas]);
    }
    if (clienteId) await db.query("DELETE FROM clients WHERE id=$1", [clienteId]);
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
