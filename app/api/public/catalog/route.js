import { supabase } from "@/lib/supabaseClient";

export async function GET(req) {
  try {
    const { data: products, error } = await supabase
      .from("products")
      .select("id, name, category, price, image_url, description, stock")
      .gt("stock", 0)
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error(error);
      return Response.json({ message: "Error al cargar catálogo" }, { status: 500 });
    }

    return Response.json({ products: products || [] });
  } catch (err) {
    console.error(err);
    return Response.json({ message: "Error interno del servidor" }, { status: 500 });
  }
}
