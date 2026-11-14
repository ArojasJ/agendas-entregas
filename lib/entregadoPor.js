// Quién marcó entregado un producto.
//
// El CUÁNDO lo pone la base de datos sola (disparador trg_marcar_cuando_se_entrego),
// porque hay demasiados lugares que marcan entregado como para confiar en que todos
// se acuerden. El QUIÉN no lo puede saber la base: solo la aplicación sabe quién está
// usando el panel, así que va aquí, en un solo lugar que todos llaman.

// Los campos de autoría, listos para pegar en cualquier .update() que marque entregado.
// Mismo criterio que la bitácora y los movimientos de inventario: el nombre que se
// enseña, y si no hay, el usuario con el que entró.
export function selloDeEntrega(session) {
  return {
    delivered_by_staff_id: session?.staffId ? String(session.staffId) : null,
    delivered_by_name: session?.displayName || session?.username || null,
  };
}

// Cómo nace un producto recién vendido.
//
// Si la venta tiene clienta, nace pendiente: se le va a guardar en su caja o en el
// estante hasta que pase por él. Pero una venta de mostrador no tiene a quién
// guardarle nada —la persona llega, paga y se va con el producto en la mano—, así que
// dejarlo pendiente lo vuelve un pendiente eterno: nadie lo va a marcar nunca, porque
// no hay entrega que hacer. En el mostrador la venta Y la entrega son el mismo acto.
export function comoNaceElProducto(clientId, session) {
  if (clientId) return { delivery_status: "pending" };
  return {
    delivery_status: "delivered",
    // Aquí la fecha sí la pone la aplicación. El disparador solo corre al ACTUALIZAR
    // un renglón, y esto es un alta: sin esto quedaría entregado y sin fecha. El
    // momento es el de la venta, que es justo cuando se lo llevó.
    delivered_at: new Date().toISOString(),
    ...selloDeEntrega(session),
  };
}

// Marcar entregado, con su firma. Devuelve cuántos renglones se tocaron.
export async function marcarEntregados(supabase, ids, session) {
  const limpios = (ids || []).filter(Boolean);
  if (limpios.length === 0) return 0;

  const { count, error } = await supabase
    .from("sale_items")
    .update({ delivery_status: "delivered", ...selloDeEntrega(session) }, { count: "exact" })
    .in("id", limpios)
    // Solo lo que todavía no estaba entregado: sin esto, volver a guardar una entrega
    // ya hecha reescribiría la firma y perderíamos quién la entregó de verdad.
    .or("delivery_status.neq.delivered,delivery_status.is.null");

  if (error) throw error;
  return count || 0;
}

// Lo mismo pero para una venta completa, cuando no se sabe qué renglones son.
export async function marcarEntregadosDeLaVenta(supabase, saleId, session) {
  if (!saleId) return 0;

  const { count, error } = await supabase
    .from("sale_items")
    .update({ delivery_status: "delivered", ...selloDeEntrega(session) }, { count: "exact" })
    .eq("sale_id", saleId)
    .or("delivery_status.neq.delivered,delivery_status.is.null");

  if (error) throw error;
  return count || 0;
}

// Revertir una entrega. La fecha y la firma las borra el disparador: dejaron de ser
// ciertas, y una firma vieja colgando sería peor que no tener ninguna.
export async function desmarcarEntregados(supabase, ids) {
  const limpios = (ids || []).filter(Boolean);
  if (limpios.length === 0) return 0;

  const { count, error } = await supabase
    .from("sale_items")
    .update({ delivery_status: "pending" }, { count: "exact" })
    .in("id", limpios);

  if (error) throw error;
  return count || 0;
}
