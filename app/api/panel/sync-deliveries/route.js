import { createClient } from "@supabase/supabase-js";
import { getPanelSession } from "@/lib/panelAuth";
import { supabase as supabaseAnon } from "@/lib/supabaseClient";
import { liquidarSiYaSalioTodo } from "@/lib/ubicaciones";
import { selloDeEntrega } from "@/lib/entregadoPor";

const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : supabaseAnon;


export async function POST(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== "admin") {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  try {
    // 1. Obtener todos los bookings marcados como entregado
    const allDelivered = [];
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("bookings")
        .select("id, sale_item_ids, instagram")
        .eq("delivery_status", "entregado")
        .range(from, from + 499);
      if (error || !data || data.length === 0) break;
      allDelivered.push(...data);
      if (data.length < 500) break;
      from += 500;
    }

    // 2. Recolectar todos los sale_item_ids que deberían estar entregados
    const allItemIds = [];
    for (const bk of allDelivered) {
      let ids = bk.sale_item_ids || [];
      if (typeof ids === "string") { try { ids = JSON.parse(ids); } catch { ids = []; } }
      if (Array.isArray(ids) && ids.length > 0) {
        allItemIds.push(...ids);
      }
    }

    const uniqueItemIds = [...new Set(allItemIds)];

    if (uniqueItemIds.length === 0) {
      return Response.json({ message: "No hay items vinculados a entregas completadas.", fixed: 0, salesLiquidated: 0 });
    }

    // 3. Filtrar solo los que siguen pendientes (delivery_status != 'delivered')
    const { data: pendingItems, error: pendingErr } = await supabase
      .from("sale_items")
      .select("id, sale_id")
      .in("id", uniqueItemIds)
      .or("delivery_status.neq.delivered,delivery_status.is.null");

    if (pendingErr) {
      return Response.json({ message: "Error al consultar items: " + pendingErr.message }, { status: 500 });
    }

    if (!pendingItems || pendingItems.length === 0) {
      return Response.json({ message: "Todo está sincronizado correctamente.", fixed: 0, salesLiquidated: 0 });
    }

    const pendingItemIds = pendingItems.map(i => i.id);
    const affectedSaleIds = [...new Set(pendingItems.map(i => i.sale_id))];

    // 4. Marcar como entregados en lote. Queda firmado con quien corrió la
    // sincronización, que es lo más cercano a la verdad que se puede saber aquí.
    const { error: updateErr } = await supabase
      .from("sale_items")
      .update({ delivery_status: "delivered", ...selloDeEntrega(session) })
      .in("id", pendingItemIds);

    if (updateErr) {
      return Response.json({ message: "Error al actualizar items: " + updateErr.message }, { status: 500 });
    }

    // 5. Revisar qué ventas quedan totalmente entregadas. Las que ya estaban pagadas
    // se cierran; las que siguen debiendo se quedan a crédito y se reportan, porque
    // esto corre en bloque y aquí no hay a quién preguntarle.
    let salesLiquidated = 0;
    const porCobrar = [];
    for (const saleId of affectedSaleIds) {
      const r = await liquidarSiYaSalioTodo(saleId);
      if (r.liquidada) salesLiquidated++;
      if (r.porCobrar) porCobrar.push(r.porCobrar);
    }

    return Response.json({
      message: `Sincronización completa: ${pendingItemIds.length} producto${pendingItemIds.length !== 1 ? "s" : ""} actualizado${pendingItemIds.length !== 1 ? "s" : ""}${salesLiquidated > 0 ? `, ${salesLiquidated} venta${salesLiquidated !== 1 ? "s" : ""} liquidada${salesLiquidated !== 1 ? "s" : ""}` : ""}.`,
      fixed: pendingItemIds.length,
      salesLiquidated,
      porCobrar,
    });
  } catch (err) {
    console.error("sync-deliveries error:", err);
    return Response.json({ message: "Error: " + err.message }, { status: 500 });
  }
}
