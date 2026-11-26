import { chromium } from "playwright";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

// "Ver historial de cortes", en la caja de dinero de Entregas, tumbaba la pantalla
// entera: "This page couldn't load".
//
// El boton abre <CashboxHistoryModal>, y ese componente terminaba asi:
//
//     {cobrosPendientes.length > 0 && (
//       <CobroPendiente pendientes={cobrosPendientes} ... />
//     )}
//
// `cobrosPendientes` no existe ahi. Es un useState de la PANTALLA de Entregas, no del
// modal, y un componente no ve el estado de otro. Al abrirlo, JavaScript truena con
// "cobrosPendientes is not defined" y React tira la pagina completa.
//
// Debajo habia una segunda falla tapada por la primera: ese bloque es el que pregunta
// "se llevo todo y sigue debiendo, ¿ya te pago?". Al vivir dentro del modal del
// historial, la pregunta no podia salir nunca al marcar una entrega — y esa pregunta
// es justamente la regla de "entregar no es cobrar". Ahora vive en la pantalla.
//
// Esta prueba no escribe nada: solo abre y mira.

const BASE = process.env.BASE_URL || "http://localhost:3000";

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

// `localhost` puede resolverse a IPv6 (::1) y caer en otro servidor del equipo. Se
// fija a IPv4 sin cambiar el origen: entrar por 127.0.0.1 a pelo hace que Next
// bloquee sus recursos de desarrollo por venir de "otro origen", y la pantalla se
// queda sin hidratar, con la sesion sin cargar y pareciendo que pide contraseña.
const browser = await chromium.launch({
  args: ["--host-resolver-rules=MAP localhost 127.0.0.1"],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  await ctx.addInitScript((t) => {
    localStorage.setItem("panelToken", t);
    localStorage.setItem("panelAuth", "true");
    localStorage.setItem("panelRole", "admin");
    localStorage.setItem("staffName", "Antonio");
  }, tokenDePrueba("admin", "Antonio"));
  const page = await ctx.newPage();

  // Todo lo que truene en la pantalla se recoge aqui.
  const errores = [];
  page.on("pageerror", (e) => errores.push(String(e.message)));
  page.on("console", (m) => { if (m.type() === "error") errores.push(m.text()); });

  await page.goto(`${BASE}/panel/entregas`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(6000);

  const boton = page.getByRole("button", { name: /Ver historial de cortes/i }).first();
  if (await boton.count() === 0) {
    fail("no aparecio el boton 'Ver historial de cortes' (¿sesion de admin?)");
  } else {
    ok("la caja de dinero de Entregas ofrece 'Ver historial de cortes'");

    await boton.click();
    await page.waitForTimeout(4000);

    const t = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    await page.screenshot({ path: "scripts/historial-de-cortes.png" });

    if (/This page couldn|Application error|no se pudo cargar/i.test(t))
      fail("la pantalla se cayo al abrir el historial: " + t.slice(0, 160));
    else
      ok("la pantalla NO se cae al abrir el historial");

    const roto = errores.find((e) => /cobrosPendientes is not defined|cobrosPendientes/.test(e));
    if (roto) fail("sigue el error de siempre: " + roto.slice(0, 120));
    else ok("y no truena por 'cobrosPendientes is not defined'");

    if (/Historial de cortes/i.test(t))
      ok("se ve el panel con el titulo 'Historial de cortes'");
    else
      fail("no se dibujo el historial: " + t.slice(-200));

    if (/corte\(s\)|Aun no hay cortes|Aún no hay cortes|Cargando historial/i.test(t))
      ok("y lista los cortes (o dice que no hay ninguno)");
    else
      fail("no muestra ni los cortes ni el aviso de que no hay");

    // Cerrarlo y reabrirlo: si quedara algo roto a medias, aqui se nota.
    await page.getByRole("button", { name: "✖" }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
    await boton.click();
    await page.waitForTimeout(2500);
    if (/Historial de cortes/i.test((await page.locator("body").innerText())))
      ok("se puede cerrar y volver a abrir sin romperse");
    else
      fail("al reabrirlo ya no sale");
  }

  const otros = errores.filter((e) => !/favicon|DevTools|HMR|Download the React/i.test(e));
  if (otros.length === 0) ok("la pantalla de Entregas no reporto ningun error de JavaScript");
  else out.push("  --    avisos en consola: " + otros.slice(0, 3).join(" | ").slice(0, 300));
} catch (e) {
  fail(e.message);
} finally {
  console.log(out.join("\n"));
  await browser.close();
}
