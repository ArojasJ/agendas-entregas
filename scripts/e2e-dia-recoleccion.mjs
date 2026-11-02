import { chromium } from "playwright";
import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";
import { primeraFechaFloreria, fechasFloreria } from "../lib/constants.js";

// El mensaje de la florería decía "puedes pasar a recoger tus productos" sin fecha, y
// la clienta lo leía como "pasa cuando quieras". Aquí se comprueba que el mensaje que
// se copia trae el día que ella eligió al agendar, no uno calculado ni ninguno.

const BASE = process.env.BASE_URL || "http://localhost:3000";
const IG = "@pruebadiafloreria";

const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
               "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

// El mensaje largo tal como lo manda la tienda hoy. Si alguna de estas frases
// desaparece, el mensaje se acortó y la prueba truena: lo único que se le agrega es
// el día de recolección, nada se quita.
const PARRAFOS_ORIGINALES = [
  "Hola, sólo para confirmar lo que se te entregará:",
  "puedes realizar transferencia (antes de pasar) o pagar en efectivo al recoger 🖤",
  // El día se mete en medio de esta frase, así que se revisa en dos mitades
  "Puedes pasar a recoger tus productos a nuestra florería en Gómez Palacio ",
  "de 9:00am - 5:00pm✨",
  "📍 Ignacio Ramírez 447, Zona Centro, Supermanzana COL, CENTRO, 35000 Gómez Palacio, Dgo.",
  "Tu paquete te espera únicamente el día que agendaste. Pasada esa fecha no podemos hacernos responsables de su resguardo, así que te pedimos considerarlo al elegir tu día 🖤",
  "Recuerda revisar tus productos al recibirlos ya que una vez entregados no hay cambios ni devoluciones 🖤",
  "Es correcto?✨",
];

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const textoDia = (d) => `${DIAS_SEMANA[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;

const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const browser = await chromium.launch();
const creadas = [];

try {
  await c.connect();

  // Dos reservas: la fecha más próxima que ofrece el calendario y una más lejana.
  // La lejana es la que importa: si el mensaje calculara "2 días hábiles" en lugar de
  // leer la fecha elegida, ahí es donde mentiría.
  const opciones = fechasFloreria(6);
  const pronto = opciones[0];
  const lejana = opciones[4];

  if (iso(primeraFechaFloreria()) === iso(pronto))
    ok(`la primera fecha que ofrece el calendario es ${textoDia(pronto)}`);
  else
    fail(`primeraFechaFloreria y fechasFloreria no coinciden`);

  for (const [etiqueta, fecha] of [["pronto", pronto], ["lejana", lejana]]) {
    const r = await c.query(
      `INSERT INTO bookings (type, date, instagram, "fullName", phone, override,
                             "createdAt", products, amount_due, delivery_status,
                             payment_method, tenant_slug)
       VALUES ('floreria', $1, $2, $3, '8711234567', false, now(), $4, 0,
               'pendiente', 'efectivo', 'noreste') RETURNING id`,
      [iso(fecha), IG, `Prueba Dia ${etiqueta}`, `1xPRODUCTO DE PRUEBA ${etiqueta.toUpperCase()}`]
    );
    creadas.push(r.rows[0].id);
  }
  ok(`creadas 2 reservas de florería: ${textoDia(pronto)} y ${textoDia(lejana)}`);

  const ctx = await browser.newContext({
    viewport: { width: 1400, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Prueba Admin");
  }, tokenDePrueba("admin", "Prueba Admin"));

  await page.goto(`${BASE}/panel/entregas`, { waitUntil: "networkidle", timeout: 90000 });

  // La sesión se firma sola, pero el panel pinta el menú antes de validarla: sin esperar
  // el título se le pican las pestañas a la pantalla de contraseña y no pasa nada.
  await page.getByText("Panel de entregas").first().waitFor({ state: "visible", timeout: 60000 });
  ok("la sesión de administrador entra al panel de entregas");

  // Exacto a propósito: hay otro botón "🌷 Florería: Activa" que es el interruptor
  const pestana = page.getByRole("button", { name: "🌷 Florería", exact: true });
  await pestana.waitFor({ state: "visible", timeout: 30000 });
  await pestana.click();
  await page.waitForTimeout(500);
  ok("la pestaña Florería abre en el panel");

  await page.getByPlaceholder("@usuario").fill(IG);
  await page.waitForTimeout(800);

  for (const [etiqueta, fecha] of [["pronto", pronto], ["lejana", lejana]]) {
    // La tarjeta es el div más interno que trae a la vez el nombre y el botón de copiar:
    // con solo el nombre, .last() cae en el <div> del texto, que no tiene botones.
    const tarjeta = page
      .locator("div")
      .filter({ hasText: `Prueba Dia ${etiqueta}` })
      .filter({ has: page.getByRole("button", { name: /Copiar/i }) })
      .last();
    try {
      await tarjeta.waitFor({ state: "visible", timeout: 15000 });
    } catch {
      fail(`no apareció la reserva "${etiqueta}" en la lista`);
      continue;
    }

    const copiar = tarjeta.getByRole("button", { name: /Copiar/i }).first();
    await copiar.click();
    await page.waitForTimeout(400);
    // El portapapeles de Windows devuelve \r\n: sin normalizar, contar párrafos por
    // "\n\n" da un solo bloque y la prueba acusa un recorte que no existe.
    const texto = (await page.evaluate(() => navigator.clipboard.readText()) || "")
      .replace(/\r\n/g, "\n");

    const esperado = `el ${textoDia(fecha)}`;
    if (texto.includes(esperado))
      ok(`la reserva "${etiqueta}" copia el día correcto: "${esperado}"`);
    else
      fail(`la reserva "${etiqueta}" debía decir "${esperado}" y copió:\n${texto}`);

    // El día de la OTRA reserva no debe aparecer: sería la fecha equivocada
    const otra = etiqueta === "pronto" ? lejana : pronto;
    if (!texto.includes(`el ${textoDia(otra)}`))
      ok(`la reserva "${etiqueta}" no se confunde con la otra fecha`);
    else
      fail(`la reserva "${etiqueta}" trae también el día de la otra reserva`);

    if (/9:00am - 5:00pm/.test(texto)) ok(`la reserva "${etiqueta}" conserva el horario`);
    else fail(`la reserva "${etiqueta}" perdió el horario: ${texto}`);

    if (/Ignacio Ramírez 447/.test(texto)) ok(`la reserva "${etiqueta}" conserva la dirección`);
    else fail(`la reserva "${etiqueta}" perdió la dirección`);

    // Lo único que cambia es la línea de la recolección. Todo lo demás queda palabra
    // por palabra como estaba: el mensaje es el largo, no una versión recortada.
    const faltantes = PARRAFOS_ORIGINALES.filter((p) => !texto.includes(p));
    if (faltantes.length === 0)
      ok(`la reserva "${etiqueta}" conserva los ${PARRAFOS_ORIGINALES.length} párrafos del mensaje largo`);
    else
      fail(`la reserva "${etiqueta}" perdió ${faltantes.length} párrafo(s): ${JSON.stringify(faltantes)}`);

    const bloques = texto.split("\n\n").filter((b) => b.trim());
    if (bloques.length === 8)
      ok(`la reserva "${etiqueta}" tiene los 8 bloques de siempre, ni uno menos`);
    else
      fail(`la reserva "${etiqueta}" tiene ${bloques.length} bloques y debían ser 8`);

    if (etiqueta === "pronto") {
      out.push("\n  ── mensaje tal como se copia ──\n" + texto + "\n");
    }
  }

  // El botón de WhatsApp arma el mismo mensaje por su cuenta: antes se llamaba sin la
  // configuración de la florería y salía sin horario ni dirección. No es un enlace sino
  // un window.open, así que se intercepta en lugar de leer un href.
  await page.evaluate(() => {
    window.__waUrl = null;
    window.open = (url) => { window.__waUrl = url; return null; };
  });

  const tarjetaWa = page
    .locator("div")
    .filter({ hasText: "Prueba Dia pronto" })
    .filter({ has: page.getByRole("button", { name: /WhatsApp/i }) })
    .last();
  await tarjetaWa.getByRole("button", { name: /WhatsApp/i }).first().click();
  await page.waitForTimeout(300);
  const wa = decodeURIComponent(await page.evaluate(() => window.__waUrl) || "");

  if (!wa) {
    fail("el botón de WhatsApp no abrió ninguna URL");
  } else {
    if (wa.includes(`el ${textoDia(pronto)}`))
      ok(`el botón de WhatsApp también trae el día: "el ${textoDia(pronto)}"`);
    else fail(`el botón de WhatsApp no trae el día. URL: ${wa}`);

    if (wa.includes("9:00am - 5:00pm")) ok("el botón de WhatsApp trae el horario");
    else fail("el botón de WhatsApp sigue saliendo sin horario");

    if (wa.includes("Ignacio Ramírez 447")) ok("el botón de WhatsApp trae la dirección");
    else fail("el botón de WhatsApp sigue saliendo sin dirección");
  }

  // Una reserva sin fecha no puede reventar el panel ni inventar un día. La columna es
  // NOT NULL, así que esto se prueba sobre la función, no sobre la base.
  await page.screenshot({ path: "scripts/dia-recoleccion.png", fullPage: false });
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (creadas.length) {
      await c.query("DELETE FROM bookings WHERE id = ANY($1::uuid[])", [creadas]);
      out.push(`  --    ${creadas.length} reservas de prueba eliminadas`);
    }
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await browser.close();
  await c.end();
}
