// Lo que un teléfono sabe hacer y una página normalmente no usa. Vive aparte de la
// pantalla porque son tres cosas distintas que sí se pueden probar solas.

// ── Vibrar ────────────────────────────────────────────────────────────────────
// El repartidor marca una entrega de prisa, en la banqueta, a veces sin mirar. Un
// golpecito le dice que sí quedó, sin tener que esperar a que la pantalla cambie.
export function vibrar(patron = 15) {
  try {
    if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(patron);
  } catch {
    // iOS no lo soporta y algunos navegadores lo bloquean. No es motivo para romper nada.
  }
}

// ── Mantener la pantalla encendida ────────────────────────────────────────────
// Manejando, la pantalla se apagaba sola y había que desbloquear el teléfono en cada
// parada. El candado se suelta solo al salir de la pantalla, y hay que volver a pedirlo
// cuando el teléfono vuelve del bloqueo, porque el sistema lo suelta al minimizar.
export function mantenerPantallaEncendida() {
  if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
    return () => {};
  }

  let candado = null;
  let vivo = true;

  const pedir = async () => {
    if (!vivo || document.visibilityState !== "visible") return;
    try {
      candado = await navigator.wakeLock.request("screen");
      candado.addEventListener?.("release", () => { candado = null; });
    } catch {
      // Se niega con la batería baja, entre otras. Se intenta otra vez al volver.
    }
  };

  const alVolver = () => { if (document.visibilityState === "visible") pedir(); };
  document.addEventListener("visibilitychange", alVolver);
  pedir();

  return () => {
    vivo = false;
    document.removeEventListener("visibilitychange", alVolver);
    try { candado?.release(); } catch {}
    candado = null;
  };
}

// ── Cola de entregas marcadas sin señal ───────────────────────────────────────
//
// Había zonas donde marcar una entrega fallaba y el sistema solo decía "sin conexión,
// intenta de nuevo". El repartidor seguía su ruta y esa entrega se perdía, porque
// nadie se acuerda tres paradas después.
//
// Ahora lo que no se pudo mandar se guarda en el teléfono y se reintenta solo: al
// volver la señal, al regresar a la pantalla, y al abrirla de nuevo. La marca queda
// pintada desde el momento en que la picó, aunque el servidor todavía no se entere.

const LLAVE = "rutaPendientesDeEnviar";

const leer = () => {
  try { return JSON.parse(localStorage.getItem(LLAVE) || "[]"); } catch { return []; }
};
const guardar = (lista) => {
  try { localStorage.setItem(LLAVE, JSON.stringify(lista)); } catch {}
};

export function encolar(envio) {
  const lista = leer();
  // Una parada solo puede tener un estado pendiente: si la marcó y se arrepintió, vale
  // el último. Mandar los dos haría que el servidor terminara con el estado viejo.
  const sinEsa = lista.filter((x) => x.id !== envio.id);
  sinEsa.push({ ...envio, encoladoEn: Date.now() });
  guardar(sinEsa);
  return sinEsa.length;
}

export function cuantasEsperan() {
  return leer().length;
}

// Reintenta todo lo encolado. Devuelve cuántas salieron y cuántas siguen esperando.
export async function vaciarCola(mandar) {
  const lista = leer();
  if (lista.length === 0) return { enviadas: 0, pendientes: 0 };

  const quedan = [];
  let enviadas = 0;
  for (const envio of lista) {
    try {
      const ok = await mandar(envio);
      if (ok) enviadas++;
      else quedan.push(envio);
    } catch {
      // Sigue sin haber señal: se queda y se intenta en la próxima.
      quedan.push(envio);
    }
  }
  guardar(quedan);
  return { enviadas, pendientes: quedan.length };
}

export function limpiarCola() {
  guardar([]);
}
