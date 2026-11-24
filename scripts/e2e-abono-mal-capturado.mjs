import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// El caso de @perlajanet_24: una venta a crédito de $770 en la que se capturó un abono
// por el total en vez de por lo que la clienta había dado. La venta quedó liquidada
// por accidente.
//
// Y ahí se acababa el camino. El botón de borrar el abono existe desde siempre, pero
// vive dentro de "Historial de Abonos", y esa sección solo salía mientras la venta
// estuviera a crédito: en cuanto quedaba pagada, el historial desaparecía de la
// pantalla junto con la única forma de corregirlo. Encima el recuadro decía "Pagado de
// contado", escondiendo que ese dinero había entrado en abonos.
//
// Lo que de verdad cierra una venta es el corte de caja, y eso el botón ya lo respeta.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_ABONO_MAL";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let clienteId, productoId, ventaId, ventaCortada, corteId;

const venta = async (id) => (await db.query(
  `select total, down_payment, status from sales where id = $1`, [id])).rows[0];
const abonos = async (id) => (await db.query(
  `select amount, pos_cut_id from payments where sale_id = $1 order by created_at`, [id])).rows;

async function ventaDe(total, pagado, status) {
  const v = await db.query(
    `INSERT INTO sales (client_id,total,down_payment,discount,status,payment_method,created_at,due_date)
     VALUES ($1,$2,0,0,$3,'efectivo',now(),current_date + 14) RETURNING id`, [clienteId, total, status]);
  await db.query(
    `INSERT INTO sale_items (sale_id,product_id,quantity,unit_price,delivery_status)
     VALUES ($1,$2,1,$3,'pending')`, [v.rows[0].id, productoId, total]);
  if (pagado > 0) {
    await db.query(`INSERT INTO payments (sale_id,amount) VALUES ($1,$2)`, [v.rows[0].id, pagado]);
  }
  return v.rows[0].id;
}

try {
  await db.connect();

  const c = await db.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,'@prueba_abono_mal','8710009999') RETURNING id`, [ETIQUETA]);
  clienteId = c.rows[0].id;
  const p = await db.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',770,5,300) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;

  // El accidente: un abono por el total entero, la venta queda liquidada
  ventaId = await ventaDe(770, 770, "paid");
  ok("venta de $770 liquidada por un abono de $770 capturado de más");

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Antonio");
  }, tokenDePrueba("admin", "Antonio"));
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());

  const abrir = async (id) => {
    await page.goto(`${BASE}/panel/ventas/${id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByRole("heading", { name: /Detalle de Venta/i }).waitFor({ state: "visible", timeout: 60000 });
    await page.waitForTimeout(2500);
  };
  const cuerpo = async () => (await page.locator("body").innerText()).replace(/\s+/g, " ");

  await abrir(ventaId);
  let t = await cuerpo();

  if (/Historial de Abonos/i.test(t))
    ok("estando liquidada, el historial de abonos SÍ se ve: ahí está la única forma de corregir");
  else
    fail("el historial sigue escondido en una venta liquidada");

  if (!/Pagado de contado/i.test(t))
    ok("y ya no miente diciendo 'pagado de contado'");
  else
    fail("sigue diciendo que se pagó de contado una venta liquidada a abonos");

  if (/Enganche: \$0 \+ \$770 en abonos/i.test(t))
    ok("dice de dónde salió el dinero: $0 de enganche y $770 en abonos");
  else
    fail("no desglosa el pago: " + (t.match(/Enganche[^A-Z]{0,40}|Pagado[^A-Z]{0,20}/i) || ["(nada)"])[0]);

  if (!/\+ Registrar Abono/i.test(t))
    ok("y no ofrece abonar de nuevo: ya no debe nada");
  else
    fail("ofrece registrar otro abono en una venta sin deuda");

  await page.screenshot({ path: "scripts/abono-mal-capturado.png" });

  // ── Corregirlo: borrar el abono malo ──
  await page.getByRole("button", { name: /^Eliminar$/ }).first().click();
  await page.waitForTimeout(4000);

  const v1 = await venta(ventaId);
  if (v1.status === "credit" && (await abonos(ventaId)).length === 0)
    ok("al borrarlo, la venta vuelve sola a crédito debiendo los $770");
  else
    fail("no volvió a crédito: " + JSON.stringify(v1));

  // ── Y capturar el bueno ──
  await abrir(ventaId);
  await page.getByRole("button", { name: /\+ Registrar Abono/i }).click();
  await page.waitForTimeout(1500);
  const monto = page.locator('input[type="number"]').last();
  await monto.fill("100");
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^Guardar|Registrar$/i }).last().click();
  await page.waitForTimeout(4000);

  const v2 = await venta(ventaId);
  const ab2 = await abonos(ventaId);
  if (v2.status === "credit" && ab2.length === 1 && Number(ab2[0].amount) === 100)
    ok("se captura el abono bueno de $100 y la venta sigue a crédito");
  else
    fail("quedó mal después de recapturar: " + JSON.stringify({ v2, ab2 }));

  t = await cuerpo();
  if (/\$670\.00/.test(t)) ok("y la deuda queda en $670, que es lo que de verdad debe");
  else fail("la deuda no cuadra: " + (t.match(/ESTADO \/ DEUDA[^A-Z]{0,20}/i) || ["?"])[0]);

  // ── Lo que ya entró a un corte sigue con candado ──
  const cut = await db.query(
    `INSERT INTO pos_cuts (total_amount, created_at) VALUES (0, now()) RETURNING id`);
  corteId = cut.rows[0].id;
  ventaCortada = await ventaDe(500, 500, "paid");
  await db.query(`update payments set pos_cut_id = $1 where sale_id = $2`, [corteId, ventaCortada]);

  await abrir(ventaCortada);
  const btn = page.getByRole("button", { name: /^Eliminar$/ }).first();
  if (await btn.count() > 0 && await btn.isDisabled())
    ok("un abono que ya entró a un corte se ve, pero no se puede borrar: ese dinero ya se contó");
  else
    fail("se puede borrar un abono ya cortado");
} catch (e) {
  fail(e.message);
} finally {
  try {
    for (const id of [ventaId, ventaCortada].filter(Boolean)) {
      await db.query("DELETE FROM payments WHERE sale_id = $1", [id]);
      await db.query("DELETE FROM sale_items WHERE sale_id = $1", [id]);
      await db.query("DELETE FROM bitacora_tareas WHERE sale_id = $1", [id]);
      await db.query("DELETE FROM pendientes_sacar WHERE sale_id = $1", [id]);
      await db.query("DELETE FROM audit_logs WHERE entity_id = $1", [String(id)]);
      await db.query("DELETE FROM sales WHERE id = $1", [id]);
    }
    if (corteId) await db.query("DELETE FROM pos_cuts WHERE id = $1", [corteId]);
    if (clienteId) await db.query("DELETE FROM clients WHERE id = $1", [clienteId]);
    if (productoId) await db.query("DELETE FROM products WHERE id = $1", [productoId]);
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
