import { supabase } from "@/lib/supabaseClient";

function getPanelSession(req) {
  const headerToken = req.headers.get("x-panel-token");
  const secret = process.env.PANEL_TOKEN_SECRET || "agenda_super_secreta_123";
  if (!headerToken) return null;
  try {
    const decoded = Buffer.from(headerToken, "base64").toString("utf8");
    const [json, sig] = decoded.split("|");
    if (sig !== secret) return null;
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

export async function GET(req) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ message: "ID de producto requerido" }, { status: 400 });
  }

  try {
    // Obtener información del producto
    const { data: product, error: productError } = await supabase
      .from("products")
      .select("*")
      .eq("id", id)
      .single();

    if (productError) {
      return Response.json({ message: "Producto no encontrado" }, { status: 404 });
    }

    // Obtener los items vendidos de este producto, unidos con la info de la venta y el cliente
    const { data: soldItems, error: itemsError } = await supabase
      .from("sale_items")
      .select(`
        quantity,
        sale_id,
        sales (
          created_at,
          clients (
            instagram,
            name
          )
        )
      `)
      .eq("product_id", id);

    if (itemsError) {
      console.error(itemsError);
      return Response.json({ message: "Error al obtener estadísticas de ventas" }, { status: 500 });
    }

    // Calcular totales
    let totalUnitsSold = 0;
    const salesList = [];

    if (soldItems) {
      for (const item of soldItems) {
        totalUnitsSold += Number(item.quantity || 0);
        
        // Formatear la lista de ventas
        if (item.sales) {
          salesList.push({
            sale_id: item.sale_id,
            quantity: item.quantity,
            date: item.sales.created_at,
            client_instagram: item.sales.clients?.instagram || null,
            client_name: item.sales.clients?.name || "Público General"
          });
        }
      }
    }

    // Ordenar las ventas de más reciente a más antigua
    salesList.sort((a, b) => new Date(b.date) - new Date(a.date));

    // El stock inicial estimado es el stock actual + lo que ya se vendió
    const estimatedInitialStock = Number(product.stock) + totalUnitsSold;

    return Response.json({
      product: {
        created_at: product.created_at,
        current_stock: product.stock
      },
      stats: {
        total_sales_count: salesList.length,
        total_units_sold: totalUnitsSold,
        estimated_initial_stock: estimatedInitialStock
      },
      sales_history: salesList
    });
  } catch (error) {
    console.error(error);
    return Response.json({ message: "Error en el servidor" }, { status: 500 });
  }
}
