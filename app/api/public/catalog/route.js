import { supabase } from "@/lib/supabaseClient";

export async function GET() {
  try {
    const allProducts = [];
    let from = 0;
    const pageSize = 500;

    while (true) {
      const { data, error } = await supabase
        .from("products")
        .select("id, name, category, price, image_url, images, description, stock, product_variants(id, name, price, stock, image_url, images)")
        .order("category", { ascending: true })
        .order("name", { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        console.error(error);
        return Response.json({ message: "Error al cargar catálogo" }, { status: 500 });
      }

      if (!data || data.length === 0) break;
      allProducts.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    // Filtrar: mostrar solo productos con stock disponible
    const available = allProducts.filter(p => {
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
