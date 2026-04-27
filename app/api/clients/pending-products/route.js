import { supabase } from "@/lib/supabaseClient";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const instagram = searchParams.get("instagram");

  if (!instagram) {
    return Response.json({ message: "Falta instagram" }, { status: 400 });
  }

  try {
    const igClean = instagram.replace(/^@/, '').trim();

    // 1. Obtener al cliente para tener su ID si es posible (pero usamos IG para bookings)
    const { data: client } = await supabase
      .from("clients")
      .select("id")
      .or(`instagram.ilike.${igClean},instagram.ilike.@${igClean}`)
      .single();

    // 2. Obtener todos los productos vendidos a este cliente que NO estén entregados
    let salesQuery = supabase.from("sales").select(`
      id,
      status,
      total,
      down_payment,
      sale_items (
        id,
        quantity,
        delivery_status,
        products ( name )
      )
    `);

    if (client) {
      salesQuery = salesQuery.eq("client_id", client.id);
    } else {
      // Si no hay cliente formal, intentamos por IG (aunque las ventas suelen tener client_id)
      return Response.json({ products: "" });
    }

    const { data: sales, error: salesError } = await salesQuery;
    if (salesError) throw salesError;

    // Consolidar productos vendidos
    const soldItems = {};
    sales?.forEach(sale => {
      sale.sale_items?.forEach(item => {
        const name = item.products?.name;
        if (name) {
          soldItems[name] = (soldItems[name] || 0) + item.quantity;
        }
      });
    });

    // 3. Obtener productos ya entregados en bookings
    const { data: deliveredBookings } = await supabase
      .from("bookings")
      .select("products")
      .eq("instagram", instagram)
      .eq("delivery_status", "entregado");

    // Restar lo ya entregado (basado en texto, aproximado pero útil)
    deliveredBookings?.forEach(bk => {
      if (bk.products) {
        // Intentamos parsear "2x Producto" o "Producto"
        const lines = bk.products.split(/[\n,]/);
        lines.forEach(line => {
          const match = line.match(/(\d+)\s*[xX]\s*(.+)/);
          if (match) {
            const qty = parseInt(match[1]);
            const name = match[2].trim();
            if (soldItems[name]) soldItems[name] -= qty;
          } else {
            const name = line.trim();
            if (soldItems[name]) soldItems[name] -= 1;
          }
        });
      }
    });

    // 4. Formatear la lista final
    const finalProducts = [];
    sales?.forEach(sale => {
      const debt = sale.status === 'paid' ? 0 : (sale.total - sale.down_payment);
      sale.sale_items?.forEach(item => {
        // SOLO si no está entregado
        if (item.delivery_status !== 'delivered') {
          finalProducts.push({
            id: item.id,
            name: item.products?.name || "Producto desconocido",
            quantity: item.quantity,
            saleId: sale.id,
            remainingDebt: debt
          });
        }
      });
    });

    return Response.json({ pendingItems: finalProducts });

  } catch (err) {
    console.error("Error fetching pending products:", err);
    return Response.json({ message: "Error al consultar pendientes" }, { status: 500 });
  }
}
