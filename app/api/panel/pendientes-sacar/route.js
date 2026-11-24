import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { getPanelSession } from "@/lib/panelAuth";

export const dynamic = "force-dynamic";

// Mercancía que se quitó de una venta y sigue guardada en una caja o en el estante.
//
// Es el trabajo contrario al de la bitácora —sacar en vez de guardar— y por eso vive
// en su propia tabla, con el lugar congelado al momento en que se quitó. El detalle
// está en migrations/2026-11-24-sacar-de-la-bodega.sql.

// Quien trabaja en la bodega. El repartidor no entra, igual que en la bitácora.
function quienPuede(req) {
  const session = getPanelSession(req);
  return ["admin", "worker"].includes(session?.role) ? session : null;
}

const paraLaPantalla = (p) => ({
  id: p.id,
  saleId: p.sale_id,
  producto: p.producto,
  cantidad: p.cantidad,
  ubicacion: p.ubicacion,
  caja: p.caja,
  hecha: p.hecha,
  hechaAt: p.hecha_at,
  hechaPor: p.hecha_por,
  creadaEl: p.created_at,
  cliente: p.clients?.instagram
    ? "@" + p.clients.instagram.replace(/^@/, "")
    : p.clients?.name || "sin cliente",
});

// Por omisión, lo que falta por sacar. Con ?saleId= solo lo de esa venta, que es lo
// que enseña el detalle de la venta justo después de corregirla.
export async function GET(req) {
  const session = quienPuede(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 403 });

  const saleId = new URL(req.url).searchParams.get("saleId");

  let q = supabase
    .from("pendientes_sacar")
    .select("id, sale_id, producto, cantidad, ubicacion, caja, hecha, hecha_at, hecha_por, created_at, clients ( name, instagram )")
    .eq("hecha", false)
    .order("created_at", { ascending: true });

  if (saleId) q = q.eq("sale_id", saleId);

  const { data, error } = await q;
  if (error) {
    console.error("Error al leer los pendientes de sacar:", error);
    return Response.json({ message: "No se pudo leer la lista" }, { status: 500 });
  }

  const pendientes = (data || []).map(paraLaPantalla);
  return Response.json({ pendientes, total: pendientes.length });
}

export async function PATCH(req) {
  const session = quienPuede(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 403 });

  const { ids = [], hecha = true } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json({ message: "No se indicó qué pendiente" }, { status: 400 });
  }

  const { error } = await supabase
    .from("pendientes_sacar")
    .update({
      hecha: !!hecha,
      hecha_at: hecha ? new Date().toISOString() : null,
      hecha_por: hecha ? (session.displayName || session.username || null) : null,
    })
    .in("id", ids);

  if (error) {
    console.error("Error al marcar un pendiente de sacar:", error);
    return Response.json({ message: "No se pudo guardar" }, { status: 500 });
  }
  return Response.json({ ok: true, marcadas: ids.length });
}
