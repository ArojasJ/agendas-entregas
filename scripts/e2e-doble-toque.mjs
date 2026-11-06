import { chromium, devices } from "playwright";
import { Client } from "pg";

// Un doble toque en la pantalla pública creaba dos reservas. El botón se apaga con
// isSubmitting, pero entre el primer toque y que React vuelva a pintar hay un hueco, y
// en el celular se toca dos veces sin querer. Ahora el candado es una referencia, que
// se cierra en el mismo instante.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const IG = "@pruebadobletoque";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let floreriaOriginal = null;

const ponerFloreria = (v) =>
  db.query(`INSERT INTO app_settings (key, value) VALUES ('floreria_activa', $1)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [v]);

const cuantasReservas = async () =>
  Number((await db.query("SELECT count(*) n FROM bookings WHERE instagram ILIKE $1", [IG])).rows[0].n);

try {
  await db.connect();
  await db.query("DELETE FROM bookings WHERE instagram ILIKE $1", [IG]);

  // La florería puede estar apagada; se enciende solo para la prueba y se restaura
  const prev = await db.query("SELECT value FROM app_settings WHERE key='floreria_activa'");
  floreriaOriginal = prev.rows[0]?.value ?? null;
  await ponerFloreria("true");
  out.push(`  --    florería estaba en "${floreriaOriginal}"; se restaura al terminar`);

  // Desde el celular, que es donde pasa
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await ctx.newPage();

  const posts = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/bookings") && r.request().method() === "POST") posts.push(r.status());
  });

  await page.goto(`${BASE}/agendar`, { waitUntil: "networkidle", timeout: 90000 });

  const pestana = page.getByRole("button", { name: /Florería/i }).first();
  if (await pestana.count() === 0) throw new Error("no aparece la opción de Florería");
  await pestana.click();
  await page.waitForTimeout(800);

  await page.getByPlaceholder("@tuusuario").fill(IG);
  await page.getByPlaceholder("Nombre y apellidos").fill("Prueba Doble Toque");
  await page.getByPlaceholder("871...").fill("8711234567");
  ok("se llenan los datos de la clienta");

  const tarjetas = page.locator("button").filter({ hasText: /de nov|de dic|de ene/ });
  const cuantas = await tarjetas.count();
  if (cuantas < 2) throw new Error(`solo se pintaron ${cuantas} fechas`);
  ok(`se pintan ${cuantas} fechas para elegir`);

  // El doble toque de verdad. Los clics de Playwright se encolan uno tras otro y dan
  // tiempo a que React repinte, así que no reproducen nada: hay que disparar los tres
  // en el mismo instante, que es justo el hueco donde el botón todavía no se apaga.
  const etiqueta = (await tarjetas.first().innerText()).split("\n")[0].trim();
  const disparados = await page.evaluate((txt) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes(txt));
    if (!b) return 0;
    let n = 0;
    for (let i = 0; i < 3; i++) { if (!b.disabled) { b.click(); n++; } }
    return n;
  }, etiqueta);
  ok(`se dispararon ${disparados} toques en el mismo instante sobre la misma fecha`);

  await page.getByText("¡Todo listo!").waitFor({ state: "visible", timeout: 20000 });
  ok("la reserva se registra y aparece la confirmación");

  await page.waitForTimeout(2500);

  const trasDobleToque = await cuantasReservas();
  if (trasDobleToque === 1) ok(`3 toques seguidos dejaron 1 sola reserva (POSTs: ${posts.length})`);
  else fail(`3 toques seguidos dejaron ${trasDobleToque} reservas (POSTs: ${posts.length})`);

  // Con la confirmación en pantalla tampoco se puede agendar otra
  for (let i = 1; i < Math.min(4, cuantas); i++) {
    await tarjetas.nth(i).click({ timeout: 2000, force: true }).catch(() => {});
  }
  await page.waitForTimeout(2000);

  const trasClicsExtra = await cuantasReservas();
  if (trasClicsExtra === 1) ok("con la confirmación abierta, picar otras fechas no agenda de más");
  else fail(`picar otras fechas creó ${trasClicsExtra - 1} reserva(s) de más`);

  await page.screenshot({ path: "scripts/doble-toque.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    const n = (await db.query("DELETE FROM bookings WHERE instagram ILIKE $1", [IG])).rowCount;
    out.push(`  --    ${n} reserva(s) de prueba eliminadas`);
    if (floreriaOriginal !== null) {
      await ponerFloreria(floreriaOriginal);
      const ahora = await db.query("SELECT value FROM app_settings WHERE key='floreria_activa'");
      out.push(`  --    florería restaurada a "${ahora.rows[0]?.value}"`);
    }
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
