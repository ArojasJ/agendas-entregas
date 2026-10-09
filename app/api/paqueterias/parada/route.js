import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { getPanelSession } from "@/lib/panelAuth";
import { TIPO_PARADA_PAQUETERIA } from "@/lib/constants";

// Una parada por paquetería y por día: si el repartidor ya va a Estafeta, los
// paquetes nuevos se suman a esa parada en vez de crear otra al mismo lugar.
export async function POST(req) {
  const session = getPanelSession(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });

  const { paqueteriaId, fecha, paquetes, notas } = await req.json();
  if (!paqueteriaId || !fecha) {
    return Response.json({ message: "Falta la paquetería o la fecha" }, { status: 400 });
  }

  const cantidad = Math.max(1, Number(paquetes) || 1);

  const { data: pq, error: errPq } = await supabase
    .from("paqueterias")
    .select("*")
    .eq("id", paqueteriaId)
    .single();

  if (errPq || !pq) {
    return Response.json({ message: "Paquetería no encontrada" }, { status: 404 });
  }

  const { data: existente } = await supabase
    .from("bookings")
    .select("id, products, notes")
    .eq("type", TIPO_PARADA_PAQUETERIA)
    .eq("date", fecha)
    .eq("fullName", pq.nombre)
    .maybeSingle();

  if (existente) {
    const previos = Number(String(existente.products || "").match(/\d+/)?.[0]) || 0;
    const total = previos + cantidad;
    const { error } = await supabase
      .from("bookings")
      .update({
        products: `${total} paquete${total === 1 ? "" : "s"}`,
        notes: notas?.trim() || existente.notes || null,
      })
      .eq("id", existente.id);

    if (error) {
      console.error("Error al sumar paquetes a la parada:", error);
      return Response.json({ message: "No se pudo actualizar la parada" }, { status: 500 });
    }
    return Response.json({ ok: true, sumado: true, total });
  }

  const { data, error } = await supabase
    .from("bookings")
    .insert([{
      type: TIPO_PARADA_PAQUETERIA,
      date: fecha,
      instagram: "",
      fullName: pq.nombre,
      phone: "",
      address: pq.direccion,
      lat: pq.lat,
      lng: pq.lng,
      // Con coordenadas el navegador abre el pin exacto sin geocodificar texto
      location_url: pq.lat != null && pq.lng != null
        ? `https://www.google.com/maps/search/?api=1&query=${pq.lat},${pq.lng}`
        : null,
      products: `${cantidad} paquete${cantidad === 1 ? "" : "s"}`,
      notes: notas?.trim() || null,
      amount_due: 0,
      delivery_status: "pendiente",
      override: true,
    }])
    .select()
    .single();

  if (error) {
    console.error("Error al crear parada de paquetería:", error);
    return Response.json({ message: "No se pudo agregar la parada" }, { status: 500 });
  }
  return Response.json({ ok: true, parada: data, total: cantidad });
}
