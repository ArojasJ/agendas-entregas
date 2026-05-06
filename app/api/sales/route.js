import { supabase } from "@/lib/supabaseClient";

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

export async function GET(req) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get("status");
  const countOnly = searchParams.get("countOnly") === "true";

  if (countOnly) {
    let query = supabase
      .from("sales")
      .select("*", { count: 'exact', head: true });
    
    if (statusFilter) {
      query = query.eq("status", statusFilter);
    }

    const { count, error } = await query;
    if (error) return Response.json({ message: error.message }, { status: 500 });
    return Response.json({ count: count || 0 });
  }

  let query = supabase
    .from("sales")
    .select(`
      *,
      clients ( name, instagram, phone ),
      staff ( display_name ),
      sale_items (
        quantity,
        unit_price,
        products ( name, barcode )
      )
    `);

  if (statusFilter) {
    query = query.eq("status", statusFilter);
  }

  const { data: sales, error } = await query.order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return Response.json({ message: "Error al leer ventas." }, { status: 500 });
  }

  return Response.json({ sales: sales || [] });
}

export async function POST(req) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { client_id, total, discount, payment_method, status, down_payment, credit_days, items, saldo_applied } = body;

    if (!items || items.length === 0) {
      return Response.json({ message: "La venta no tiene productos." }, { status: 400 });
    }

    const saleStatus = status === 'credit' ? 'credit' : 'paid';
    const saleTotal = Number(total);
    const saleDownPayment = Number(down_payment) || (saleStatus === 'paid' ? saleTotal : 0);

    let due_date = null;
    if (saleStatus === 'credit') {
      const days = Number(credit_days) || 15;
      const d = new Date();
      d.setDate(d.getDate() + days);
      due_date = d.toISOString().split("T")[0];
    }

    // 1. Crear la venta (sales)
    const { data: newSale, error: saleError } = await supabase
      .from("sales")
      .insert([{
        client_id: client_id || null,
        total: saleTotal,
        discount: Number(discount) || 0,
        payment_method: payment_method || 'efectivo',
        status: saleStatus,
        down_payment: saleDownPayment,
        due_date,
        created_by_staff_id: session.staffId || null
      }])
      .select()
      .single();

    if (saleError) {
      console.error(saleError);
      return Response.json({ message: "No se pudo registrar la venta." }, { status: 500 });
    }

    const saleId = newSale.id;

    // 2. Crear los detalles y descontar inventario
    for (let item of items) {
      const { error: itemError } = await supabase
        .from("sale_items")
        .insert([{
          sale_id: saleId,
          product_id: item.product_id,
          variant_id: item.variant_id || null,
          quantity: item.quantity,
          unit_price: item.unit_price,
          delivery_status: "pending"
        }]);

      if (itemError) {
        console.error("Error al guardar item:", itemError);
      }

      // Descontar inventario: variante o producto base
      if (item.variant_id) {
        const { data: variant } = await supabase
          .from("product_variants").select("stock").eq("id", item.variant_id).single();
        if (variant) {
          await supabase.from("product_variants")
            .update({ stock: Math.max(0, variant.stock - item.quantity) })
            .eq("id", item.variant_id);
        }
      } else {
        const { data: product } = await supabase
          .from("products").select("stock").eq("id", item.product_id).single();
        if (product) {
          await supabase.from("products")
            .update({ stock: Math.max(0, product.stock - item.quantity) })
            .eq("id", item.product_id);
        }
      }
    }

    // Deducir saldo a favor si se aplicó
    const saldoAplicado = Number(saldo_applied) || 0;
    if (saldoAplicado > 0 && client_id) {
      const { data: client } = await supabase.from("clients").select("saldo_favor").eq("id", client_id).single();
      if (client) {
        const nuevoSaldo = Math.max(0, Math.round((Number(client.saldo_favor || 0) - saldoAplicado) * 100) / 100);
        await supabase.from("clients").update({ saldo_favor: nuevoSaldo }).eq("id", client_id);
      }
    }

    return Response.json({ message: "Venta registrada con éxito.", sale: newSale });
  } catch (err) {
    console.error(err);
    return Response.json({ message: "Error en el servidor." }, { status: 500 });
  }
}

export async function DELETE(req) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) return Response.json({ message: "Falta id de venta" }, { status: 400 });

    // 1. Snapshot de la venta antes de borrar
    const { data: saleSnapshot } = await supabase
      .from("sales")
      .select("*, sale_items(*, products(name)), payments(*)")
      .eq("id", id)
      .single();

    // 2. Regresar stock
    const { data: items, error: itemsError } = await supabase
      .from("sale_items")
      .select("product_id, variant_id, quantity")
      .eq("sale_id", id);

    if (!itemsError && items && items.length > 0) {
      for (let item of items) {
        if (item.variant_id) {
          const { data: v } = await supabase.from("product_variants").select("stock").eq("id", item.variant_id).single();
          if (v) await supabase.from("product_variants").update({ stock: v.stock + item.quantity }).eq("id", item.variant_id);
        } else {
          const { data: product } = await supabase.from("products").select("stock").eq("id", item.product_id).single();
          if (product) await supabase.from("products").update({ stock: product.stock + item.quantity }).eq("id", item.product_id);
        }
      }
    }

    // 3. Eliminar
    await supabase.from("sale_items").delete().eq("sale_id", id);
    const { error: deleteError } = await supabase.from("sales").delete().eq("id", id);

    if (deleteError) {
      return Response.json({ message: "Error al eliminar: " + deleteError.message }, { status: 500 });
    }

    // 4. Registrar en audit_logs
    await supabase.from("audit_logs").insert([{
      action: "delete_sale",
      entity_type: "sale",
      entity_id: String(id),
      entity_snapshot: saleSnapshot || null,
      staff_id: session.staffId ? String(session.staffId) : null,
      staff_name: session.displayName || session.username || null,
      staff_role: session.role || null,
    }]);

    return Response.json({ message: "Venta eliminada y stock restaurado." });
  } catch (e) {
    console.error(e);
    return Response.json({ message: "Error en servidor." }, { status: 500 });
  }
}
