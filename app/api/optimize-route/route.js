import { getPanelSession } from "@/lib/panelAuth";
import { ubicarParada } from "@/lib/ruta/coordenadas";

export async function POST(req) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado." }, { status: 401 });
  }

  try {
    const { locations, origin: customOrigin, destination: customDestination } = await req.json();
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      return Response.json({ message: "Google Maps API Key no configurada en el servidor." }, { status: 500 });
    }

    if (!locations || locations.length < 1) {
      return Response.json({ message: "Se necesitan ubicaciones para optimizar." }, { status: 400 });
    }

    // Dónde queda cada parada. Esto vivía aquí adentro y se tiraba al terminar: sacaba
    // las coordenadas del pin de la clienta, armaba el orden y las olvidaba, mientras
    // el mapa de la pantalla le mandaba a Google el texto de la dirección y Google
    // adivinaba. Ahora lo resuelve lib/ruta/coordenadas.js, que es el mismo que usa el
    // mapa, y además las guarda. Aquí se devuelven junto con el orden.
    const ubicadas = await Promise.all(locations.map((l) =>
      ubicarParada({ id: l.id, location_url: l.url, addressText: l.addressText }, apiKey)
    ));

    const resolvedLocations = ubicadas.map((u, i) => ({
      id: u.id,
      // Con coordenadas, Google no tiene nada que interpretar. Sin ellas queda el texto.
      address: u.lat != null ? `${u.lat},${u.lng}` : locations[i].addressText,
    }));

    const origin = customOrigin || resolvedLocations[0].address;
    const destination = customDestination || origin;
    const waypoints = customOrigin ? resolvedLocations.map(l => l.address).join('|') : resolvedLocations.slice(1).map(l => l.address).join('|');

    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&waypoints=optimize:true|${encodeURIComponent(waypoints)}&key=${apiKey}`;

    const res = await fetch(url);
    const data = await res.json();

    if (data.status !== "OK") {
      return Response.json({ message: "Error de Google Maps: " + (data.error_message || data.status) }, { status: 500 });
    }

    // El orden optimizado está en waypoint_order
    const optimizedOrder = data.routes[0].waypoint_order;
    
    // Mapear los IDs originales al nuevo orden
    let resultIds = [];
    
    if (customOrigin) {
      // Si hay origen personalizado, Google optimiza todas las locaciones enviadas como waypoints
      optimizedOrder.forEach(index => {
        resultIds.push(locations[index].id);
      });
    } else {
      // Si no hay origen personalizado, la primera locación fue el origen
      resultIds.push(locations[0].id);
      optimizedOrder.forEach(index => {
        resultIds.push(locations[index + 1].id);
      });
    }

    return Response.json({
      order: resultIds,
      summary: data.routes[0].summary,
      ubicaciones: ubicadas.map(({ id, lat, lng, fuente }) => ({ id, lat, lng, fuente })),
    });

  } catch (err) {
    console.error(err);
    return Response.json({ message: "Error interno del servidor" }, { status: 500 });
  }
}
