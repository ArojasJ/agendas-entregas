import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabase as adminSupabase } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";


export async function GET(request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ message: "No autorizado" }, { status: 401 });
  }

  // 1. Traer cliente local
  const { data: client, error: clientErr } = await adminSupabase
    .from("clients")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  if (clientErr || !client) {
    return NextResponse.json({ message: "Cliente no encontrado" }, { status: 404 });
  }

  // 2. Traer historial de ventas de este cliente
  const { data: sales, error: salesErr } = await adminSupabase
    .from("sales")
    .select(`
      *,
      payments ( amount, created_at ),
      sale_items ( id, quantity, unit_price, delivery_status, products (id, name, image_url) )
    `)
    .eq("client_id", client.id)
    .order("created_at", { ascending: false });

  if (salesErr) {
    return NextResponse.json({ message: "Error al cargar historial" }, { status: 500 });
  }

  // 3. Traer entregas (bookings) para mostrar su estado, usando su instagram y teléfono como fallback, 
  // o ideally filtrando por instagram
  const { data: bookings, error: bookingsErr } = await adminSupabase
    .from("bookings")
    .select("*")
    .eq("instagram", client.instagram)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    client,
    sales: sales || [],
    bookings: bookings || []
  });
}
