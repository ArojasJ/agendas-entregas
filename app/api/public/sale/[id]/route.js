import { supabase } from "@/lib/supabaseClient";

export async function GET(req, { params }) {
  const { id } = await params;
  if (!id) return Response.json({ message: "ID requerido" }, { status: 400 });

  const { data: sale, error } = await supabase
    .from("sales")
    .select(`
      id,
      created_at,
      total,
      down_payment,
      status,
      payment_method,
      due_date,
      discount,
      clients ( name, instagram ),
      sale_items (
        id,
        quantity,
        unit_price,
        delivery_status,
        products ( name, image_url )
      ),
      payments ( id, amount, created_at )
    `)
    .eq("id", id)
    .single();

  if (error || !sale) {
    console.error("[public/sale] error:", error);
    return Response.json({ message: "Venta no encontrada", detail: error?.message }, { status: 404 });
  }

  return Response.json({ sale });
}
