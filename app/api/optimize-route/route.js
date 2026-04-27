import { supabase } from "@/lib/supabaseClient";

export async function POST(req) {
  try {
    const { locations, origin: customOrigin } = await req.json(); 
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
      return Response.json({ message: "Google Maps API Key no configurada en el servidor." }, { status: 500 });
    }

    if (!locations || locations.length < 1) {
      return Response.json({ message: "Se necesitan ubicaciones para optimizar." }, { status: 400 });
    }

    // Función para expandir links cortos y extraer coordenadas
    const resolveLocation = async (item) => {
      const { url, addressText } = item;
      if (!url) return addressText; // Si no hay URL, usamos el texto directo
      
      try {
        const response = await fetch(url, { method: "GET", redirect: "follow" });
        const finalUrl = response.url;
        
        const coordMatch = finalUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || finalUrl.match(/q=(-?\d+\.\d+),(-?\d+\.\d+)/);
        if (coordMatch) {
          return `${coordMatch[1]},${coordMatch[2]}`;
        }
        return addressText; // Si el URL no tiene coordenadas, usamos el texto
      } catch (e) {
        return addressText; // Si falla la visita al link, usamos el texto
      }
    };

    // Resolvemos todas las ubicaciones en paralelo
    const resolvedLocations = await Promise.all(locations.map(async (l) => ({
      id: l.id,
      address: await resolveLocation(l)
    })));

    const origin = customOrigin || resolvedLocations[0].address; 
    const destination = origin; 
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
      summary: data.routes[0].summary 
    });

  } catch (err) {
    console.error(err);
    return Response.json({ message: "Error interno del servidor" }, { status: 500 });
  }
}
