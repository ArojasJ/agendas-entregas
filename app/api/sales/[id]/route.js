import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { getPanelSession } from "@/lib/panelAuth";
import { editarVenta, ErrorDeEdicion } from "@/lib/editarVenta";
import { sincronizarCajasDelCliente } from "@/lib/ubicaciones";
import { comoQuedanTrasCancelar } from "@/lib/paquetes";

// Corregir una venta mueve inventario y dinero: la repartidora no entra.
const PUEDEN_EDITAR = ["admin", "worker"];


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
        clients ( id, name, instagram, phone, box_1, box_2 ),
        staff ( display_name ),
        sale_items (
          id,
          quantity,
          unit_price,
          product_id,
          variant_id,
          delivery_status,
          delivered_at,
          delivered_by_name,
          paquete_booking_id,
          ubicacion,
          caja,
          resolucion,
          products ( id, name, barcode, image_url ),
          product_variants ( id, name, option_type )
        ),
        payments (
          id,
          amount,
          created_at,
          pos_cut_id
        ),
        pos_cuts ( created_at )
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

    if (action === 'edit') {
      if (!PUEDEN_EDITAR.includes(session.role)) {
        return Response.json({ message: "No autorizado para editar ventas" }, { status: 403 });
      }
      try {
        const r = await editarVenta({
          saleId: id,
          items: body.items,
          discount: body.discount,
          resolucion: body.resolucion || {},
          session,
        });
        return Response.json(r);
      } catch (e) {
        if (e instanceof ErrorDeEdicion) {
          return Response.json({ message: e.message }, { status: e.status });
        }
        console.error("Error al editar la venta " + id + ":", e);
        return Response.json({ message: "No se pudo editar la venta." }, { status: 500 });
      }
    }

    if (action === 'cancel_forfeit') {
      const { data: sale, error: saleErr } = await supabase
        .from("sales")
        .select("status, down_payment, total, client_id, ubicacion, caja, sale_items(product_id, variant_id, quantity), payments(amount)")
        .eq("id", id)
        .single();

      if (saleErr || !sale) return Response.json({ message: "Venta no encontrada" }, { status: 404 });
      if (sale.status === 'cancelled') return Response.json({ message: "La venta ya está cancelada" }, { status: 400 });

      // Dónde estaba guardada, antes de cancelarla, para poder decir qué pasó con esa caja.
      const cajaQueOcupaba = sale.ubicacion === "caja" ? sale.caja : null;

      // Restaurar stock
      for (let item of sale.sale_items) {
        if (item.variant_id) {
          const { data: v } = await supabase.from("product_variants").select("stock").eq("id", item.variant_id).single();
          if (v) await supabase.from("product_variants").update({ stock: v.stock + item.quantity }).eq("id", item.variant_id);
        } else {
          const { data: product } = await supabase.from("products").select("stock").eq("id", item.product_id).single();
          if (product) await supabase.from("products").update({ stock: product.stock + item.quantity }).eq("id", item.product_id);
        }
      }

      // El 15% de penalización se queda el negocio y entra al corte, como siempre.
      // Lo que la clienta pagó de más se le DEVUELVE EN EFECTIVO: antes se le quedaba
      // apuntado como saldo a favor, y eso se quitó. Nadie lo usaba nunca —ni una sola
      // venta se pagó con saldo— y mientras tanto el sistema le prometía a la clienta
      // un dinero que en la práctica se le entregaba a mano.
      //
      // El monto se sigue calculando y devolviendo en la respuesta: es lo que hay que
      // sacar del cajón, y no decirlo sería peor que apuntarlo.
      const totalPagado = Number(sale.down_payment) + (sale.payments || []).reduce((s, p) => s + Number(p.amount), 0);
      const penalty = totalPagado > 0 ? Math.round(Number(sale.total) * 0.15 * 100) / 100 : 0;
      const aDevolver = Math.max(0, Math.round((totalPagado - penalty) * 100) / 100);

      // Actualizar venta
      const { error: updateErr } = await supabase.from("sales")
        .update({ status: 'cancelled', penalty_amount: penalty })
        .eq("id", id);
      if (updateErr) return Response.json({ message: "Error al cancelar" }, { status: 500 });

      // La mercancía cancelada vuelve a la tienda, así que deja de ocupar su lugar.
      // Esto no se hacía: la caja se quedaba anotada en la ficha aunque estuviera
      // vacía. Y como en esa misma caja puede quedar mercancía de otras compras que
      // NO se cancelaron, se devuelve cómo quedó todo para preguntarlo en pantalla.
      let cajas = null;
      if (sale.client_id) {
        try {
          await supabase.from("sales").update({ ubicacion: null, caja: null }).eq("id", id);
          await sincronizarCajasDelCliente(sale.client_id);
          cajas = await comoQuedanTrasCancelar(sale.client_id, cajaQueOcupaba);
        } catch (e) {
          console.error("No se pudieron recalcular las cajas al cancelar " + id + ":", e);
        }
      }

      return Response.json({ success: true, penalty, aDevolver, cajas, message: "Venta penalizada y stock restaurado" });
    }

    // Dejar constancia de que ya se le entregó en efectivo lo que pagó de más. El
    // monto NO se guarda: se calcula de la venta y así se queda. Guardarlo en cero
    // para "cerrarlo" habría significado cambiar lo que la clienta pagó.
    if (action === 'marcar_devuelto' || action === 'deshacer_devuelto') {
      const { data: venta } = await supabase
        .from("sales").select("id, status").eq("id", id).single();
      if (!venta) return Response.json({ message: "Venta no encontrada" }, { status: 404 });
      if (venta.status !== 'cancelled') {
        return Response.json({ message: "Esta venta no está cancelada" }, { status: 409 });
      }
      const devolver = action === 'marcar_devuelto';
      const { error } = await supabase.from("sales").update({
        devuelto_at: devolver ? new Date().toISOString() : null,
        devuelto_por_staff_id: devolver && session.staffId ? String(session.staffId) : null,
        devuelto_por_name: devolver ? (session.displayName || session.username || null) : null,
      }).eq("id", id);
      if (error) {
        console.error("Error al marcar la devolución de " + id + ":", error);
        return Response.json({ message: "No se pudo guardar" }, { status: 500 });
      }
      return Response.json({ success: true, devuelto: devolver });
    }

    if (action === 'revert_cancel') {
      const { data: sale, error: saleErr } = await supabase
        .from("sales")
        .select("status, down_payment, total, client_id, penalty_amount, sale_items(product_id, variant_id, quantity), payments(amount)")
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

      // Antes aquí se le quitaba el saldo a favor que la cancelación le había
      // acreditado. Ya no se acredita ninguno, así que no hay nada que quitar: lo que
      // se le devolvió fue efectivo, y eso se vuelve a cobrar en persona.

      const originalStatus = Number(sale.down_payment) < Number(sale.total) ? 'credit' : 'paid';
      const { error: updateErr } = await supabase.from("sales")
        .update({ status: originalStatus, penalty_amount: null })
        .eq("id", id);
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
