import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { getPanelSession } from "@/lib/panelAuth";
import { liberarSiYaNoQuedaNada, liquidarSiYaSalioTodo } from "@/lib/ubicaciones";
import { marcarEntregados } from "@/lib/entregadoPor";
import { cajasDeTexto } from "@/lib/constants";

export const dynamic = "force-dynamic";

const DIAS = { "90": 90, "180": 180, todo: null };

// Limpieza de los productos que quedaron sin entregar y sin lugar registrado, por el
// borrado de cajas que corría en cada entrega. Pantalla provisional: se quita cuando
// el rezago esté resuelto.
export async function GET(req) {
  const session = getPanelSession(req);
  // El repartidor queda fuera: esta limpieza se hace desde la bodega
  if (!session || !["admin", "worker"].includes(session.role)) {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }

  const periodo = new URL(req.url).searchParams.get("periodo") || "90";
  // "todo" vale null a propósito: sin tope de fecha. Con ?? ese null se volvía 90 y
  // "Todo" mostraba exactamente lo mismo que "Últimos 3 meses", escondiendo casi mil
  // productos. El valor desconocido sí cae en 90.
  const dias = periodo in DIAS ? DIAS[periodo] : 90;

  // Supabase corta en 1000 filas por petición, y el rezago es mayor: hay que paginar
  // o la pantalla mostraría una parte sin avisar.
  const PAGINA = 1000;
  const data = [];
  for (let desde = 0; ; desde += PAGINA) {
    let q = supabase
      .from("sale_items")
      .select(`
        id, quantity, delivery_status,
        products ( name ),
        sales!inner ( id, created_at, status, ubicacion, caja,
                      clients!inner ( id, name, instagram, box_1, box_2 ) )
      `)
      .or("delivery_status.neq.delivered,delivery_status.is.null")
      .not("sales.status", "in", '("cancelled","pending_payment")')
      .lt("sales.created_at", new Date(Date.now() - 10 * 86400000).toISOString())
      // El rezago es de quienes quedaron sin caja; con caja asignada el lugar ya se sabe
      .is("sales.clients.box_1", null)
      .is("sales.clients.box_2", null)
      .is("sales.ubicacion", null)
      // El orden tiene que ser de sale_items, no de la tabla anidada: PostgREST no
      // ordena las filas de arriba por una columna de la relación, y sin un orden
      // estable el paginado puede repetir y saltarse renglones. Lo viejo primero se
      // arma más abajo, ya con todo junto.
      .order("id", { ascending: true })
      .range(desde, desde + PAGINA - 1);

    if (dias) {
      q = q.gt("sales.created_at", new Date(Date.now() - dias * 86400000).toISOString());
    }

    const { data: pagina, error } = await q;
    if (error) {
      console.error("Error al leer el chequeo:", error);
      return Response.json({ message: "Error al leer los productos" }, { status: 500 });
    }
    if (!pagina || pagina.length === 0) break;
    data.push(...pagina);
    if (pagina.length < PAGINA) break;
  }

  // Agrupar por clienta: son muchas menos decisiones que producto por producto
  const porCliente = new Map();
  for (const item of data) {
    const venta = item.sales;
    const cliente = venta?.clients;
    if (!cliente) continue;

    if (!porCliente.has(cliente.id)) {
      porCliente.set(cliente.id, {
        id: cliente.id,
        nombre: cliente.name,
        instagram: cliente.instagram,
        // Todas las que tenga, no solo la primera: una ficha puede traer varias
        caja: cajasDeTexto(cliente.box_1, cliente.box_2).join(", ") || null,
        productos: [],
      });
    }
    porCliente.get(cliente.id).productos.push({
      itemId: item.id,
      saleId: venta.id,
      nombre: item.products?.name || "(producto eliminado)",
      cantidad: item.quantity,
      compradoEl: venta.created_at,
      ubicacion: venta.ubicacion,
      cajaVenta: venta.caja,
    });
  }

  for (const cliente of porCliente.values()) {
    cliente.productos.sort((a, b) => new Date(a.compradoEl) - new Date(b.compradoEl));
  }

  const clientes = [...porCliente.values()].sort(
    (a, b) => new Date(a.productos[0].compradoEl) - new Date(b.productos[0].compradoEl)
  );

  return Response.json({
    clientes,
    totalProductos: data.length,
    totalClientes: clientes.length,
  });
}

export async function PATCH(req) {
  const session = getPanelSession(req);
  // El repartidor queda fuera: esta limpieza se hace desde la bodega
  if (!session || !["admin", "worker"].includes(session.role)) {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }

  const { accion, itemIds = [], saleIds = [], clientId } = await req.json();

  if (accion === "entregado") {
    if (itemIds.length === 0) {
      return Response.json({ message: "No se indicó qué productos" }, { status: 400 });
    }

    const { data: afectados } = await supabase
      .from("sale_items")
      .select("sale_id")
      .in("id", itemIds);

    try {
      await marcarEntregados(supabase, itemIds, session);
    } catch (error) {
      console.error("Error al marcar entregado:", error);
      return Response.json({ message: "No se pudo marcar como entregado" }, { status: 500 });
    }

    // Lo mismo que ocurre al marcar una entrega desde el panel: la venta a crédito
    // se cierra sola solo si el dinero ya estaba; si sigue debiendo, se avisa para
    // preguntarlo en pantalla en vez de darla por pagada.
    const porCobrar = [];
    for (const ventaId of [...new Set((afectados || []).map((a) => a.sale_id))]) {
      const r = await liquidarSiYaSalioTodo(ventaId);
      if (r.porCobrar) porCobrar.push(r.porCobrar);
    }
    if (clientId) await liberarSiYaNoQuedaNada(clientId);

    return Response.json({ ok: true, marcados: itemIds.length, porCobrar });
  }

  if (accion === "estante") {
    if (saleIds.length === 0) {
      return Response.json({ message: "No se indicó qué compras" }, { status: 400 });
    }
    const { error } = await supabase
      .from("sales")
      .update({ ubicacion: "estante", caja: null })
      .in("id", saleIds);

    if (error) {
      console.error("Error al marcar estante:", error);
      return Response.json({ message: "No se pudo marcar en estante" }, { status: 500 });
    }
    return Response.json({ ok: true, marcadas: saleIds.length });
  }

  return Response.json({ message: "Acción desconocida" }, { status: 400 });
}
