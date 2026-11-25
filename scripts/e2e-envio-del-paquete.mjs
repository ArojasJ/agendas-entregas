import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";
import { ENVIO_NORMAL, ENVIO_DOBLE } from "../lib/penalizacionEnvio.js";

// El caso de Monica Luna: su paquete decía "Nada, todo liquidado" y abajo, en el
// total, $900.00. Los $900 estaban en la casilla del ENVIO.
//
// El envio no se guardaba en ningun lado. La pantalla lo adivinaba restando:
//
//     envio = lo anotado a cobrar - lo que debe hoy
//
// Esa resta falla de dos maneras, y las dos estaban vivas en produccion:
//
//   1. Paquete sin armar: lo anotado es el precio de la MERCANCIA que escribio la
//      clienta. A Monica le aparecieron sus $900 de ropa como envio.
//   2. Paquete ya armado: la deuda se mueve despues, cuando la clienta abona. A
//      Katia se le armo debiendo $1,100 + $45; pago; la resta devolvia $1,145.
//
// Ahora el envio se guarda aparte y aqui solo se lee. La deuda se le sigue
// preguntando a la venta, nunca se guarda.
//
// La entrega de prueba va a 400 dias (fechaDePrueba): una entrega falsa con la fecha
// de hoy le mueve la ruta a quien este repartiendo. Los productos llevan stock 2:
// con mas, el Valor del Inventario se infla mientras la prueba corre.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_ENVIO_PAQ";
const IG = "prueba_envio_paq";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let clienteId, ventaId, bookingId, bookingFallido;
const productos = [];

