import { supabase } from "@/lib/supabaseClient";

export async function GET() {
  try {
    const { data: products, error } = await supabase
      .from("products")
      .select("id, name, category, price, image_url, images, description, stock, product_variants(id, name, price, stock, image_url, images)")
      .order("category", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error(error);
      return Response.json({ message: "Error al cargar catálogo" }, { status: 500 });
    }

    // Filtrar: mostrar solo productos con stock disponible
    const available = (products || []).filter(p => {
      if (p.product_variants && p.product_variants.length > 0) {
        return p.product_variants.some(v => v.stock > 0);
      }
      return p.stock > 0;
    });

    return Response.json({ products: available });
  } catch (err) {
    console.error(err);
    return Response.json({ message: "Error interno del servidor" }, { status: 500 });
  }
}
