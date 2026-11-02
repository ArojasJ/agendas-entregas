import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { getPanelSession } from "@/lib/panelAuth";
import { guardarUbicacion, estanEnBodega, anotarEnBitacora } from "@/lib/ubicaciones";
import { traerTodo } from "@/lib/paginar";


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

  // Traer las 2734 ventas con todo lo anidado son ~2 MB y 6 segundos, así que por
  // omisión se entregan las más recientes. Lo que antes se cortaba en silencio
  // —1734 ventas invisibles y los filtros buscando solo sobre lo cargado— ahora se
  // alcanza filtrando por fecha o cliente, que van al servidor.
  const desde = searchParams.get("desde");
  const hasta = searchParams.get("hasta");
  const busca = (searchParams.get("q") || "").trim();
  const hayFiltro = !!(desde || hasta || busca);
  const TOPE_SIN_FILTRO = 600;

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
      ),
      payments ( amount, pos_cut_id )
    `);

  if (statusFilter) query = query.eq("status", statusFilter);
  if (desde) query = query.gte("created_at", desde);
  if (hasta) query = query.lte("created_at", hasta + "T23:59:59.999Z");

  query = query.order("created_at", { ascending: false });
  if (!hayFiltro) query = query.limit(TOPE_SIN_FILTRO);

  const { data, error } = await query;
  if (error) {
    console.error(error);
    return Response.json({ message: "Error al leer ventas." }, { status: 500 });
  }

  let sales = data || [];

  // Por cliente se filtra aquí: PostgREST no busca sobre una tabla relacionada
  // sin volver obligatoria la relación, y hay ventas de mostrador sin cliente.
  if (busca) {
    const q = busca.toLowerCase().replace(/^@/, "");
    sales = sales.filter((s) =>
      (s.clients?.instagram || "").toLowerCase().replace(/^@/, "").includes(q) ||
      (s.clients?.name || "").toLowerCase().includes(q)
    );
  }

  // El ingreso se calcula sobre TODAS las ventas sin corte, no sobre las que se
  // alcanzaron a cargar: antes dependía de que las pendientes cupieran en la página.
  const sinCorte = await traerTodo(() => supabase
    .from("sales")
    .select("down_payment, status, payments(amount, pos_cut_id)")
    .is("pos_cut_id", null));

  let totalCaja = 0;
  for (const v of sinCorte) {
    if (v.status === "catalog_pending" || v.status === "pending_payment" || v.status === "cancelled") continue;
    totalCaja += Number(v.down_payment) || 0;
  }
  const abonos = await traerTodo(() => supabase
    .from("payments").select("amount").is("pos_cut_id", null));
  for (const a of abonos) totalCaja += Number(a.amount) || 0;

  return Response.json({
    sales,
    totalCaja: Math.round(totalCaja * 100) / 100,
    acotado: !hayFiltro && sales.length >= TOPE_SIN_FILTRO,
  });
}

export async function POST(req) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { client_id, total, discount, payment_method, status, down_payment, credit_days, items, saldo_applied, ubicacion } = body;

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
      d.setDate(d.getDate() + days - 1);
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
        // Revertir la venta si falla la inserción de un item
        await supabase.from("sales").delete().eq("id", saleId);
        return Response.json({ message: "Error al registrar productos de la venta. Intenta de nuevo." }, { status: 500 });
      }

      // Descontar inventario (gte previene stock negativo por peticiones concurrentes)
      if (item.variant_id) {
        const { data: variant } = await supabase
          .from("product_variants").select("stock").eq("id", item.variant_id).single();
        if (variant) {
          await supabase.from("product_variants")
            .update({ stock: Math.max(0, variant.stock - item.quantity) })
            .eq("id", item.variant_id).gte("stock", item.quantity);
        }
      } else {
        const { data: product } = await supabase
          .from("products").select("stock").eq("id", item.product_id).single();
        if (product) {
          await supabase.from("products")
            .update({ stock: Math.max(0, product.stock - item.quantity) })
            .eq("id", item.product_id).gte("stock", item.quantity);
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

    // Dónde quedó guardada físicamente. Si se eligió juntar, arrastra lo anterior.
    if (ubicacion?.tipo === "caja" || ubicacion?.tipo === "estante") {
      try {
        await guardarUbicacion({
          saleId,
          tipo: ubicacion.tipo,
          caja: ubicacion.caja,
          aMover: ubicacion.aMover || [],
        });
      } catch (e) {
        // La venta ya está hecha; perder la ubicación no debe tumbarla
        console.error("No se pudo guardar la ubicación de la venta " + saleId + ":", e);
      }
    }

    // Vendiendo fuera de la bodega nadie puede tomar el producto y guardarlo en ese
    // momento, así que el movimiento queda anotado para hacerlo al llegar.
    //
    // El interruptor dice que la administradora anda fuera, no el negocio entero: las
    // trabajadoras siguen en la tienda, junto a las cajas, y guardan el producto al
    // momento de cobrarlo. Anotarles tarea les pedía hacer algo que ya estaba hecho.
    try {
      if (session.role === "admin" && !(await estanEnBodega())) {
        await anotarEnBitacora({ saleId, clientId: client_id });
      }
    } catch (e) {
      console.error("No se pudo anotar en la bitácora la venta " + saleId + ":", e);
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
  // Borrar una venta se lleva sus abonos por delante: no es para el repartidor.
  if (!["admin", "worker"].includes(session.role)) {
    return Response.json({ message: "No autorizado para borrar ventas" }, { status: 403 });
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
