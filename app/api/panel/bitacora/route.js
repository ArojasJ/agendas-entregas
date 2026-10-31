import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { getPanelSession } from "@/lib/panelAuth";
import { traerTodo } from "@/lib/paginar";
import { diaLocal, rangoDelDia } from "@/lib/constants";

export const dynamic = "force-dynamic";

// Las trabajadoras llegan temprano y resuelven la lista; el repartidor no entra.
function quienPuede(req) {
  const session = getPanelSession(req);
  return ["admin", "worker"].includes(session?.role) ? session : null;
}

// Lo que hay que hacer al llegar a la bodega. Por omisión solo lo pendiente;
// con ?dia=YYYY-MM-DD se consulta lo ya hecho de ese día.
export async function GET(req) {
  const session = quienPuede(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 403 });

  const dia = new URL(req.url).searchParams.get("dia");

  const tareas = await traerTodo(() => {
    let q = supabase
      .from("bitacora_tareas")
      .select(`
        id, productos, hecha, hecha_at, hecha_por, created_at,
        clients ( name, instagram ),
        sales!inner ( id, ubicacion, caja, status )
      `)
      // Una de cada diez ventas se cancela. Sin esto, su tarea se quedaba pendiente
      // para siempre pidiendo guardar algo que ya no se vendió.
      .not("sales.status", "in", '("cancelled","pending_payment")')
      .order("created_at", { ascending: true });

    if (dia) {
      const { desde, hasta } = rangoDelDia(dia);
      q = q.gte("created_at", desde).lte("created_at", hasta);
    } else {
      q = q.eq("hecha", false);
    }
    return q;
  });

  // Agrupadas por el día en que se vendió: el lunes salen juntos viernes, sábado y
  // domingo sin que el sistema tenga que saber qué días abren.
  const porDia = new Map();
  for (const t of tareas) {
    const clave = diaLocal(t.created_at);
    if (!porDia.has(clave)) porDia.set(clave, []);
    porDia.get(clave).push({
      id: t.id,
      productos: t.productos,
      hecha: t.hecha,
      hechaAt: t.hecha_at,
      hechaPor: t.hecha_por,
      creadaEl: t.created_at,
      // Ya viene listo para mostrar: con arroba si es usuario de Instagram, y si la
      // clienta se borró no se inventa una arroba sobre la palabra "sin cliente".
      cliente: t.clients?.instagram
        ? "@" + t.clients.instagram.replace(/^@/, "")
        : t.clients?.name || "sin cliente",
      nombre: t.clients?.name || null,
      // Se lee de la venta, no de una copia: si se movió de caja, aquí sale la actual
      ubicacion: t.sales?.ubicacion || null,
      caja: t.sales?.caja ?? null,
    });
  }

  const dias = [...porDia.entries()]
    .map(([fecha, items]) => ({ fecha, tareas: items }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));

  return Response.json({ dias, total: tareas.length });
}

export async function PATCH(req) {
  const session = quienPuede(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 403 });

  const { ids = [], hecha = true } = await req.json();
  if (ids.length === 0) return Response.json({ message: "No se indicó qué tarea" }, { status: 400 });

  const { error } = await supabase
    .from("bitacora_tareas")
    .update({
      hecha: !!hecha,
      hecha_at: hecha ? new Date().toISOString() : null,
      hecha_por: hecha ? (session.displayName || session.username || null) : null,
    })
    .in("id", ids);

  if (error) {
    console.error("Error al marcar tarea de bitácora:", error);
    return Response.json({ message: "No se pudo guardar" }, { status: 500 });
  }
  return Response.json({ ok: true, marcadas: ids.length });
}
