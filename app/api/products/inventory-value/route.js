import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { getPanelSession } from "@/lib/panelAuth";

// El total se calcula aquí y no en el navegador porque es información que solo
// debe ver admin: mandar los costos al cliente y ocultar el recuadro dejaría el
// dato a la vista de cualquiera que abra las herramientas de desarrollo.
export async function GET(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== "admin") {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }

  const productos = [];
  let desde = 0;
  const pagina = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("products")
      .select("stock, cost, price, product_variants(stock, cost, price)")
      .range(desde, desde + pagina - 1);

    if (error) {
      console.error("Error al calcular valor de inventario:", error);
      return Response.json({ message: "Error al calcular el inventario" }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    productos.push(...data);
    if (data.length < pagina) break;
    desde += pagina;
  }

  let costoTotal = 0;
  let ventaTotal = 0;
  let unidades = 0;
  let sinCosto = 0;

  for (const p of productos) {
    // Un producto con variantes lleva el stock en ellas, no en la fila padre
    const filas = p.product_variants?.length ? p.product_variants : [p];
    for (const f of filas) {
      const stock = Number(f.stock) || 0;
      if (stock <= 0) continue;
      const costo = Number(f.cost) || 0;
      const precio = Number(f.price ?? p.price) || 0;
      if (!costo) sinCosto += stock;
      unidades += stock;
      costoTotal += costo * stock;
      ventaTotal += precio * stock;
    }
  }

  return Response.json({
    costoTotal,
    ventaTotal,
    gananciaPotencial: ventaTotal - costoTotal,
    unidades,
    unidadesSinCosto: sinCosto,
  });
}
