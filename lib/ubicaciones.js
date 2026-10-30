import { supabaseAdmin as supabase } from "./supabaseAdmin";

// Una clienta deja de ocupar su lugar solo cuando ya no le queda nada guardado:
// ni entregas agendadas, ni productos comprados que todavía no se entregan.
export async function liberarSiYaNoQuedaNada(clientId) {
  const { data: cliente } = await supabase
    .from("clients")
    .select("id, instagram")
    .eq("id", clientId)
    .single();
  if (!cliente) return false;

  const { data: ventas } = await supabase
    .from("sales")
    .select("id")
    .eq("client_id", clientId)
    .not("status", "in", '("cancelled","pending_payment")');

  const ids = (ventas || []).map((v) => v.id);
  let productosPendientes = 0;
  if (ids.length > 0) {
    const { count } = await supabase
      .from("sale_items")
      .select("id", { count: "exact", head: true })
      .in("sale_id", ids)
      .or("delivery_status.neq.delivered,delivery_status.is.null");
    productosPendientes = count || 0;
  }

  let entregasPendientes = 0;
  if (cliente.instagram) {
    const ig = cliente.instagram.replace(/^@/, "");
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .or(`instagram.ilike.${ig},instagram.ilike.@${ig}`)
      .or("delivery_status.eq.pendiente,delivery_status.is.null");
    entregasPendientes = count || 0;
  }

  if (productosPendientes > 0 || entregasPendientes > 0) return false;

  await supabase.from("clients").update({ box_1: null, box_2: null }).eq("id", clientId);
  if (ids.length > 0) {
    await supabase
      .from("sales")
      .update({ ubicacion: null, caja: null })
      .in("id", ids)
      .not("ubicacion", "is", null);
  }
  return true;
}

// Una venta a crédito cuyos productos ya salieron todos queda liquidada, igual que
// cuando se marca la entrega desde el panel de entregas.
export async function liquidarSiYaSalioTodo(saleId) {
  const { data: venta } = await supabase
    .from("sales")
    .select("id, total, status")
    .eq("id", saleId)
    .single();
  if (!venta || venta.status !== "credit") return false;

  const { count } = await supabase
    .from("sale_items")
    .select("id", { count: "exact", head: true })
    .eq("sale_id", saleId)
    .or("delivery_status.neq.delivered,delivery_status.is.null");

  if ((count || 0) > 0) return false;

  await supabase
    .from("sales")
    .update({ status: "paid", down_payment: venta.total })
    .eq("id", saleId);
  return true;
}
