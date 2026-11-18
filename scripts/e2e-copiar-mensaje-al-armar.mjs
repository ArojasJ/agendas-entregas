import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";

// Antes había que irse a la pantalla de Entregas para copiar el mensaje de
// confirmación, mandarlo, y regresarse a armar: dos pestañas abiertas y esperar a que
// la lista se actualizara. Ahora el mensaje se copia desde el mismo armado, antes de
// darle a armar.
//
// Lo que de verdad hay que comprobar: que el mensaje diga LO PALOMEADO. En ese momento
// la tarjeta de la entrega todavía trae lo que escribió la clienta, que no es lo que
// se le va a entregar.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_MENSAJE";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let clienteId, productoA, productoB, ventaId, bookingId;

try {
  await db.connect();
  const a = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ('BLUSA DE PRUEBA','PRUEBA',300,5,120) RETURNING id`);
  productoA = a.rows[0].id;
  const b = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ('ARETES DE PRUEBA','PRUEBA',200,5,80) RETURNING id`);
  productoB = b.rows[0].id;

  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,'@prueba_mensaje','8710007777') RETURNING id`, [ETIQUETA]);
  clienteId = c.rows[0].id;

  // Debe $150 de esta compra: el mensaje tiene que decirlo
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,ubicacion,caja,due_date)
     VALUES ($1,500,350,0,'credit','efectivo',now(),'estante',null,current_date + 15) RETURNING id`, [clienteId]);
  ventaId = v.rows[0].id;
  for (const pid of [productoA, productoB]) {
    await db.query(
      `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
       VALUES ($1,$2,1,$3,'pending')`, [ventaId, pid, pid === productoA ? 300 : 200]);
  }

  // La tarjeta trae lo que escribió la clienta, que NO es lo que se le va a entregar
  const bk = await db.query(
    `INSERT INTO bookings (type,date,instagram,"fullName",phone,status,delivery_status,products,amount_due,sale_item_ids)
     VALUES ('domicilio','${isoDePrueba()}','@prueba_mensaje',$1,'8710007777','confirmed','pendiente',
             'lo que escribio la clienta a mano',45,'[]'::jsonb) RETURNING id`, [ETIQUETA]);
  bookingId = bk.rows[0].id;
  ok("entrega a domicilio cuya tarjeta todavía trae lo que escribió la clienta");

  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Gaby");
  }, tokenDePrueba("worker", "Gaby"));
  const page = await ctx.newPage();

  await page.goto(`${BASE}/panel/entregas/preparacion?tipo=domicilio&fecha=${isoDePrueba()}`,
    { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByRole("heading", { name: "Preparación de paquetes" }).waitFor({ state: "visible", timeout: 30000 });
  await page.waitForTimeout(2500);

  await page.getByText(ETIQUETA, { exact: false }).first().click();
  await page.waitForTimeout(2500);
  await page.getByText("productos esperando", { exact: false }).first().click();
  await page.waitForTimeout(2000);

  // Sin palomear nada todavía
  const copiar = page.getByRole("button", { name: /Copiar mensaje/ });
  if (await copiar.count() > 0) ok("el botón de copiar mensaje está junto al de armar, antes de armar");
  else fail("no aparece el botón de copiar mensaje");

  // Palomear SOLO la blusa: lo que se lleva hoy
  await page.getByText("BLUSA DE PRUEBA", { exact: false }).first().click();
  await page.waitForTimeout(2200);

  await copiar.click();
  await page.waitForTimeout(1200);

  const texto = await page.evaluate(() => navigator.clipboard.readText());
  const plano = texto.replace(/\s+/g, " ");

  if (/sólo para confirmar lo que se te entregará/i.test(texto))
    ok("copia el mismo mensaje de confirmación de siempre");
  else
    fail("el mensaje no es el de confirmación: " + plano.slice(0, 180));

  if (/BLUSA DE PRUEBA/i.test(texto)) ok("y dice la blusa, que es lo que se palomeó");
  else fail("no menciona el producto palomeado: " + plano.slice(0, 200));

  if (!/ARETES DE PRUEBA/i.test(texto))
    ok("y NO dice los aretes, que se quedan guardados: el mensaje es de lo que se lleva");
  else
    fail("metió un producto que no se palomeó: " + plano.slice(0, 200));

  if (!/lo que escribio la clienta a mano/i.test(texto))
    ok("ignora lo que traía la tarjeta, que era lo que la clienta tecleó al agendar");
  else
    fail("copió lo de la tarjeta vieja: " + plano.slice(0, 200));

  // $150 que debe de la compra + $45 de envío, que la pantalla precarga de la entrega.
  if (/Aún queda pendiente \$195/.test(texto))
    ok("y dice $195: los $150 que debe de la compra más los $45 del envío");
  else
    fail("el adeudo no es el correcto: " + (plano.match(/Aún queda pendiente \$[\d.]+/) || ["(no lo dice)"])[0]);

  if (/Tu entrega será después de la 1pm/.test(texto))
    ok("con el texto propio de domicilio, no el de bodega");
  else
    fail("no usó el mensaje de domicilio");

  if (await page.getByRole("button", { name: /Copiado/ }).count() > 0)
    ok("el botón confirma que se copió, para no mandarlo dos veces por las dudas");
  else
    fail("no avisa que copió");

  await page.screenshot({ path: "scripts/copiar-mensaje-al-armar.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (bookingId) {
      await db.query(`update sale_items set paquete_booking_id=null where paquete_booking_id=$1`, [bookingId]);
      await db.query("DELETE FROM bookings WHERE id=$1", [bookingId]);
    }
    if (ventaId) {
      await db.query("DELETE FROM sale_items WHERE sale_id=$1", [ventaId]);
      await db.query("DELETE FROM sales WHERE id=$1", [ventaId]);
    }
    if (clienteId) await db.query("DELETE FROM clients WHERE id=$1", [clienteId]);
    for (const pid of [productoA, productoB]) {
      if (pid) {
        await db.query("DELETE FROM sale_items WHERE product_id=$1", [pid]);
        await db.query("DELETE FROM products WHERE id=$1", [pid]);
      }
    }
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
