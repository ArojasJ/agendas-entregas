import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { getPanelSession } from "@/lib/panelAuth";
import { TIPO_PARADA_PAQUETERIA } from "@/lib/constants";

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
