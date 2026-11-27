import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";
import { coordsDelLink, esDeLaLaguna } from "../lib/ruta/coordenadas.js";

// El repartidor avisó que el mapa de la ruta no se podía mover ni acercar. Era una FOTO
// —un <img> con maps/api/staticmap— y además se armaba con el TEXTO de cada dirección,
// así que Google adivinaba dónde poner los pines: el 26 de noviembre la ruta salió a
// escala de todo el país, de Los Ángeles a Cuba, con dos pines encimados.
//
// Esta prueba cuida las dos cosas: que el mapa sea un mapa de verdad, y que las paradas
// caigan en La Laguna y queden guardadas para no volver a adivinar.
//
// Las entregas de prueba se agendan a 400 días: una prueba anterior usó la fecha de hoy
// y le movió la ruta a la repartidora que estaba trabajando.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const ETIQUETA = "PRUEBA_MAPA";
const FECHA = isoDePrueba();

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

// Pines reales de Google Maps, en Torreón y Gómez Palacio.
const PARADAS = [
  { quien: "unollena", url: "https://www.google.com/maps/place/Del+Ficus+312,+Miravalle,+35015+G%C3%B3mez+Palacio,+Dgo./@25.6055278,-103.4925847,16z/data=!4m6!3m5!1s0x868fd77eb16ee7e1:0xae30eaaf6356cc56!8m2!3d25.6055278!4d-103.4925847", esperado: { lat: 25.6055278, lng: -103.4925847 } },
  { quien: "dosllena", url: "https://www.google.com/maps/@25.5389,-103.4498,17z/data=!3m1!4b1!4m2!3m1!1s0x0:0x0!8m2!3d25.5389!4d-103.4498", esperado: { lat: 25.5389, lng: -103.4498 } },
  // Sin pin: tiene que resolverse por el texto de la dirección, acotado a La Laguna.
  { quien: "sinpin", url: null, esperado: null },
];

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch({ args: ["--host-resolver-rules=MAP localhost 127.0.0.1"] });
const bookings = [];

