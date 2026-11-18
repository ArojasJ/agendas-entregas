import { chromium, devices } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";

// El GPS del repartidor se apagaba solo y el panel no se enteraba.
//
// Al abrir Google Maps y volver, la pantalla se recarga entera y el botón del GPS
// volvía apagado: era lo único de la ruta que no se guardaba. Se apagaba en la primera
// parada del día. Y como al cerrar la app nunca se le avisaba al servidor, la bandera
// is_active se quedaba en true para siempre: el panel decía "activo" con una posición
// de hacía horas.
//
// OJO: driver_location es UNA SOLA FILA compartida, la que el panel enseña en vivo.
// La prueba la respalda al empezar y la devuelve al terminar, para no romperle la
// vista al dueño si el repartidor anda trabajando.

const BASE = process.env.BASE_URL || "http://localhost:3000";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let respaldo = null;
let ids = [];

const fila = async () => (await db.query("select * from driver_location where id = 1")).rows[0] || null;

try {
  await db.connect();
  respaldo = await fila();
  out.push("  --    ubicación real respaldada para devolverla al final");

  const dia = isoDePrueba();
  for (const n of ["uno", "dos"]) {
    const r = await db.query(
      `INSERT INTO bookings (type,date,instagram,"fullName",phone,status,delivery_status,products,amount_due,address,city,state)
       VALUES ('domicilio',$1,$2,'PRUEBA_GPS','8710001234','confirmed','pendiente','algo',0,
               'Calle: Falsa, Num: #1, Col: Centro','Torreón','Coahuila') RETURNING id`,
      [dia, "@prueba_gps_" + n]);
    ids.push(r.rows[0].id);
  }

  const ctx = await browser.newContext({
    ...devices["iPhone 13"],
    viewport: { width: 390, height: 844 },
    permissions: ["geolocation"],
    geolocation: { latitude: 25.5464, longitude: -103.4497 },
  });
  await ctx.addInitScript((dia) => {
    const [a, m, d] = dia.split("-").map(Number);
    const Real = Date;
    const corrimiento = new Real(a, m - 1, d, 10, 0, 0).getTime() - Real.now();
    function Falso(...args) { return args.length === 0 ? new Real(Real.now() + corrimiento) : new Real(...args); }
    Falso.prototype = Real.prototype;
    Falso.now = () => Real.now() + corrimiento;
    Falso.parse = Real.parse; Falso.UTC = Real.UTC;
    window.Date = Falso;
  }, dia);
  await ctx.addInitScript(({ t, orden }) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "worker");
    localStorage.setItem("staffName", "Repartidor");
    localStorage.setItem("rutaMode", "driving");
    localStorage.setItem("rutaOrder", JSON.stringify(orden));
    localStorage.setItem("rutaIdx", "0");
  }, { t: tokenDePrueba("worker", "Repartidor"), orden: ids });

  const page = await ctx.newPage();

  // Dejar la fila vieja y rancia, como queda después de un día de trabajo
  await db.query(
    `update driver_location set lat=1, lng=1, is_active=true, updated_at=now() - interval '3 hours' where id=1`);

  // ── 1. Se prende solo al entrar en conducción ──
  await page.goto(`${BASE}/panel/entregas/ruta`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(6000);

  let f = await fila();
  const seMovio = f && Math.abs(Number(f.lat) - 25.5464) < 0.01;
  if (seMovio) ok("al entrar en conducción el GPS se prende solo: ya no depende de que se acuerde");
  else fail("no mandó ubicación al entrar: " + JSON.stringify(f));

  const prendido = await page.evaluate(() => localStorage.getItem("rutaGps"));
  if (prendido === "on") ok("y queda anotado en el teléfono que está prendido");
  else fail("no se guardó el estado: " + prendido);

  // ── 2. Sobrevive al regreso de Google Maps ──
  // Volver de Maps es exactamente esto: la pantalla se recarga entera.
  await db.query(`update driver_location set lat=1, lng=1, updated_at=now() - interval '3 hours' where id=1`);
  await ctx.setGeolocation({ latitude: 25.5500, longitude: -103.4400 });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(6000);

  f = await fila();
  if (f && Math.abs(Number(f.lat) - 25.55) < 0.01)
    ok("y sigue prendido después de recargar: ya no se apaga en la primera parada");
  else
    fail("se apagó al volver de Maps: " + JSON.stringify(f));

  // ── 3. Si él lo apaga, se queda apagado ──
  const botonGps = page.getByRole("button", { name: /GPS/ }).first();
  await botonGps.click();
  await page.waitForTimeout(2500);
  const apagado = await page.evaluate(() => localStorage.getItem("rutaGps"));
  f = await fila();
  if (apagado === "off" && f?.is_active === false)
    ok("si él lo apaga, se apaga de verdad y el panel se entera");
  else
    fail("no se apagó bien: " + apagado + " / " + JSON.stringify(f));

  await db.query(`update driver_location set lat=9, lng=9, updated_at=now() - interval '3 hours' where id=1`);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(5000);
  f = await fila();
  if (Number(f.lat) === 9)
    ok("y al recargar NO se lo vuelve a prender a la fuerza: fue su decisión");
  else
    fail("se lo prendió contra su voluntad: " + JSON.stringify(f));

  // ── 4. El panel deja de decir "activo" con un dato viejo ──
  await db.query(
    `update driver_location set lat=25.54, lng=-103.44, is_active=true, updated_at=now() - interval '3 hours' where id=1`);

  const ctxPanel = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctxPanel.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Antonio");
  }, tokenDePrueba("admin", "Antonio"));
  const panel = await ctxPanel.newPage();
  await panel.goto(`${BASE}/panel/entregas/live`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await panel.waitForTimeout(4000);

  const texto = (await panel.locator("body").innerText()).replace(/\s+/g, " ");

  if (/hace 3 h/i.test(texto)) ok("el panel dice la antigüedad como se lee: 'hace 3 h', no 'hace 10800s'");
  else fail("no dice la antigüedad entendible: " + (texto.match(/hace [^·—]{0,24}/i) || ["(nada)"])[0]);

  if (/puede que ya no esté ahí/i.test(texto))
    ok("y avisa que ese punto ya no significa dónde está");
  else
    fail("no advierte que el dato está viejo");

  // "Ruta en Vivo" es el título de la pantalla y se queda. Lo que no puede decir "en
  // vivo" es lo que describe AL REPARTIDOR: el letrero de estado y la leyenda del mapa.
  if (!/Repartidor \(en vivo\)/i.test(texto) && !/Compartiendo ubicación/i.test(texto) && !/En vivo ·/i.test(texto))
    ok("y nada dice que el repartidor esté en vivo con una señal de hace tres horas");
  else
    fail("sigue diciendo que está en vivo: " + (texto.match(/(En vivo ·[^·]{0,20}|Repartidor \(en vivo\)|Compartiendo ubicación)/i) || ["?"])[0]);

  // Y con una señal de ahora sí debe decir que está en vivo
  await db.query(`update driver_location set is_active=true, updated_at=now() where id=1`);
  await panel.waitForTimeout(6500);
  const ahora = (await panel.locator("body").innerText()).replace(/\s+/g, " ");
  if (/En vivo ·/i.test(ahora) && /Repartidor \(en vivo\)/i.test(ahora))
    ok("con una señal de hace segundos sí dice 'en vivo', arriba y en la leyenda");
  else fail("no reconoce una señal fresca: " + ahora.slice(0, 220));

  await panel.screenshot({ path: "scripts/gps-panel.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (ids.length) await db.query("DELETE FROM bookings WHERE id = ANY($1::uuid[])", [ids]);
    if (respaldo) {
      await db.query(
        `update driver_location set lat=$1, lng=$2, is_active=$3, updated_at=$4 where id=1`,
        [respaldo.lat, respaldo.lng, respaldo.is_active, respaldo.updated_at]);
      out.push("  --    ubicación real devuelta a como estaba");
    }
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
