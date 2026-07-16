import { createClient } from "@supabase/supabase-js";
import { supabase as supabaseAnon } from "@/lib/supabaseClient";

const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : supabaseAnon;

function getPanelSession(req) {
  const headerToken = req.headers.get("x-panel-token");
  const secret = process.env.PANEL_TOKEN_SECRET || "agenda_super_secreta_123";
  if (!headerToken) return null;
  try {
    const decoded = Buffer.from(headerToken, "base64").toString("utf8");
    const [json, sig] = decoded.split("|");
    if (sig !== secret) return null;
    return JSON.parse(json);
  } catch { return null; }
}

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

    // 4. Marcar como entregados en lote
    const { error: updateErr } = await supabase
      .from("sale_items")
      .update({ delivery_status: "delivered" })
      .in("id", pendingItemIds);

    if (updateErr) {
      return Response.json({ message: "Error al actualizar items: " + updateErr.message }, { status: 500 });
    }

    // 5. Revisar qué ventas quedan totalmente entregadas y liquidarlas
    let salesLiquidated = 0;
    for (const saleId of affectedSaleIds) {
      const { data: stillPending } = await supabase
        .from("sale_items")
        .select("id")
        .eq("sale_id", saleId)
        .or("delivery_status.neq.delivered,delivery_status.is.null");

      if (!stillPending || stillPending.length === 0) {
        const { data: saleRow } = await supabase
          .from("sales")
          .select("id, total, status")
          .eq("id", saleId)
          .single();
        if (saleRow && saleRow.status === "credit") {
          await supabase
            .from("sales")
            .update({ status: "paid", down_payment: saleRow.total })
            .eq("id", saleId);
          salesLiquidated++;
        }
      }
    }

    return Response.json({
      message: `Sincronización completa: ${pendingItemIds.length} producto${pendingItemIds.length !== 1 ? "s" : ""} actualizado${pendingItemIds.length !== 1 ? "s" : ""}${salesLiquidated > 0 ? `, ${salesLiquidated} venta${salesLiquidated !== 1 ? "s" : ""} liquidada${salesLiquidated !== 1 ? "s" : ""}` : ""}.`,
      fixed: pendingItemIds.length,
      salesLiquidated,
    });
  } catch (err) {
    console.error("sync-deliveries error:", err);
    return Response.json({ message: "Error: " + err.message }, { status: 500 });
  }
}
