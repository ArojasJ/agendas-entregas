import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";

// La segunda falla que tapaba el historial de cortes.
//
// "Se llevo todo y sigue debiendo, ¿ya te pago?" se dibujaba DENTRO de
// <CashboxHistoryModal>, un componente que ni siquiera tiene ese estado. Dos daños:
//
//   1. Abrir el historial de cortes tumbaba la pagina ("cobrosPendientes is not
//      defined") — eso lo cubre e2e-historial-de-cortes.
//   2. La pregunta NO PODIA SALIR NUNCA al marcar una entrega, porque solo existia
//      dentro de un modal que ademas se caia. El dinero se daba por cobrado sin que
//      nadie preguntara, que es justo lo que la regla de "entregar no es cobrar"
//      existe para impedir.
//
// Aqui se comprueba lo segundo: entregar una venta que sigue debiendo tiene que
// preguntar, y la venta NO debe quedar liquidada sola.
//
// Entrega a 400 dias (fechaDePrueba) para no tocarle la ruta a nadie, y productos
// con stock 2 para no inflar el Valor del Inventario mientras corre.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_YA_PAGO";
const IG = "prueba_ya_pago";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch({
  args: ["--host-resolver-rules=MAP localhost 127.0.0.1"],
});
let clienteId, ventaId, productoId, bookingId;

try {
  await db.connect();
  const fecha = isoDePrueba();

  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8710006666') RETURNING id`,
    [ETIQUETA, "@" + IG]);
  clienteId = c.rows[0].id;

  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',800,2,300) RETURNING id`,
    [ETIQUETA]);
  productoId = p.rows[0].id;

  // Venta de $800 con enganche de $200: SIGUE DEBIENDO $600.
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,due_date)
     VALUES ($1,800,200,0,'credit','efectivo',now(),current_date + 14) RETURNING id`, [clienteId]);
  ventaId = v.rows[0].id;
  const it = await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,800,'pending') RETURNING id`, [ventaId, productoId]);

  const bk = await db.query(
    `INSERT INTO bookings (type,date,instagram,"fullName",phone,address,city,amount_due,products,
                           delivery_status,sale_item_ids,"createdAt")
     VALUES ('domicilio',$1,$2,$3,'8710006666','Calle de prueba 2','Torreon',600,$4,
             'pendiente',$5,now()) RETURNING id`,
    [fecha, "@" + IG, ETIQUETA, `1x ${ETIQUETA}`, JSON.stringify([it.rows[0].id])]);
  bookingId = bk.rows[0].id;
  await db.query(`update sale_items set paquete_booking_id = $1 where id = $2`, [bookingId, it.rows[0].id]);
  ok(`venta de $800 con $200 de enganche (debe $600) y su entrega para ${fecha}`);

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Antonio");
  }, tokenDePrueba("admin", "Antonio"));
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e.message)));

  await page.goto(`${BASE}/panel/entregas`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(6000);

  // Acotar el rango de fechas a la entrega de prueba, que vive a 400 dias.
  const fechas = page.locator('input[type="date"]');
  await fechas.nth(0).fill(fecha);
  await fechas.nth(1).fill(fecha);
  await page.waitForTimeout(3000);

  const tarjeta = page.getByText(ETIQUETA, { exact: false }).first();
  if (await tarjeta.count() === 0) {
    fail("la entrega de prueba no salio en la lista de Entregas");
  } else {
    ok("la entrega sale en la lista al filtrar por su fecha");
    await tarjeta.click();
    await page.waitForTimeout(2000);

    const editando = /Editar entrega/i.test(await page.locator("body").innerText());
    if (!editando) fail("no abrio 'Editar entrega'");

    // Marcarla como entregada, que es el acto que debe disparar la pregunta.
    await page.getByRole("combobox").last().selectOption("entregado");
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: /^Guardar$/ }).click();
    await page.waitForTimeout(6000);

    const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    await page.screenshot({ path: "scripts/pregunta-si-ya-pago.png" });

    if (/cobrosPendientes/.test(errores.join(" ")))
      fail("volvio a tronar por cobrosPendientes");
    else
      ok("guardar la entrega no truena la pantalla");

    // La pregunta. Es lo que antes no podia salir nunca.
    //
    // Se busca el texto PROPIO del dialogo, no palabras sueltas: "cobr" lo cumple
    // "Cobranza" del menu y "600" lo cumple la tarjeta de la entrega, asi que una
    // prueba laxa pasaba con el dialogo apagado y no vigilaba nada.
    if (/¿Ya te pagó\?/i.test(t))
      ok("PREGUNTA '¿Ya te pagó?' al entregar una venta que sigue debiendo");
    else
      fail("no pregunto nada al entregar debiendo $600: " + t.slice(-240));

    if (/FALTA POR COBRAR \$600\.00/i.test(t))
      ok("y dice cuanto falta: $600.00");
    else
      fail("no dice lo que falta por cobrar");

    const siPago = page.getByRole("button", { name: /Sí, me pagó \$600\.00/i });
    const noPago = page.getByRole("button", { name: /No, queda a deber/i });
    if (await siPago.count() > 0 && await noPago.count() > 0)
      ok("con las dos salidas: 'Sí, me pagó $600.00' y 'No, queda a deber'");
    else
      fail("falta alguno de los dos botones de la pregunta");

    // Y lo que de verdad importa: que no se haya dado por cobrada sola.
    const venta = (await db.query(
      `select status, down_payment::numeric as enganche from sales where id = $1`, [ventaId])).rows[0];
    const abonos = (await db.query(
      `select coalesce(sum(amount::numeric),0) as t from payments where sale_id = $1`, [ventaId])).rows[0].t;

    if (venta.status === "credit")
      ok("la venta SIGUE a credito: entregar no la liquido sola");
    else
      fail("la venta quedo como " + venta.status + " sin que nadie cobrara");

    if (Number(venta.enganche) === 200)
      ok("y el enganche sigue en $200, no se inflo al total");
    else
      fail("el enganche se movio a " + venta.enganche);

    if (Number(abonos) === 0)
      ok("y no se invento ningun abono");
    else
      fail("apareció un abono de " + abonos);
  }
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
    await db.query(`DELETE FROM bookings WHERE instagram = $1`, ["@" + IG]);
    if (clienteId) await db.query("DELETE FROM clients WHERE id = $1", [clienteId]);
    if (productoId) await db.query("DELETE FROM products WHERE id = $1", [productoId]);
    const q = await db.query(
      `select (select count(*) from bookings where instagram = $1)::int as b,
              (select count(*) from products where name like $2)::int as p`, ["@" + IG, ETIQUETA + "%"]);
    out.push(`  --    datos de prueba eliminados (quedan ${q.rows[0].b} entregas, ${q.rows[0].p} productos)`);
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
