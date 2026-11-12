import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { getPanelSession } from "@/lib/panelAuth";
import {
  paquetesDelDia,
  clientasPosibles,
  productosEsperando,
  comoQuedanLasCajas,
  resumenDeCobro,
  armarPaquete,
  deshacerPaquete,
  juntarLoQueQueda,
} from "@/lib/paquetes";

// Preparación de paquetes. Quien reparte también prepara, así que entra todo el panel.

function hoyLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

export async function GET(req) {
  const session = getPanelSession(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const fecha = searchParams.get("fecha") || hoyLocal();
  const tipo = searchParams.get("tipo") || null;
  const bookingId = searchParams.get("bookingId");
  const clientId = searchParams.get("clientId");

  try {
    // Los productos que espera una clienta, para palomear cuáles se van.
    if (clientId) {
      return Response.json({ productos: await productosEsperando(clientId) });
    }

    // Un paquete en particular: la entrega, a quién se parece y qué se le puede meter.
    if (bookingId) {
      const { data: bk } = await supabase
        .from("bookings").select("*").eq("id", bookingId).single();
      if (!bk) return Response.json({ message: "Entrega no encontrada" }, { status: 404 });

      const candidatas = await clientasPosibles({
        instagram: bk.instagram,
        nombre: bk.fullName,
        telefono: bk.phone,
      });

      // Si ya quedó ligada antes, se sabe de quién es sin preguntar de nuevo.
      const { data: yaDentro } = await supabase
        .from("sale_items")
        .select("id, sales!inner ( client_id )")
        .eq("paquete_booking_id", bookingId);
      const ligadaA = yaDentro?.[0]?.sales?.client_id || null;

      return Response.json({
        entrega: bk,
        ligadaA,
        yaEnElPaquete: (yaDentro || []).map((i) => i.id),
        candidatas,
        productos: ligadaA ? await productosEsperando(ligadaA) : [],
      });
    }

    return Response.json({ fecha, paquetes: await paquetesDelDia(fecha, tipo) });
  } catch (e) {
    console.error("Error en paquetes:", e);
    return Response.json({ message: "Error al leer los paquetes" }, { status: 500 });
  }
}

export async function POST(req) {
  const session = getPanelSession(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });

  try {
    const { accion, bookingId, clientId, itemIds, juntarRestosEn, envio } = await req.json();

    // Cómo quedarían las cajas con lo que se lleva, y cuánto habría que cobrarle:
    // las dos cosas que se enseñan antes de armar.
    if (accion === "simular") {
      if (!clientId) return Response.json({ message: "Falta la clienta" }, { status: 400 });
      const [cajas, cobro] = await Promise.all([
        comoQuedanLasCajas(clientId, itemIds || []),
        resumenDeCobro(clientId, itemIds || [], envio),
      ]);
      return Response.json({ ...cajas, cobro });
    }

    if (accion === "armar") {
      const r = await armarPaquete({ bookingId, clientId, itemIds, juntarRestosEn, envio, session });
      const resumen = clientId ? await comoQuedanLasCajas(clientId, []) : null;
      return Response.json({ ok: true, ...r, cajas: resumen });
    }

    // Juntar en una sola caja lo que le quedó guardado suelto. Se usa al cancelar
    // una venta, cuando la clienta queda con mercancía repartida en varias cajas.
    if (accion === "juntar") {
      if (!clientId || !juntarRestosEn) {
        return Response.json({ message: "Falta la clienta o la caja" }, { status: 400 });
      }
      await juntarLoQueQueda(clientId, Number(juntarRestosEn));
      return Response.json({ ok: true, caja: Number(juntarRestosEn) });
    }

    if (accion === "deshacer") {
      return Response.json({ ok: true, sueltos: await deshacerPaquete(bookingId, clientId) });
    }

    // Entrega mal agendada: no corresponde a nadie, se quita de la lista. Solo se
    // permite si no tiene nada adentro, para no desarmar un paquete por accidente.
    if (accion === "mal_agendada") {
      const { count } = await supabase
        .from("sale_items")
        .select("id", { count: "exact", head: true })
        .eq("paquete_booking_id", bookingId);
      if ((count || 0) > 0) {
        return Response.json(
          { message: "Esta entrega ya tiene productos adentro. Deshaz el paquete antes de borrarla." },
          { status: 409 }
        );
      }
      const { error } = await supabase.from("bookings").delete().eq("id", bookingId);
      if (error) return Response.json({ message: "No se pudo borrar" }, { status: 500 });
      return Response.json({ ok: true, borrada: true });
    }

    return Response.json({ message: "Acción desconocida" }, { status: 400 });
  } catch (e) {
    console.error("Error al preparar paquete:", e);
    return Response.json({ message: e.message || "Error al preparar el paquete" }, { status: 500 });
  }
}
