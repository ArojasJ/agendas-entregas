// Cargar Google Maps UNA vez por pantalla.
//
// La pantalla de ruta ya traía su propio cargador para el buscador de direcciones, con
// un callback global. Ahora el mapa también lo necesita, y dos cargadores sobre el mismo
// <script> se pisan: el segundo ve la etiqueta ya puesta, se cree cargado y usa
// `window.google` antes de que exista. Esto lo deja en una sola promesa que los dos
// esperan, tantas veces como quieran.

let promesa = null;

export function cargarGoogleMaps(apiKey) {
  if (typeof window === "undefined") return Promise.reject(new Error("sin navegador"));
  if (window.google?.maps?.places?.Autocomplete) return Promise.resolve(window.google.maps);
  if (!apiKey) return Promise.reject(new Error("falta la llave de Google Maps"));
  if (promesa) return promesa;

  promesa = new Promise((listo, falla) => {
    const cbName = "__rutaGMapsReady";
    const anterior = window[cbName];
    window[cbName] = () => {
      // Respetar al que ya estuviera esperando: el buscador de direcciones monta por aquí.
      if (typeof anterior === "function") { try { anterior(); } catch {} }
      listo(window.google.maps);
    };

    let s = document.getElementById("gm-ruta-script");
    if (!s) {
      s = document.createElement("script");
      s.id = "gm-ruta-script";
      s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=es&region=MX&callback=${cbName}`;
      s.async = true;
      document.head.appendChild(s);
    }
    // Sin señal en la calle el script nunca llega y la promesa se quedaría colgada,
    // dejando el mapa en "Cargando…" para siempre. Mejor fallar y enseñar el respaldo.
    s.addEventListener("error", () => { promesa = null; falla(new Error("no cargó Google Maps")); });
    setTimeout(() => falla(new Error("Google Maps tardó demasiado")), 15000);
  });

  return promesa;
}
