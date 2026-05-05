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
          delivery_status,
          products ( id, name, barcode, image_url )
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
      // 1. Obtener la venta y sus items para regresar stock
      const { data: sale, error: saleErr } = await supabase
        .from("sales")
        .select("status, sale_items(product_id, quantity)")
        .eq("id", id)
        .single();

      if (saleErr || !sale) return Response.json({ message: "Venta no encontrada" }, { status: 404 });
      if (sale.status === 'cancelled') return Response.json({ message: "La venta ya está cancelada" }, { status: 400 });

      // 2. Regresar stock
      for (let item of sale.sale_items) {
        const { data: product } = await supabase
          .from("products")
          .select("stock")
          .eq("id", item.product_id)
          .single();
        
        if (product) {
          await supabase
            .from("products")
            .update({ stock: product.stock + item.quantity })
            .eq("id", item.product_id);
        }
      }

      // 3. Marcar como cancelada
      const { error: updateErr } = await supabase
        .from("sales")
        .update({ status: 'cancelled' })
        .eq("id", id);

      if (updateErr) return Response.json({ message: "Error al cancelar" }, { status: 500 });
      return Response.json({ success: true, message: "Venta penalizada y stock restaurado" });
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
