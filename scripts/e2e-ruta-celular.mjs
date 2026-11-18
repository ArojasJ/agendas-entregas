import { chromium, devices } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";

// La ruta como la ve el repartidor: en un iPhone, de pie en la calle. Se prueba en un
// teléfono con muesca porque los dos botones que más pica —"No estaba" y "Entregado"—
// quedaban debajo de la raya del home.
//
// Las paradas NO se crean con la fecha de hoy: aunque el script limpie al terminar,
// mientras corre existirían de verdad y se le meterían en la ruta al repartidor que
// está trabajando. La pantalla carga "hoy" según el reloj del teléfono, así que lo que
// se mueve es el reloj DEL NAVEGADOR de la prueba, no los datos.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_CELULAR";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
let ids = [];

try {
  await db.connect();
  const hoy = isoDePrueba();

  for (const n of ["uno", "dos"]) {
    const r = await db.query(
      `INSERT INTO bookings (type,date,instagram,"fullName",phone,status,delivery_status,products,amount_due,address,city,state)
       VALUES ('domicilio',$1,$2,$3,'8710001234','confirmed','pendiente','1x Blusa de prueba',45,
               'Calle: Falsa, Num: #123, Col: Centro','Torreón','Coahuila') RETURNING id`,
      [hoy, "@prueba_celular_" + n, ETIQUETA + " " + n]);
    ids.push(r.rows[0].id);
  }
  ok("dos paradas de prueba, en una fecha que no le estorba a nadie");

  const iphone = devices["iPhone 13"];
  const ctx = await browser.newContext({
    ...iphone,
    // La muesca y la barra del home de un iPhone moderno
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  // El navegador de la prueba cree que hoy es el día de prueba. Así la pantalla pide
  // esa ruta y las paradas falsas nunca existen en el día real de nadie.
  await ctx.addInitScript((dia) => {
    const [a, m, d] = dia.split("-").map(Number);
    const Real = Date;
    const corrimiento = new Real(a, m - 1, d, 10, 0, 0).getTime() - Real.now();
    function Falso(...args) {
      if (args.length === 0) return new Real(Real.now() + corrimiento);
      return new Real(...args);
    }
    Falso.prototype = Real.prototype;
    Falso.now = () => Real.now() + corrimiento;
    Falso.parse = Real.parse;
    Falso.UTC = Real.UTC;
    window.Date = Falso;
  }, isoDePrueba());

  // El modo conducción solo se restaura si el orden guardado empata con la ruta del
  // día, así que hay que sembrar los dos: es como queda el teléfono del repartidor
  // cuando vuelve de Google Maps a media ruta.
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

  // Medir lo que la pantalla descarga de verdad
  let bytes = 0;
  const porRuta = [];
  let pidioClientes = false;
  let pidioTodasLasEntregas = false;
  page.on("response", async (r) => {
    const u = r.url();
    if (!u.includes("/api/")) return;
    if (u.includes("/api/clients")) pidioClientes = true;
    if (/\/api\/bookings(\?|$)/.test(u)) pidioTodasLasEntregas = true;
    try {
      const n = (await r.body()).length;
      bytes += n;
      porRuta.push(`${(n / 1024).toFixed(1)} KB  ${u.replace(/^https?:\/\/[^/]+/, "")}`);
    } catch {}
  });

  await page.goto(`${BASE}/panel/entregas/ruta`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(2500);

  const kb = bytes / 1024;
  out.push(`  --    la pantalla descargó ${kb.toFixed(1)} KB de API`);
  for (const l of porRuta) out.push("  --      " + l);
  if (kb < 100) ok(`baja ${kb.toFixed(1)} KB en vez de los ~3,000 KB de antes`);
  else fail(`sigue bajando ${kb.toFixed(0)} KB`);

  if (!pidioClientes) ok("ya no pide /api/clients, que se bajaba y se tiraba a la basura");
  else fail("sigue pidiendo /api/clients");

  if (!pidioTodasLasEntregas) ok("ni /api/bookings con la historia completa");
  else fail("sigue pidiendo todas las entregas");

  // ── La tipografía ──
  const fuente = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
  if (!/Arial/i.test(fuente)) ok("el cuerpo ya no usa Arial: " + fuente.split(",")[0]);
  else fail("sigue en Arial: " + fuente);

  // ── El recuadro azul al tocar ──
  const resalte = await page.evaluate(() => getComputedStyle(document.body).webkitTapHighlightColor);
  if (/rgba\(0,\s*0,\s*0,\s*0\)|transparent/.test(resalte || ""))
    ok("sin el recuadro azul del navegador al tocar");
  else
    fail("sigue el resalte al tocar: " + resalte);

  // ── El rebote ──
  const rebote = await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehavior);
  if (/none/.test(rebote || "")) ok("sin rebote ni 'jalar para recargar' a media parada");
  else fail("sigue el rebote: " + rebote);

  // ── Las safe areas ──
  const tieneSafe = await page.evaluate(() => {
    const el = document.querySelector(".safe-bottom");
    if (!el) return null;
    return getComputedStyle(el).paddingBottom;
  });
  if (tieneSafe !== null) ok("los botones de abajo respetan la raya del home del iPhone");
  else fail("no hay safe-area abajo: los botones quedan tapados");

  const cuerpo = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/Parada 1 de 2/i.test(cuerpo)) ok("abre en modo conducción, en la parada 1 de 2");
  else fail("no abrió en conducción: " + cuerpo.slice(0, 200));

  // ── Pantalla completa: el cromo del panel no debe tapar los botones ──
  const cromo = await page.evaluate(() =>
    [...document.querySelectorAll("[data-chrome-panel]")]
      .filter((el) => getComputedStyle(el).display !== "none").length);
  if (cromo === 0) ok("en conducción desaparecen el encabezado y la barra del panel");
  else fail(`${cromo} pedazos del panel siguen encima`);

  // Los dos botones que más usa tienen que estar completos dentro de la pantalla
  const alcance = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")]
      .find((x) => /Entregado/i.test(x.textContent || ""));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { abajo: Math.round(r.bottom), alto: window.innerHeight, visible: r.bottom <= window.innerHeight };
  });
  if (alcance?.visible)
    ok(`el botón de Entregado cabe completo en la pantalla (termina en ${alcance.abajo} de ${alcance.alto})`);
  else
    fail("el botón de Entregado queda fuera: " + JSON.stringify(alcance));

  await page.screenshot({ path: "scripts/ruta-celular.png" });

  // ── Deslizar entre paradas ──
  const deslizo = await page.evaluate(() => {
    const el = document.querySelector("[data-parada]");
    if (!el) return false;
    const toque = (tipo, x) => {
      const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: 400 });
      el.dispatchEvent(new TouchEvent(tipo, {
        bubbles: true, touches: tipo === "touchend" ? [] : [t],
        changedTouches: [t], targetTouches: tipo === "touchend" ? [] : [t],
      }));
    };
    toque("touchstart", 320);
    toque("touchend", 120);
    return true;
  });
  if (!deslizo) fail("no se encontró la zona que responde al dedo");
  await page.waitForTimeout(900);
  const despues = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  if (/Parada 2 de 2/i.test(despues)) ok("y se desliza a la siguiente parada con el dedo");
  else fail("el gesto no cambió de parada: " + (despues.match(/Parada \d+ de \d+/i) || ["(nada)"])[0]);

  await page.screenshot({ path: "scripts/ruta-celular-2.png" });
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (ids.length) await db.query("DELETE FROM bookings WHERE id = ANY($1::uuid[])", [ids]);
    out.push("  --    paradas de prueba eliminadas");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
