import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function GET() {
  try {
    const allProducts = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error } = await supabase
        .from("products")
        .select("category, stock, product_variants(stock)")
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      allProducts.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }

    const { data: catRows } = await supabase
      .from("catalog_categories")
      .select("*")
      .order("sort_order", { ascending: true });

    const products = allProducts;

    const catMap = {};
    for (const c of catRows || []) catMap[c.name] = c;

    const catSet = new Set();
    for (const p of products || []) {
      if (!p.category) continue;
      const pvs = p.product_variants || [];
      const inStock = pvs.length > 0
        ? pvs.some(v => v.stock > 0)
        : p.stock > 0;
      if (inStock) catSet.add(p.category);
    }

    const categories = [...catSet]
      .map(name => ({
        name,
        image_url: catMap[name]?.image_url || null,
        sort_order: catMap[name]?.sort_order ?? 999,
      }))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

    return Response.json({ categories });
  } catch (err) {
    console.error(err);
    return Response.json({ categories: [] }, { status: 500 });
  }
}
