// app/api/bookings/update-delivery/route.js — NUEVA RUTA DEDICADA
import { supabase as supabaseAnon } from "@/lib/supabaseClient";
import { createClient } from "@supabase/supabase-js";

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
  } catch (err) {
    return null;
  }
}

export async function PATCH(req) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, products, amountDue, deliveryStatus, paymentMethod } = body;

    if (!id) {
      return Response.json({ message: "Falta id" }, { status: 400 });
    }

    // 1. Leer el booking actual
    const { data: existing, error: readErr } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", id)
      .single();

    if (readErr || !existing) {
      return Response.json(
        { message: "Error al leer booking: " + (readErr?.message || "no encontrado") },
        { status: 500 }
      );
    }

    // 2. Construir datos de actualización
    const updateData = {};

    if (products !== undefined) {
      updateData.products = products || null;
    }

    if (amountDue !== undefined) {
      const num = Number(amountDue);
      updateData.amount_due = isNaN(num) ? 0 : num;
    }

    // estado entrega
    let finalStatus = existing.delivery_status || "pendiente";
    if (deliveryStatus !== undefined) {
      const allowed = ["pendiente", "entregado", "no_entregado"];
      const normalized = String(deliveryStatus).toLowerCase();
      finalStatus = allowed.includes(normalized) ? normalized : "pendiente";
      updateData.delivery_status = finalStatus;
    } else {
      updateData.delivery_status = finalStatus;
    }

    // forma de pago
    let finalPayment = existing.payment_method || "efectivo";
    if (paymentMethod !== undefined) {
      const allowedPay = ["efectivo", "transferencia"];
      const val = String(paymentMethod).toLowerCase();
      finalPayment = allowedPay.includes(val) ? val : "efectivo";
      updateData.payment_method = finalPayment;
    } else {
      updateData.payment_method = finalPayment;
    }

    // delivered_at
    let newDeliveredAt = existing.delivered_at || null;
    const isDeliveredCash = finalStatus === "entregado" && finalPayment === "efectivo";
    if (isDeliveredCash) {
      if (!existing.delivered_at) {
        newDeliveredAt = new Date().toISOString();
      }
    } else {
      newDeliveredAt = null;
    }
    updateData.delivered_at = newDeliveredAt;

    // 3. Actualizar el booking
    const { data: updatedBooking, error: updateErr } = await supabase
      .from("bookings")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (updateErr) {
      return Response.json(
        { message: "Error al actualizar booking: " + updateErr.message },
        { status: 500 }
      );
    }

    // 4. LÓGICA DE POST-ENTREGA
    const igNorm = existing.instagram ? existing.instagram.trim() : "";
    const igToSearch = igNorm.replace(/^@/, "");
    let sItemIds = existing.sale_item_ids || [];
    if (typeof sItemIds === "string") {
      try { sItemIds = JSON.parse(sItemIds); } catch (e) { sItemIds = []; }
    }

    let itemsUpdatedCount = 0;
    let syncLog = [];

    if (finalStatus === "entregado" && igNorm) {
      try {
        // 4a. Vaciar cajas si no hay más pendientes
        const { data: pCount } = await supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("instagram", existing.instagram)
          .neq("id", id)
          .or("delivery_status.eq.pendiente,delivery_status.is.null");

        if (!pCount || pCount.length === 0) {
          await supabase
            .from("clients")
            .update({ box_1: null, box_2: null })
            .or(`instagram.ilike.${igToSearch},instagram.ilike.@${igToSearch}`);
          syncLog.push("Cajas vaciadas");
        }

        // 4b. Marcar items por ID
        if (Array.isArray(sItemIds) && sItemIds.length > 0) {
          const { error: idErr } = await supabase
            .from("sale_items")
            .update({ delivery_status: "delivered" })
            .in("id", sItemIds);
          if (!idErr) {
            itemsUpdatedCount += sItemIds.length;
            syncLog.push(`${sItemIds.length} items marcados por ID`);
          } else {
            syncLog.push("Error marcando por ID: " + idErr.message);
          }
        } else {
          syncLog.push("No hay sale_item_ids guardados");
        }

        // 4c. Respaldo: marcar items por nombre de producto
        if (existing.products || products) {
          const prodText = products || existing.products;
          const { data: client } = await supabase
            .from("clients")
            .select("id")
            .or(`instagram.ilike.${igToSearch},instagram.ilike.@${igToSearch}`)
            .single();

          if (client) {
            syncLog.push("Cliente encontrado: " + client.id);
            const pLines = prodText.split("\n");

            for (const line of pLines) {
              const match = line.match(/(?:\d+x\s+)?(.+)/i);
              if (match) {
                const pName = match[1].trim().toLowerCase();
                const { data: sales } = await supabase
                  .from("sales")
                  .select("id")
                  .eq("client_id", client.id);

                if (sales?.length > 0) {
                  const saleIds = sales.map((s) => s.id);
                  const { data: items } = await supabase
                    .from("sale_items")
                    .select("id, products(name)")
                    .in("sale_id", saleIds)
                    .neq("delivery_status", "delivered");

                  syncLog.push(`Buscando "${pName}" en ${items?.length || 0} items pendientes`);

                  const matchedItems =
                    items?.filter(
                      (it) => it.products?.name?.toLowerCase().trim() === pName
                    ) || [];

                  for (const m of matchedItems) {
                    const { error: updErr } = await supabase
                      .from("sale_items")
                      .update({ delivery_status: "delivered" })
                      .eq("id", m.id);
                    if (!updErr) {
                      itemsUpdatedCount++;
                      syncLog.push(`Marcado item ${m.id} como delivered`);
                    }
                  }
                }
              }
            }
          } else {
            syncLog.push("Cliente NO encontrado con IG: " + igToSearch);
          }
        }

        // 4d. Liquidar deudas
        const { data: cDebt } = await supabase
          .from("clients")
          .select("id")
          .or(`instagram.ilike.${igToSearch},instagram.ilike.@${igToSearch}`)
          .single();

        if (cDebt) {
          const { data: activeS } = await supabase
            .from("sales")
            .select("id, total")
            .eq("client_id", cDebt.id)
            .eq("status", "credit");

          for (const s of activeS || []) {
            const { data: pending } = await supabase
              .from("sale_items")
              .select("id")
              .eq("sale_id", s.id)
              .neq("delivery_status", "delivered");

            if (!pending || pending.length === 0) {
              await supabase
                .from("sales")
                .update({ status: "paid", down_payment: s.total })
                .eq("id", s.id);
              syncLog.push(`Venta ${s.id} liquidada`);
            }
          }
        }
      } catch (err) {
        syncLog.push("Error en post-entrega: " + err.message);
        console.error("Error en post-entrega:", err);
      }
    } else if (finalStatus === "pendiente" || finalStatus === "no_entregado" || !finalStatus) {
      // REVERSIÓN — aplica tanto a pendiente como a no_entregado
      try {
        if (Array.isArray(sItemIds) && sItemIds.length > 0) {
          await supabase
            .from("sale_items")
            .update({ delivery_status: "pending" })
            .in("id", sItemIds);
          const { data: items } = await supabase
            .from("sale_items")
            .select("sale_id")
            .in("id", sItemIds);
          const uIds = [...new Set(items?.map((it) => it.sale_id) || [])];
          for (const sid of uIds) {
            await supabase.from("sales").update({ status: "credit" }).eq("id", sid);
          }
          syncLog.push("Revertidos " + sItemIds.length + " items a pending");
        }
      } catch (err) {
        syncLog.push("Error revirtiendo: " + err.message);
      }
    }

    return Response.json({
      message: `Entrega actualizada. ${itemsUpdatedCount} productos sincronizados. [${syncLog.join(" | ")}]`,
      booking: updatedBooking,
    });
  } catch (err) {
    console.error("Error general:", err);
    return Response.json({ message: "Error: " + err.message }, { status: 500 });
  }
}
