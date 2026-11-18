import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { isoDePrueba } from "./fechaDePrueba.mjs";

// La pantalla de ruta es la que usa el repartidor en la calle, con datos móviles y
// con una mano. Esto comprueba las dos cosas que la hacían sentirse una página web y
// no una app: que bajaba 3 MB para enseñar siete paradas, y que una entrega marcada
// sin señal se perdía.

const BASE = process.env.BASE_URL || "http://localhost:3000";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const token = tokenDePrueba("worker", "Repartidor");
const kb = (t) => new TextEncoder().encode(t).length / 1024;

let bookingIds = [];

try {
  await db.connect();

  // Tres paradas en la fecha de prueba, más una de bodega que NO debe venir
  const fecha = isoDePrueba();
  for (const [tipo, quien] of [["domicilio", "uno"], ["domicilio", "dos"], ["parada_paqueteria", "tres"], ["bodega", "cuatro"]]) {
    const r = await db.query(
      `INSERT INTO bookings (type,date,instagram,"fullName",phone,status,delivery_status,products,amount_due,address,city)
       VALUES ($1,$2,$3,'PRUEBA_RUTA','8710001234','confirmed','pendiente','algo',45,'Calle: X, Num: #1, Col: Centro','Torreón')
       RETURNING id`, [tipo, fecha, "@prueba_ruta_" + quien]);
    bookingIds.push(r.rows[0].id);
  }
  ok("cuatro entregas en la fecha de prueba: tres de ruta y una de bodega");

  // ── 1. El peso ──
  const t0 = Date.now();
  const rNueva = await fetch(`${BASE}/api/panel/ruta?fecha=${fecha}`, { headers: { "x-panel-token": token } });
  const textoNueva = await rNueva.text();
  const msNueva = Date.now() - t0;
  if (!rNueva.ok) throw new Error("la ruta respondió " + rNueva.status + ": " + textoNueva.slice(0, 150));
  const pesoNueva = kb(textoNueva);

  const t1 = Date.now();
  const rVieja = await fetch(`${BASE}/api/bookings`, { headers: { "x-panel-token": token } });
  const textoVieja = await rVieja.text();
  const msVieja = Date.now() - t1;
  const pesoVieja = kb(textoVieja);

  out.push(`  --    antes: ${pesoVieja.toFixed(0)} KB en ${msVieja} ms   ahora: ${pesoNueva.toFixed(1)} KB en ${msNueva} ms`);

  if (pesoNueva < pesoVieja / 50)
    ok(`la ruta pesa ${(pesoVieja / pesoNueva).toFixed(0)} veces menos que antes`);
  else
    fail(`sigue pesando parecido: ${pesoNueva.toFixed(0)} KB contra ${pesoVieja.toFixed(0)} KB`);

  // ── 2. Trae lo correcto ──
  const { paradas } = JSON.parse(textoNueva);
  if (paradas.length === 3) ok("trae las 3 paradas del día y nada más");
  else fail("trajo " + paradas.length + " paradas");

  if (!paradas.some((p) => p.type === "bodega"))
    ok("y no mete las recolecciones de bodega, que no van en la ruta");
  else
    fail("metió una de bodega");

  const campos = Object.keys(paradas[0] || {});
  for (const necesario of ["id", "instagram", "fullName", "phone", "address", "city", "products", "amount_due", "location_url", "delivery_status"]) {
    if (!campos.includes(necesario)) { fail("falta el campo " + necesario); break; }
  }
  ok("con todos los campos que la pantalla pinta: " + campos.length + " columnas");

  if (!campos.includes("tenant_slug") && !campos.includes("override"))
    ok("y sin columnas que nadie usa: se piden por nombre, no con select(*)");
  else
    fail("sigue trayendo columnas de más");

  // Otro día no debe traer nada
  const otroDia = await fetch(`${BASE}/api/panel/ruta?fecha=2019-01-01`, { headers: { "x-panel-token": token } });
  const d2 = await otroDia.json();
  if ((d2.paradas || []).length === 0) ok("un día sin ruta no trae nada");
  else fail("trajo paradas de otro día");

  // Sin fecha no adivina
  const sinFecha = await fetch(`${BASE}/api/panel/ruta`, { headers: { "x-panel-token": token } });
  if (sinFecha.status === 400) ok("sin fecha no adivina: el día lo manda el teléfono, no el servidor");
  else fail("respondió " + sinFecha.status + " sin fecha");

  // Sin sesión no se asoma
  const sinToken = await fetch(`${BASE}/api/panel/ruta?fecha=${fecha}`);
  if (sinToken.status === 401) ok("y sin sesión no entrega nada");
  else fail("dejó entrar sin token: " + sinToken.status);

  // ── 3. La cola de lo que no se pudo mandar ──
  // Se prueba la lógica sola, sin navegador: es donde vive el riesgo de perder trabajo.
  globalThis.localStorage = {
    _d: {},
    getItem(k) { return this._d[k] ?? null; },
    setItem(k, v) { this._d[k] = String(v); },
    removeItem(k) { delete this._d[k]; },
  };
  const { encolar, cuantasEsperan, vaciarCola, limpiarCola } = await import("../lib/ruta/telefono.js");

  limpiarCola();
  encolar({ id: "a", deliveryStatus: "entregado" });
  encolar({ id: "b", deliveryStatus: "no_entregado" });
  if (cuantasEsperan() === 2) ok("lo que se marca sin señal se guarda en el teléfono");
  else fail("no se guardó: " + cuantasEsperan());

  encolar({ id: "a", deliveryStatus: "no_entregado" });
  if (cuantasEsperan() === 2) ok("y si se corrige una parada vale la última, no se mandan las dos");
  else fail("se duplicó la parada: " + cuantasEsperan());

  // Sigue sin señal: nada se pierde
  let intentos = 0;
  let r = await vaciarCola(async () => { intentos++; throw new Error("sin señal"); });
  if (r.pendientes === 2 && r.enviadas === 0) ok("si sigue sin señal, nada se pierde: se quedan esperando");
  else fail("se perdieron: " + JSON.stringify(r));

  // Vuelve la señal, pero solo una pasa
  r = await vaciarCola(async (e) => e.id === "a");
  if (r.enviadas === 1 && r.pendientes === 1)
    ok("al volver la señal se mandan solas, y la que falle se queda para el próximo intento");
  else
    fail("no vació bien: " + JSON.stringify(r));

  r = await vaciarCola(async () => true);
  if (r.pendientes === 0 && cuantasEsperan() === 0) ok("y cuando todas salen, la cola queda vacía");
  else fail("quedó algo: " + JSON.stringify(r));

  // ── 4. El manifest, que es lo que la hace instalable ──
  const man = await fetch(`${BASE}/manifest.webmanifest`);
  if (man.ok) {
    const m = await man.json();
    if (m.display === "standalone") ok("el manifest la declara standalone: se abre sin barra del navegador");
    else fail("no es standalone: " + m.display);
    if ((m.icons || []).some((i) => i.sizes === "512x512") && (m.icons || []).some((i) => i.sizes === "192x192"))
      ok("con los iconos de 192 y 512 que Android pide para instalarla");
    else
      fail("faltan iconos: " + JSON.stringify(m.icons));
    if ((m.icons || []).some((i) => i.purpose === "maskable"))
      ok("y uno maskable, para que Android no le dibuje un recuadro blanco alrededor");
    else
      fail("falta el icono maskable");
    // start_url se queda en /panel a propósito: iOS relanza el PWA en frío desde ahí
    // al volver de Google Maps, y la app la usan todos, no solo el repartidor. Él llega
    // a su ruta por el atajo del icono.
    if (m.start_url === "/panel") ok("abre en el panel, no en la página pública");
    else fail("abre en " + m.start_url);
    if ((m.shortcuts || []).some((a) => a.url === "/panel/entregas/ruta"))
      ok("y el repartidor llega a su ruta dejando apretado el icono");
    else
      fail("falta el atajo a la ruta");
  } else {
    fail("no hay manifest: " + man.status);
  }

  for (const ruta of ["/icono-192.png", "/icono-512.png"]) {
    const i = await fetch(`${BASE}${ruta}`);
    if (!i.ok) { fail("falta " + ruta); break; }
  }
  ok("los dos iconos existen de verdad");
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (bookingIds.length) await db.query("DELETE FROM bookings WHERE id = ANY($1::uuid[])", [bookingIds]);
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await db.end();
}
