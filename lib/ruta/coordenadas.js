// Dónde queda cada parada, de verdad.
//
// Esto ya existía a medias dentro de /api/optimize-route: seguía el link del pin que
// manda la clienta, le sacaba las coordenadas, armaba la ruta... y las tiraba. El mapa
// de la ruta, mientras tanto, le mandaba a Google el TEXTO de la dirección —"Cto bosque
// de leopardo, Parajes del bosque 1, Torreón"— y Google adivinaba. Cuando no le entendía
// aterrizaba en el centro del país, y el mapa del repartidor salía a escala continental
// con los pines encimados.
//
// Las columnas `bookings.lat` y `bookings.lng` existen desde siempre y estaban vacías en
// las 318 entregas desde octubre. `geoAddress()` en lib/address.js YA las prefiere si
// están. Nadie conectó las dos cosas. Esto las conecta: se resuelve una vez, se guarda,
// y de ahí en adelante el mapa es instantáneo y no hay nada que adivinar.

// La Comarca Lagunera, con holgura. Sirve para cachar la respuesta de relleno de Google:
// cuando no entiende una dirección contesta el centroide del país (23.63, -102.55), y ese
// solo punto basta para que el mapa se abra hasta Los Ángeles.
const CAJA = { norte: 26.4, sur: 24.6, este: -102.6, oeste: -104.4 };

export function esDeLaLaguna(lat, lng) {
  return lat <= CAJA.norte && lat >= CAJA.sur && lng <= CAJA.este && lng >= CAJA.oeste;
}

// Un link de Maps trae las coordenadas de dos formas. `!3d...!4d...` es el lugar mismo;
// `@...` es nada más el centro de la vista, que puede venir corrido. Se prefiere el primero.
export function coordsDelLink(url) {
  if (!url) return null;
  const patrones = [
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
    /[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
    /[?&]destination=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
    /@(-?\d+\.\d+),(-?\d+\.\d+)/,
  ];
  for (const p of patrones) {
    const m = url.match(p);
    if (m) {
      const lat = Number(m[1]), lng = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
  }
  return null;
}

// Los links que manda la clienta casi siempre son cortos (maps.app.goo.gl/xxxx): hay que
// seguir el brinco para ver la dirección larga, que sí trae las coordenadas. Se le pone
// tiempo límite porque esto corre con el repartidor esperando en la pantalla.
async function seguirElLink(url, ms = 6000) {
  const corta = AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
  try {
    const r = await fetch(url, { redirect: "follow", signal: corta });
    return coordsDelLink(r.url) || coordsDelLink(await r.text().catch(() => ""));
  } catch {
    return null;
  }
}

// Sin pin solo queda preguntarle a Google por el texto, pero acotado a La Laguna: sin el
// `bounds` manda a la clienta de la calle Madero a cualquiera de las doscientas Maderos
// que hay en el país.
async function preguntarPorElTexto(texto, apiKey, ms = 6000) {
  if (!texto || !apiKey) return null;
  const url =
    "https://maps.googleapis.com/maps/api/geocode/json" +
    `?address=${encodeURIComponent(texto)}` +
    `&bounds=${CAJA.sur},${CAJA.oeste}|${CAJA.norte},${CAJA.este}` +
    "&components=country:MX&language=es" +
    `&key=${apiKey}`;
  const corta = AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined;
  try {
    const r = await fetch(url, { signal: corta });
    const data = await r.json();
    if (data.status !== "OK" || !data.results?.length) return null;
    const p = data.results[0].geometry?.location;
    if (!p) return null;
    // Aquí es donde se cacha el centroide del país: fuera de la caja, no sirve.
    if (!esDeLaLaguna(p.lat, p.lng)) return null;
    return { lat: p.lat, lng: p.lng };
  } catch {
    return null;
  }
}

// Una parada. Devuelve de dónde salió el dato para poder decirlo en pantalla y para
// saber qué tan confiable es: el pin de la clienta le gana siempre al texto.
export async function ubicarParada(bk, apiKey) {
  if (bk.lat != null && bk.lng != null) {
    return { id: bk.id, lat: Number(bk.lat), lng: Number(bk.lng), fuente: "guardada", nueva: false };
  }

  const directo = coordsDelLink(bk.location_url);
  if (directo) return { id: bk.id, ...directo, fuente: "pin", nueva: true };

  if (bk.location_url) {
    const seguido = await seguirElLink(bk.location_url);
    if (seguido) return { id: bk.id, ...seguido, fuente: "pin", nueva: true };
  }

  const porTexto = await preguntarPorElTexto(bk.addressText, apiKey);
  if (porTexto) return { id: bk.id, ...porTexto, fuente: "direccion", nueva: true };

  return { id: bk.id, lat: null, lng: null, fuente: "ninguna", nueva: false };
}

export async function ubicarParadas(bookings, apiKey) {
  return Promise.all(bookings.map((bk) => ubicarParada(bk, apiKey)));
}