try {
  await db.connect();

  // ── 1. Lo puro, sin red: sacarle las coordenadas a un link ──────────────────
  // El `!3d!4d` es el lugar; el `@` es nada más el centro de la vista, que viene
  // corrido. Si se prefiere el `@`, el pin cae a una cuadra de la casa.
  const conLosDos = "https://www.google.com/maps/place/X/@25.1111,-103.1111,16z/data=!3d25.6055278!4d-103.4925847";
  const c = coordsDelLink(conLosDos);
  if (c && Math.abs(c.lat - 25.6055278) < 1e-6) ok("de un link con los dos formatos, se queda con el del LUGAR, no con el del encuadre");
  else fail("tomó el centro de la vista en vez del lugar: " + JSON.stringify(c));

  if (coordsDelLink("https://maps.app.goo.gl/abc123") === null) ok("un link corto sin coordenadas no inventa ninguna");
  else fail("se sacó coordenadas de un link que no las trae");

  // El centroide del país es lo que contesta Google cuando no entiende la dirección.
  // Es exactamente el punto que abría el mapa hasta Los Ángeles.
  if (!esDeLaLaguna(23.6345, -102.5528)) ok("el centro del país se rechaza: es la respuesta de relleno de Google");
  else fail("el centro del país pasó como si fuera una dirección de La Laguna");
  if (esDeLaLaguna(25.5464, -103.4497)) ok("la bodega sí pasa");
  else fail("la bodega quedó fuera de la caja de La Laguna");

  // ── 2. Entregas de prueba, a 400 días ───────────────────────────────────────
  for (const p of PARADAS) {
    const b = await db.query(
      `INSERT INTO bookings (type,date,instagram,"fullName",phone,address,city,status,
                             delivery_status,products,amount_due,location_url,override)
       VALUES ('domicilio',$1,$2,$3,'8711234567',$4,'Torreón','confirmed','pendiente',$5,0,$6,true)
       RETURNING id, lat, lng`,
      [FECHA, `@${ETIQUETA}_${p.quien}`, `${ETIQUETA} ${p.quien}`,
       "Calle: Avenida Juárez, Num: 1200, Col: Centro", "1x " + ETIQUETA, p.url]);
    bookings.push(b.rows[0].id);
    p.id = b.rows[0].id;
    if (b.rows[0].lat !== null) fail("la entrega nació con coordenadas, no debería");
  }
  ok(`3 entregas de prueba creadas para el ${FECHA}, lejos de cualquier ruta real`);

  // ── 3. El servidor las ubica y las GUARDA ───────────────────────────────────
  const res = await fetch(`${BASE}/api/panel/ruta`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("worker", "Gaby") },
    body: JSON.stringify({ ids: bookings }),
  });
  if (!res.ok) throw new Error("no se pudieron ubicar las paradas: " + (await res.text()).slice(0, 200));
  const { ubicaciones } = await res.json();

  for (const p of PARADAS.filter((x) => x.esperado)) {
    const u = ubicaciones.find((x) => x.id === p.id);
    if (u && Math.abs(u.lat - p.esperado.lat) < 1e-4 && Math.abs(u.lng - p.esperado.lng) < 1e-4)
      ok(`${p.quien}: el pin de la clienta se leyó exacto (${u.lat}, ${u.lng}) y vino de "${u.fuente}"`);
    else
      fail(`${p.quien}: se esperaba ${JSON.stringify(p.esperado)} y llegó ${JSON.stringify(u)}`);
  }

  const todas = ubicaciones.filter((u) => u.lat != null);
  if (todas.length === 3) ok("las 3 paradas quedaron ubicadas, incluso la que no traía pin");
  else fail("quedaron sin ubicar " + (3 - todas.length) + " paradas: " + JSON.stringify(ubicaciones));
  if (todas.every((u) => esDeLaLaguna(u.lat, u.lng))) ok("y las 3 caen dentro de La Laguna, no en el centro del país");
  else fail("alguna parada cayó fuera de La Laguna: " + JSON.stringify(todas));

  const guardadas = await db.query("select id, lat, lng from bookings where id = ANY($1::uuid[])", [bookings]);
  if (guardadas.rows.every((r) => r.lat !== null && r.lng !== null))
    ok("quedaron GUARDADAS en la entrega: la próxima ruta ya no le pregunta nada a Google");
  else
    fail("no se guardaron: " + JSON.stringify(guardadas.rows));

  // Pedirlas otra vez no debe volver a salir a internet: ya están guardadas.
  const res2 = await fetch(`${BASE}/api/panel/ruta`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenDePrueba("worker", "Gaby") },
    body: JSON.stringify({ ids: bookings }),
  });
  const { ubicaciones: otraVez } = await res2.json();
  if (otraVez.every((u) => u.fuente === "guardada")) ok("y al volver a pedirlas, las 3 salen de lo guardado");
  else fail("volvió a preguntarle a Google: " + JSON.stringify(otraVez.map((u) => u.fuente)));

  // ── 4. La pantalla del repartidor ───────────────────────────────────────────
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, // un celular, que es donde esto vive
    isMobile: true, hasTouch: true,
  });
  // La pantalla arma su día con el reloj del celular, no con la fecha del enlace: sin
  // esto la prueba abre la ruta REAL de hoy y le escribe encima al repartidor. Se le
  // adelanta el reloj al navegador para que vea las entregas de prueba y solo esas.
  // `install` sola CONGELA los relojes, y Google Maps los usa para dibujarse: el mapa
  // monta pero sin controles. `resume` deja la fecha adelantada y vuelve a dejar correr
  // el tiempo, que es lo que hace falta.
  await ctx.clock.install({ time: new Date(`${FECHA}T10:00:00`) });
  await ctx.clock.resume();
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "worker");
    localStorage.setItem("staffName", "Gaby");
    localStorage.removeItem("rutaOrder");
    localStorage.removeItem("rutaMapUrl");
  }, tokenDePrueba("worker", "Gaby"));
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", (e) => errores.push(e.message));

  await page.goto(`${BASE}/panel/entregas/ruta?fecha=${FECHA}`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(9000);

  const cuerpo = await page.locator("body").innerText();
  if (/Vista de la Ruta/i.test(cuerpo)) ok("la pantalla de ruta abre y enseña el mapa");
  else fail("no apareció el mapa en la pantalla: " + cuerpo.slice(0, 300));

  // Lo que pidió el repartidor: que se pueda mover y acercar. Un mapa de Google vivo
  // deja su marca `.gm-style` en el DOM; una foto nunca lo hace.
  const vivo = await page.locator(".gm-style").count();
  if (vivo > 0) ok("ES UN MAPA DE VERDAD: Google lo montó en la pantalla (.gm-style)");
  else fail("no se montó un mapa interactivo; sigue siendo una imagen");

  const fotos = await page.locator('img[src*="staticmap"]').count();
  if (fotos === 0) ok("y ya no hay ninguna foto de staticmap en pantalla");
  else fail("sigue habiendo " + fotos + " imagen(es) fija(s) de staticmap");

  // Lo que pidió el repartidor, probado como él lo hace: con el dedo sobre el mapa.
  // No se prueban los botones de Google —en un celular los esconde él solito— sino los
  // gestos, que es lo que de verdad usa en la calle.
  const zoomDe = () => page.evaluate(() => window.__mapaRuta?.getZoom?.() ?? null);
  const centroDe = () => page.evaluate(() => {
    const c = window.__mapaRuta?.getCenter?.();
    return c ? { lat: c.lat(), lng: c.lng() } : null;
  });

  const caja = await page.locator(".gm-style").first().boundingBox();
  const cx = caja.x + caja.width / 2, cy = caja.y + caja.height / 2;

  const zAntes = await zoomDe();
  if (zAntes == null) {
    fail("el mapa no quedó accesible para medir el acercamiento");
  } else {
    await page.mouse.dblclick(cx, cy);
    await page.waitForTimeout(2000);
    const zDespues = await zoomDe();
    if (zDespues > zAntes) ok(`SE PUEDE ACERCAR: con doble toque pasó de ${zAntes} a ${zDespues}`);
    else fail(`el mapa no se acercó con doble toque: siguió en ${zDespues}`);

    const centroAntes = await centroDe();
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 110, cy - 70, { steps: 14 });
    await page.mouse.up();
    await page.waitForTimeout(2000);
    const centroDespues = await centroDe();
    const movido = centroAntes && centroDespues &&
      (Math.abs(centroAntes.lat - centroDespues.lat) > 1e-5 || Math.abs(centroAntes.lng - centroDespues.lng) > 1e-5);
    if (movido) ok("SE PUEDE MOVER: arrastrar cambió el centro del mapa");
    else fail("arrastrar no movió el mapa");

    // Y que los controles de Google estén montados, aunque el celular los esconda.
    const controles = await page.evaluate(() => document.querySelectorAll(".gm-control-active, .gmnoprint").length);
    if (controles > 0) ok(`trae los controles de Google montados (${controles})`);
    else fail("el mapa no montó ningún control");
  }

  // El encuadre tiene que ser de ciudad, no de país: eso fue lo que falló el 26.
  // A escala continental el mapa abarca grados enteros; una ciudad, centésimas.
  const ancho = await page.evaluate(() => {
    const b = window.__mapaRuta?.getBounds?.();
    if (!b) return null;
    return Math.abs(b.getNorthEast().lng() - b.getSouthWest().lng());
  });
  if (ancho == null) fail("no se pudo leer el encuadre del mapa");
  else if (ancho < 1.5) ok(`encuadra La Laguna y no el país (abarca ${ancho.toFixed(3)}° de ancho)`);
  else fail(`el mapa volvió a abrirse a escala de país: abarca ${ancho.toFixed(2)}° de ancho`);

  if (errores.length === 0) ok("ningún error de JavaScript tumbó la pantalla");
  else fail("errores en la pantalla: " + errores.join(" | "));

  await page.screenshot({ path: "scripts/mapa-de-la-ruta.png", fullPage: false });
  out.push("  --    foto de la pantalla en scripts/mapa-de-la-ruta.png");
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (bookings.length) await db.query("DELETE FROM bookings WHERE id = ANY($1::uuid[])", [bookings]);
    out.push("  --    entregas de prueba eliminadas");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await db.end();
}
