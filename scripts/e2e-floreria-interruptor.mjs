import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { fechasFloreria } from "../lib/constants.js";

// Apagar la florería escondía también su pestaña del panel de entregas, y si estabas
// parada en ella te sacaba a Domicilio. El interruptor es para que la clienta no pueda
// agendar; lo ya agendado se tiene que seguir entregando.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const IG = "@prueba_interruptor";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();

let valorOriginal = null, reservaId = null;

const ponerAjuste = (v) =>
  db.query(
    `INSERT INTO app_settings (key, value) VALUES ('floreria_activa', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [v]);

try {
  await db.connect();

  const prev = await db.query("SELECT value FROM app_settings WHERE key='floreria_activa'");
  valorOriginal = prev.rows[0]?.value ?? null;
  out.push(`  --    el ajuste estaba en "${valorOriginal}"; se restaura al terminar`);

  const r = await db.query(
    `INSERT INTO bookings (type, date, instagram, "fullName", phone, override, "createdAt",
                           products, amount_due, delivery_status, payment_method, tenant_slug)
     VALUES ('floreria', $1, $2, 'Prueba Interruptor', '8711234567', false, now(),
             '1xPRODUCTO DE PRUEBA', 0, 'pendiente', 'efectivo', 'noreste') RETURNING id`,
    [iso(fechasFloreria(1)[0]), IG]);
  reservaId = r.rows[0].id;

  await ponerAjuste("true");

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Prueba Admin"));

  const panel = await ctx.newPage();
  const publica = await ctx.newPage();

  const pestanaFloreria = () => panel.getByRole("button", { name: "🌷 Florería", exact: true });
  const interruptor = () => panel.getByRole("button", { name: /🌷 Florería: (Activa|Inactiva)/ });
  const ajustes = () => panel.getByRole("button", { name: /Horario y dirección de la florería/ });
  // Solo se pinta cuando la pestaña abierta es la de florería: sirve de testigo
  const estoyEnFloreria = async () => (await ajustes().count()) > 0;

  const opcionPublica = async () => {
    await publica.goto(`${BASE}/agendar`, { waitUntil: "networkidle", timeout: 90000 });
    await publica.waitForTimeout(1200);
    return (await publica.getByRole("button", { name: /Florería/i }).count()) > 0;
  };

  await panel.goto(`${BASE}/panel/entregas`, { waitUntil: "networkidle", timeout: 90000 });
  await panel.getByText("Panel de entregas").first().waitFor({ state: "visible", timeout: 60000 });

  // ── Con la florería encendida ──
  if (await pestanaFloreria().count() > 0) ok("encendida: la pestaña Florería está en el panel");
  else fail("encendida: no apareció la pestaña Florería");

  await pestanaFloreria().click();
  await panel.waitForTimeout(800);
  if (await estoyEnFloreria()) ok("encendida: se puede abrir la pestaña");
  else fail("encendida: no se abrió la pestaña");

  if (await panel.getByText("Prueba Interruptor").count() > 0) ok("encendida: se ve la reserva de florería");
  else fail("encendida: no se ve la reserva");

  if (await opcionPublica()) ok("encendida: la clienta SÍ puede agendar florería");
  else fail("encendida: la clienta no ve la opción de florería");

  // ── Apagarla desde el panel, estando parada en su pestaña ──
  await interruptor().click();
  await panel.waitForTimeout(2000);

  const etiqueta = await interruptor().innerText();
  if (/Inactiva/.test(etiqueta)) ok("el interruptor quedó en Inactiva");
  else fail(`el interruptor dice "${etiqueta.replace(/\n/g, " ")}"`);

  if (await estoyEnFloreria()) ok("apagada: NO te saca de la pestaña (era el reclamo)");
  else fail("apagada: te sacó de la pestaña de florería");

  if (await pestanaFloreria().count() > 0) ok("apagada: la pestaña Florería sigue en el panel");
  else fail("apagada: desapareció la pestaña del panel (era el reclamo)");

  if (await panel.getByText("Prueba Interruptor").count() > 0) ok("apagada: la reserva se sigue viendo y se puede entregar");
  else fail("apagada: se dejaron de ver las reservas de florería");

  if (await ajustes().count() > 0) ok("apagada: se puede seguir editando horario y dirección");
  else fail("apagada: ya no deja editar horario y dirección");

  if (!(await opcionPublica())) ok("apagada: la clienta YA NO puede agendar florería");
  else fail("apagada: la clienta todavía ve la opción de florería");

  // ── Y al volver a encenderla ──
  await interruptor().click();
  await panel.waitForTimeout(2000);
  if (/Activa/.test(await interruptor().innerText())) ok("se vuelve a encender desde el panel");
  else fail("no se pudo volver a encender");

  if (await estoyEnFloreria()) ok("al encenderla tampoco te mueve de pestaña");
  else fail("al encenderla te sacó de la pestaña");

  if (await opcionPublica()) ok("encendida de nuevo: la clienta vuelve a ver la opción");
  else fail("encendida de nuevo: la clienta sigue sin ver la opción");

  await panel.screenshot({ path: "scripts/floreria-interruptor.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (reservaId) await db.query("DELETE FROM bookings WHERE id=$1", [reservaId]);
    if (valorOriginal !== null) {
      await ponerAjuste(valorOriginal);
      const ahora = await db.query("SELECT value FROM app_settings WHERE key='floreria_activa'");
      out.push(`  --    ajuste restaurado a "${ahora.rows[0]?.value}" (estaba en "${valorOriginal}")`);
    }
    const quedan = await db.query("SELECT count(*) n FROM bookings WHERE instagram ilike '%prueba%'");
    out.push(`  --    reservas de prueba que quedan: ${quedan.rows[0].n}`);
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
