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

export async function GET(req, { params }) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;

  if (!id) {
    return Response.json({ message: "ID de venta requerido" }, { status: 400 });
  }

  try {
    const { data: sale, error } = await supabase
      .from("sales")
      .select(`
        *,
        clients ( id, name, instagram, phone ),
        staff ( display_name ),
        sale_items (
          id,
          quantity,
          unit_price,
          product_id,
          variant_id,
          delivery_status,
          products ( id, name, barcode, image_url ),
          product_variants ( id, name, option_type )
        ),
        payments (
          id,
          amount,
          created_at
        )
      `)
      .eq("id", id)
      .single();

    if (error) {
      console.error(error);
      return Response.json({ message: "Error al obtener detalles de la venta" }, { status: 500 });
    }

    return Response.json({ sale });
  } catch (error) {
    console.error(error);
    return Response.json({ message: "Error en el servidor" }, { status: 500 });
  }
}

export async function PATCH(req, { params }) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }
  
  const { id } = await params;
  if (!id) return Response.json({ message: "ID de venta requerido" }, { status: 400 });

  try {
    const body = await req.json();
    const { status, payment_method, down_payment, due_date, action } = body;

    if (action === 'cancel_forfeit') {
      const { data: sale, error: saleErr } = await supabase
        .from("sales")
        .select("status, down_payment, total, sale_items(product_id, variant_id, quantity)")
        .eq("id", id)
        .single();

      if (saleErr || !sale) return Response.json({ message: "Venta no encontrada" }, { status: 404 });
      if (sale.status === 'cancelled') return Response.json({ message: "La venta ya está cancelada" }, { status: 400 });

      for (let item of sale.sale_items) {
        if (item.variant_id) {
          const { data: v } = await supabase.from("product_variants").select("stock").eq("id", item.variant_id).single();
          if (v) await supabase.from("product_variants").update({ stock: v.stock + item.quantity }).eq("id", item.variant_id);
        } else {
          const { data: product } = await supabase.from("products").select("stock").eq("id", item.product_id).single();
          if (product) await supabase.from("products").update({ stock: product.stock + item.quantity }).eq("id", item.product_id);
        }
      }

      const { error: updateErr } = await supabase.from("sales").update({ status: 'cancelled' }).eq("id", id);
      if (updateErr) return Response.json({ message: "Error al cancelar" }, { status: 500 });
      return Response.json({ success: true, message: "Venta penalizada y stock restaurado" });
    }

    if (action === 'revert_cancel') {
      const { data: sale, error: saleErr } = await supabase
        .from("sales")
        .select("status, down_payment, total, sale_items(product_id, variant_id, quantity)")
        .eq("id", id)
        .single();

      if (saleErr || !sale) return Response.json({ message: "Venta no encontrada" }, { status: 404 });
      if (sale.status !== 'cancelled') return Response.json({ message: "La venta no está cancelada" }, { status: 400 });

      // Descontar stock de nuevo
      for (let item of sale.sale_items) {
        if (item.variant_id) {
          const { data: v } = await supabase.from("product_variants").select("stock").eq("id", item.variant_id).single();
          if (v) await supabase.from("product_variants").update({ stock: Math.max(0, v.stock - item.quantity) }).eq("id", item.variant_id);
        } else {
          const { data: product } = await supabase.from("products").select("stock").eq("id", item.product_id).single();
          if (product) await supabase.from("products").update({ stock: Math.max(0, product.stock - item.quantity) }).eq("id", item.product_id);
        }
      }

      // Restaurar status original: si down_payment < total era crédito, si no era pagada
      const originalStatus = Number(sale.down_payment) < Number(sale.total) ? 'credit' : 'paid';
      const { error: updateErr } = await supabase.from("sales").update({ status: originalStatus }).eq("id", id);
      if (updateErr) return Response.json({ message: "Error al revertir" }, { status: 500 });
      return Response.json({ success: true, message: "Penalización revertida" });
    }
    
    const updateData = {};
    if (status !== undefined) updateData.status = status;
    if (payment_method !== undefined) updateData.payment_method = payment_method;
    if (down_payment !== undefined) updateData.down_payment = Number(down_payment);
    if (due_date !== undefined) updateData.due_date = due_date || null;

    const { error } = await supabase
      .from("sales")
      .update(updateData)
      .eq("id", id);

    if (error) {
      console.error(error);
      return Response.json({ message: "Error al actualizar venta" }, { status: 500 });
    }
    return Response.json({ success: true });
  } catch (err) {
    return Response.json({ message: "Error en el servidor" }, { status: 500 });
  }
}
