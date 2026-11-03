import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { fechasFloreria } from "../lib/constants.js";

// La lista de entregas corta en el día de hoy, así que las de florería que ya pasaron
// no se podían consultar sin adivinar un rango de fechas. El botón "Todas las entregas"
// quita ese corte, y solo en esa pestaña.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const IG = "@prueba_historial";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const haceDias = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
const creadas = [];

try {
  await db.connect();

  const reservas = [
    ["Prueba Hist Futura", iso(fechasFloreria(1)[0])],
    ["Prueba Hist Reciente", iso(haceDias(20))],
    ["Prueba Hist Vieja", iso(haceDias(60))],
  ];
  for (const [nombre, fecha] of reservas) {
    const r = await db.query(
      `INSERT INTO bookings (type, date, instagram, "fullName", phone, override, "createdAt",
                             products, amount_due, delivery_status, payment_method, tenant_slug)
       VALUES ('floreria',$1,$2,$3,'8711234567',false,now(),'1xPRODUCTO',0,'pendiente','efectivo','noreste')
       RETURNING id`, [fecha, IG, nombre]);
    creadas.push(r.rows[0].id);
  }
  ok(`creadas 3 reservas: una futura, una de hace 20 días y una de hace 60`);

  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Prueba Admin"));

  const registros = async () => {
    const t = await page.locator("body").innerText();
    const m = /(\d+)\s+registros/.exec(t);
    return m ? Number(m[1]) : null;
  };
  const seVe = async (nombre) => (await page.getByText(nombre, { exact: false }).count()) > 0;
  const pestana = (n) => page.getByRole("button", { name: n, exact: true });
  const botonTodas = () => page.getByRole("button", { name: /🌷 (Todas las entregas|Viendo todas)/ });

  await page.goto(`${BASE}/panel/entregas`, { waitUntil: "networkidle", timeout: 90000 });
  await page.getByText("Panel de entregas").first().waitFor({ state: "visible", timeout: 60000 });

  // Cuánto se ve en Domicilio ANTES de tocar nada, para comprobar después que el
  // botón de florería no se le mete a las otras pestañas.
  await pestana("🚚 Domicilio").click();
  await page.waitForTimeout(900);
  const domicilioAntes = await registros();
  ok(`domicilio muestra ${domicilioAntes} registros antes de tocar nada`);

  // ── Florería, como está de costumbre ──
  await pestana("🌷 Florería").click();
  await page.waitForTimeout(900);
  const antes = await registros();

  if (await seVe("Prueba Hist Futura")) ok("de entrada se ve la entrega que todavía no pasa");
  else fail("de entrada no se ve la entrega futura");

  if (!(await seVe("Prueba Hist Vieja")) && !(await seVe("Prueba Hist Reciente")))
    ok(`de entrada las pasadas quedan fuera, como siempre (${antes} registros)`);
  else
    fail("de entrada ya salían las entregas pasadas");

  const textoFlor = await page.locator("body").innerText();
  if (textoFlor.includes("Entregas en florería"))
    ok('el título de la lista dice "Entregas en florería"');
  else
    fail("el título de la lista no corresponde a florería");

  // Las dos etiquetas decían "Paquetería" estando en la pestaña de florería
  if (textoFlor.includes("Tendencia · Florería"))
    ok('la gráfica dice "Tendencia · Florería"');
  else
    fail('la gráfica sigue con otra etiqueta estando en florería');

  if (!/Tendencia · Paquetería/.test(textoFlor))
    ok("y ya no dice Paquetería en la pestaña equivocada");
  else
    fail("la gráfica todavía dice Paquetería estando en florería");

  // ── Prender "Todas las entregas" ──
  if (await botonTodas().count() === 0) throw new Error("no apareció el botón de Todas las entregas");
  await botonTodas().click();
  await page.waitForTimeout(900);
  const despues = await registros();

  if (await seVe("Prueba Hist Vieja")) ok("con Todas aparece la de hace 60 días");
  else fail("con Todas sigue sin verse la de hace 60 días");

  if (await seVe("Prueba Hist Reciente")) ok("con Todas aparece la de hace 20 días");
  else fail("con Todas sigue sin verse la de hace 20 días");

  if (await seVe("Prueba Hist Futura")) ok("y la futura no se perdió");
  else fail("con Todas se perdió la entrega futura");

  if (despues > antes) ok(`la cuenta subió de ${antes} a ${despues} registros`);
  else fail(`la cuenta no subió: antes ${antes}, después ${despues}`);

  const cuerpo = await page.locator("body").innerText();
  if (cuerpo.includes("Todo el historial de florería"))
    ok("se marca con una etiqueta que estás viendo todo el historial");
  else
    fail("no avisa que estás viendo todo el historial");

  if (/Viendo todas/.test(await botonTodas().innerText())) ok("el botón queda marcado como encendido");
  else fail("el botón no se ve encendido");

  // Lo más reciente arriba: de otro modo lo de hace meses tapa lo de esta semana
  const pos = (n) => cuerpo.indexOf(n);
  if (pos("Prueba Hist Futura") < pos("Prueba Hist Reciente") &&
      pos("Prueba Hist Reciente") < pos("Prueba Hist Vieja"))
    ok("salen de la más nueva a la más vieja");
  else
    fail("el orden no va de la más nueva a la más vieja");

  // ── Que no se les meta a las otras pestañas ──
  await pestana("🚚 Domicilio").click();
  await page.waitForTimeout(900);
  const domicilioDespues = await registros();
  if (domicilioDespues === domicilioAntes)
    ok(`domicilio sigue igual en ${domicilioDespues} registros: el botón es solo de florería`);
  else
    fail(`domicilio cambió de ${domicilioAntes} a ${domicilioDespues} registros`);

  if (await botonTodas().count() === 0) ok("el botón no aparece fuera de la pestaña de florería");
  else fail("el botón de florería se ve en domicilio");

  // ── Volver y apagarlo con Limpiar ──
  await pestana("🌷 Florería").click();
  await page.waitForTimeout(900);
  if (await seVe("Prueba Hist Vieja")) ok("al regresar a florería sigue mostrando todo");
  else fail("al regresar a florería se olvidó el filtro");

  await page.getByRole("button", { name: "Limpiar", exact: true }).click();
  await page.waitForTimeout(900);
  if (!(await seVe("Prueba Hist Vieja"))) ok("Limpiar apaga el historial y vuelve a lo de siempre");
  else fail("Limpiar no apagó el historial");

  if ((await registros()) === antes) ok(`y la cuenta regresa a ${antes} registros`);
  else fail(`la cuenta quedó en ${await registros()} y debía volver a ${antes}`);

  await page.screenshot({ path: "scripts/floreria-historial.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (creadas.length) await db.query("DELETE FROM bookings WHERE id = ANY($1::uuid[])", [creadas]);
    const quedan = await db.query("SELECT count(*) n FROM bookings WHERE instagram ilike '%prueba%'");
    out.push(`  --    reservas de prueba eliminadas; quedan ${quedan.rows[0].n}`);
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