try {
  await db.connect();

  const cl = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8710007777') RETURNING id`,
    [ETIQUETA, "@" + IG]);
  clienteId = cl.rows[0].id;

  // Dos productos de $450, stock 2. La venta: $900, enganche $900 => YA LIQUIDADA,
  // que es exactamente el estado del paquete de Monica.
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,ubicacion,caja,created_at)
     VALUES ($1,900,900,0,'paid','efectivo','caja',99,now()) RETURNING id`, [clienteId]);
  ventaId = v.rows[0].id;

  for (const n of ["UNO", "DOS"]) {
    const p = await db.query(
      `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',450,2,200) RETURNING id`,
      [ETIQUETA + " " + n]);
    productos.push(p.rows[0].id);
    await db.query(
      `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status,ubicacion,caja)
       VALUES ($1,$2,1,450,'pending','caja',99)`, [ventaId, p.rows[0].id]);
  }
  ok("clienta con una venta de $900 YA LIQUIDADA y 2 productos en la caja 99");

  // La entrega, a 400 dias. amount_due = 900: lo que ella anoto por su MERCANCIA,
  // que es el numero que la pantalla tomaba por envio.
  const fecha = isoDePrueba();
  const bk = await db.query(
    // delivery_status va explicito a proposito. El default de la columna esta mal
    // escrito en la base ('''pendiente''', con comillas dentro), y una entrega que
    // nazca con ese valor no sale en Preparacion. Ver
    // migrations/2026-11-25-pendiente-sin-comillas.sql.
    `INSERT INTO bookings (type,date,instagram,"fullName",phone,address,city,amount_due,products,delivery_status,"createdAt")
     VALUES ('domicilio',$1,$2,$3,'8710007777','Calle de prueba 1','Torreon',900,$4,'pendiente',now()) RETURNING id`,
    [fecha, "@" + IG, ETIQUETA, `1x ${ETIQUETA} UNO\n1x ${ETIQUETA} DOS`]);
  bookingId = bk.rows[0].id;
  ok(`entrega a domicilio creada para ${fecha} (a 400 dias, no estorba la ruta de hoy)`);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Antonio");
  }, tokenDePrueba("admin", "Antonio"));
  const page = await ctx.newPage();

  // ── Lo que responde el servidor para esta entrega ──
  const detalle = async () => {
    const r = await page.evaluate(async ([base, id, tok]) => {
      const res = await fetch(`${base}/api/panel/paquetes?bookingId=${id}`, { headers: { "x-panel-token": tok } });
      return res.json();
    }, [BASE, bookingId, tokenDePrueba("admin", "Antonio")]);
    return r;
  };

  await page.goto(`${BASE}/panel/entregas/preparacion`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(2500);

  // ── 1. Sin armar: el envio NO es lo que ella anoto ──
  let d = await detalle();
  if (Number(d.envioGuardado) !== 900)
    ok(`sin armar, el envio ya no copia los $900 de su mercancia (dice ${d.envioGuardado})`);
  else
    fail("el envio sigue copiando lo anotado a cobrar: $900");

  if (Number(d.envioGuardado) === ENVIO_NORMAL && d.envioSugerido)
    ok(`propone el envio que toca por regla: $${ENVIO_NORMAL}`);
  else
    fail(`no propuso el envio normal: ${JSON.stringify({ envio: d.envioGuardado, sugerido: d.envioSugerido })}`);

  // ── 2. Armar el paquete y ver que el envio quede GUARDADO ──
  const armar = async (envio) => page.evaluate(async ([base, tok, body]) => {
    const res = await fetch(`${base}/api/panel/paquetes`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-panel-token": tok },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  }, [BASE, tokenDePrueba("admin", "Antonio"), {
    accion: "armar", bookingId, clientId: clienteId,
    itemIds: (await db.query(`select id from sale_items where sale_id = $1`, [ventaId])).rows.map((r) => r.id),
    envio,
  }]);

  const r1 = await armar(ENVIO_NORMAL);
  if (r1.status !== 200) fail("no se pudo armar el paquete: " + JSON.stringify(r1.body));

  let fila = (await db.query(`select amount_due::numeric as anotado, envio::numeric as envio from bookings where id = $1`, [bookingId])).rows[0];
  if (Number(fila.envio) === ENVIO_NORMAL)
    ok(`al armar, el envio queda guardado en su propia casilla: $${fila.envio}`);
  else
    fail("el envio no se guardo: " + JSON.stringify(fila));

  if (Number(fila.anotado) === ENVIO_NORMAL)
    ok(`y a cobrar quedan solo los $${ENVIO_NORMAL} del envio: la mercancia ya estaba pagada`);
  else
    fail("lo anotado a cobrar no cuadra: " + JSON.stringify(fila));

  // ── 3. Reabrirlo: el envio se LEE, no se recalcula ──
  d = await detalle();
  if (Number(d.envioGuardado) === ENVIO_NORMAL && !d.envioSugerido)
    ok("al reabrirlo lee el envio guardado, ya no lo adivina restando");
  else
    fail("al reabrirlo el envio salio mal: " + JSON.stringify({ e: d.envioGuardado, s: d.envioSugerido }));

  // ── 4. El caso Katia: la clienta ABONA despues de armado ──
  // Se le baja el enganche y se le pone deuda, como si al armar hubiera debido.
  await db.query(`update sales set down_payment = 0, status = 'credit' where id = $1`, [ventaId]);
  await armar(ENVIO_NORMAL);
  fila = (await db.query(`select amount_due::numeric as anotado, envio::numeric as envio from bookings where id = $1`, [bookingId])).rows[0];
  if (Number(fila.anotado) === 900 + ENVIO_NORMAL)
    ok(`debiendo $900, a cobrar son $${fila.anotado}: la deuda mas el envio`);
  else
    fail("con deuda no cuadra: " + JSON.stringify(fila));

  // Ahora paga. Antes, esto hacia que el envio "creciera" hasta $945.
  await db.query(`update sales set down_payment = 900, status = 'paid' where id = $1`, [ventaId]);
  d = await detalle();
  if (Number(d.envioGuardado) === ENVIO_NORMAL)
    ok(`paga despues de armado y el envio sigue siendo $${ENVIO_NORMAL}, no $${900 + ENVIO_NORMAL}`);
  else
    fail(`el envio se contagio de la deuda vieja: $${d.envioGuardado}`);

  // ── 5. La pantalla: "todo liquidado" y el total ya no se contradicen ──
  // La pantalla abre en el dia de hoy; la entrega de prueba vive a 400 dias, asi que
  // se le pasa la fecha por la URL igual que hace el boton del calendario.
  await page.goto(`${BASE}/panel/entregas/preparacion?fecha=${fecha}&tipo=domicilio`,
    { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(3000);

  const tarjeta = page.getByText(ETIQUETA, { exact: false }).first();
  if (await tarjeta.count() === 0) fail("la entrega de prueba no salio en la pantalla de preparacion");
  await tarjeta.click();
  await page.waitForTimeout(3500);

  const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await page.screenshot({ path: "scripts/envio-del-paquete.png", fullPage: true });

  if (/Nada, todo liquidado/i.test(t))
    ok("la pantalla dice 'Nada, todo liquidado': la deuda se le pregunto a la venta");
  else
    fail("no mostro el recuadro de cobro: " + t.slice(-250));

  // El total del recuadro, que es donde salian los $900 de Monica.
  const cobro = t.split(/A cobrar en la entrega/i)[1] || "";
  if (/Total \$45\.00/i.test(cobro))
    ok("y el total a cobrar son $45.00: solo el envio");
  else
    fail("el total no son los $45 del envio: " + cobro.slice(0, 160));

  if (!/\$900\.00/.test(cobro))
    ok("los $900 de su mercancia ya no aparecen en el cobro");
  else
    fail("los $900 siguen metidos en el cobro: " + cobro.slice(0, 160));

  // La casilla del envio, por su etiqueta y no por posicion.
  const casilla = page.locator('input[inputmode="decimal"]').first();
  const vEnvio = await casilla.inputValue();
  if (Number(vEnvio) === ENVIO_NORMAL)
    ok(`la casilla del envio trae $${vEnvio}, no los $900 de antes`);
  else
    fail(`la casilla del envio trae ${vEnvio}`);

  // ── 6. Un viaje perdido sube el envio propuesto a $90 ──
  bookingFallido = (await db.query(
    `INSERT INTO bookings (type,date,instagram,"fullName",phone,delivery_status,"createdAt")
     VALUES ('domicilio',$1,$2,$3,'8710007777','no_entregado',now()) RETURNING id`,
    [isoDePrueba(-5), "@" + IG, ETIQUETA])).rows[0].id;

  const bk2 = await db.query(
    `INSERT INTO bookings (type,date,instagram,"fullName",phone,amount_due,delivery_status,"createdAt")
     VALUES ('domicilio',$1,$2,$3,'8710007777',0,'pendiente',now()) RETURNING id`,
    [isoDePrueba(3), "@" + IG, ETIQUETA]);
  const idGuardado = bookingId;
  bookingId = bk2.rows[0].id;
  d = await detalle();
  if (Number(d.envioGuardado) === ENVIO_DOBLE && d.envioSugerido)
    ok(`con un viaje perdido sin saldar, propone $${ENVIO_DOBLE} en vez de $${ENVIO_NORMAL}`);
  else
    fail(`no aplico el envio doble: ${JSON.stringify({ e: d.envioGuardado, s: d.envioSugerido })}`);
  await db.query("DELETE FROM bookings WHERE id = $1", [bk2.rows[0].id]);
  bookingId = idGuardado;
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (ventaId) {
      await db.query("DELETE FROM payments WHERE sale_id = $1", [ventaId]);
      await db.query("DELETE FROM sale_items WHERE sale_id = $1", [ventaId]);
      await db.query("DELETE FROM bitacora_tareas WHERE sale_id = $1", [ventaId]);
      await db.query("DELETE FROM pendientes_sacar WHERE sale_id = $1", [ventaId]);
      await db.query("DELETE FROM audit_logs WHERE entity_id = $1", [String(ventaId)]);
      await db.query("DELETE FROM sales WHERE id = $1", [ventaId]);
    }
    for (const id of [bookingId, bookingFallido].filter(Boolean)) {
      await db.query("DELETE FROM bookings WHERE id = $1", [id]);
    }
    await db.query(`DELETE FROM bookings WHERE instagram = $1`, ["@" + IG]);
    if (clienteId) await db.query("DELETE FROM clients WHERE id = $1", [clienteId]);
    await db.query("DELETE FROM products WHERE name LIKE $1", [ETIQUETA + "%"]);
    const quedan = await db.query(
      `select (select count(*) from bookings where instagram = $1)::int as b,
              (select count(*) from products where name like $2)::int as p`, ["@" + IG, ETIQUETA + "%"]);
    out.push(`  --    datos de prueba eliminados (quedan ${quedan.rows[0].b} entregas, ${quedan.rows[0].p} productos)`);
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
