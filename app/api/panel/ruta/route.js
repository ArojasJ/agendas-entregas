import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { getPanelSession } from "@/lib/panelAuth";
import { TIPO_PARADA_PAQUETERIA } from "@/lib/constants";
import { geoAddress } from "@/lib/address";
import { ubicarParadas } from "@/lib/ruta/coordenadas";

export const dynamic = "force-dynamic";

// Las paradas de la ruta de un día, y nada más.
//
// La pantalla de ruta usaba /api/bookings, que baja TODAS las entregas de la historia
// —3,431 renglones, 2.6 MB— más blocked_days, bodega_extra_days, special_days y el
// cálculo de cupos, para que el celular se quedara con siete. En la calle, con datos
// móviles, eso son segundos de espera cada vez que el repartidor vuelve de Google
// Maps. Que es muchas veces al día.
//
// Aquí se piden solo las columnas que la pantalla pinta. Mandar `select("*")` traía
// campos que no se usan y encarecía cada regreso del mapa.

const CAMPOS = [
  "id", "type", "date", "delivery_status",
  "instagram", "fullName", "phone",
  "address", "city", "state", "postal_code", "notes",
  "products", "amount_due",
  "location_url", "lat", "lng",
].join(", ");

export async function GET(req) {
  const session = getPanelSession(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  // La fecha la manda el celular: es SU día, no el del servidor, que corre en UTC y a
  // partir de las 6 de la tarde ya está en el día siguiente.
  const fecha = searchParams.get("fecha");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha || "")) {
    return Response.json({ message: "Falta la fecha" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("bookings")
    .select(CAMPOS)
    .eq("date", fecha)
    .in("type", ["domicilio", TIPO_PARADA_PAQUETERIA])
    .order("createdAt", { ascending: true });

  if (error) {
    console.error("Error al leer la ruta:", error);
    return Response.json({ message: "No se pudo cargar la ruta" }, { status: 500 });
  }

  return Response.json({ paradas: data || [] });
}

// POST: dónde queda cada parada, para poder pintarlas en el mapa.
//
// Se resuelve UNA vez y se guarda en bookings.lat/lng. Las columnas existían desde
// siempre y estaban vacías en las 318 entregas desde octubre, así que el mapa le
// mandaba a Google el texto de la dirección y Google adivinaba: de ahí el mapa a
// escala de todo el país que vio el repartidor, con los pines encimados.
//
// Guardarlo importa por dos razones: seguir el link corto de cada pin cuesta un viaje
// a Google por parada —con el repartidor mirando la pantalla— y cada búsqueda por
// texto se cobra. Una vez resuelto, abrir la ruta ya no pregunta nada.
export async function POST(req) {
  const session = getPanelSession(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });

  let ids;
  try {
    ({ ids } = await req.json());
  } catch {
    return Response.json({ message: "Cuerpo inválido" }, { status: 400 });
  }
  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json({ message: "Faltan las paradas" }, { status: 400 });
  }
  // Un día de ruta son unas pocas paradas; el tope es para que nadie use esto como
  // una manguera para geocodificar la base entera.
  if (ids.length > 60) {
    return Response.json({ message: "Demasiadas paradas de una vez" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("bookings")
    .select("id, address, city, state, location_url, lat, lng")
    .in("id", ids);

  if (error) {
    console.error("Error al leer las paradas por ubicar:", error);
    return Response.json({ message: "No se pudieron leer las paradas" }, { status: 500 });
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const ubicadas = await ubicarParadas(
    (data || []).map((bk) => ({ ...bk, addressText: geoAddress(bk) })),
    apiKey
  );

  // Guardar lo recién resuelto. Que falle el guardado no arruina la ruta de hoy —el
  // mapa ya tiene sus coordenadas en la respuesta—, pero sí hay que gritarlo, porque
  // significa que mañana se vuelve a preguntar y a pagar.
  for (const u of ubicadas) {
    if (!u.nueva || u.lat == null) continue;
    const { error: errGuardar } = await supabase
      .from("bookings")
      .update({ lat: u.lat, lng: u.lng })
      .eq("id", u.id);
    if (errGuardar) console.error("No se pudo guardar la ubicación de " + u.id + ":", errGuardar);
  }

  return Response.json({
    ubicaciones: ubicadas.map(({ id, lat, lng, fuente }) => ({ id, lat, lng, fuente })),
  });
}
