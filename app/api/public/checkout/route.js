import { supabase } from "@/lib/supabaseClient";

export async function POST(req) {
  try {
    const body = await req.json();
    const { cart, clientData } = body;

    if (!cart || cart.length === 0) {
      return Response.json({ message: "El carrito está vacío." }, { status: 400 });
    }

    if (!clientData || !clientData.name || !clientData.phone || !clientData.instagram) {
      return Response.json({ message: "Faltan datos obligatorios del cliente." }, { status: 400 });
    }

    // 1. Validar stock y recalcular total en el servidor
    let total = 0;
    const itemsToInsert = [];
    
    for (let item of cart) {
      if (item.variant_id) {
        const { data: variant } = await supabase
          .from("product_variants")
          .select("price, stock")
          .eq("id", item.variant_id)
          .single();

        if (!variant || variant.stock < item.quantity) {
          return Response.json({ message: `No hay suficiente stock para una de las opciones seleccionadas.` }, { status: 400 });
        }

        total += Number(variant.price) * item.quantity;
        itemsToInsert.push({
          product_id: item.id,
          variant_id: item.variant_id,
          quantity: item.quantity,
          unit_price: variant.price,
          delivery_status: "pending"
        });
      } else {
        const { data: product } = await supabase
          .from("products")
          .select("price, stock")
          .eq("id", item.id)
          .single();

        if (!product || product.stock < item.quantity) {
          return Response.json({ message: `No hay suficiente stock para uno de los productos.` }, { status: 400 });
        }

        total += Number(product.price) * item.quantity;
        itemsToInsert.push({
          product_id: item.id,
          quantity: item.quantity,
          unit_price: product.price,
          delivery_status: "pending"
        });
      }
    }

    // 2. Buscar o crear cliente (queries separadas para evitar inyección en .or())
    let clientId = null;
    const cleanIg = clientData.instagram.replace('@', '').trim();

    const { data: byIg } = await supabase
      .from("clients").select("id").ilike("instagram", cleanIg).limit(1).maybeSingle();
    const { data: byIgAt } = !byIg ? await supabase
      .from("clients").select("id").ilike("instagram", `@${cleanIg}`).limit(1).maybeSingle()
      : { data: null };
    const { data: byPhone } = !byIg && !byIgAt ? await supabase
      .from("clients").select("id").eq("phone", clientData.phone).limit(1).maybeSingle()
      : { data: null };

    const existingClient = byIg || byIgAt || byPhone;

    if (existingClient) {
      clientId = existingClient.id;
    } else {
      const { data: newClient, error: clientErr } = await supabase
        .from("clients")
        .insert([{
          name: clientData.name,
          instagram: cleanIg,
          phone: clientData.phone
        }])
        .select()
        .single();

      if (clientErr || !newClient) {
        console.error("No se pudo crear el cliente:", clientErr);
        return Response.json({ message: "No se pudo registrar el cliente. Intenta de nuevo." }, { status: 500 });
      }
      clientId = newClient.id;
    }

    // 3. Crear venta
    const { data: newSale, error: saleError } = await supabase
      .from("sales")
      .insert([{
        client_id: clientId,
        total: total,
        down_payment: 0,
        discount: 0,
        status: 'catalog_pending',
        payment_method: 'pendiente'
      }])
      .select()
      .single();

    if (saleError) throw saleError;

    // 4. Insertar items y descontar stock
    for (let item of itemsToInsert) {
      item.sale_id = newSale.id;
      
      await supabase.from("sale_items").insert([item]);

      // Descontar inventario (gte previene que stock baje de 0 por peticiones concurrentes)
      if (item.variant_id) {
        const { data: v } = await supabase.from("product_variants").select("stock").eq("id", item.variant_id).single();
        if (v) await supabase.from("product_variants")
          .update({ stock: Math.max(0, v.stock - item.quantity) })
          .eq("id", item.variant_id).gte("stock", item.quantity);
      } else {
        const { data: p } = await supabase.from("products").select("stock").eq("id", item.product_id).single();
        if (p) await supabase.from("products")
          .update({ stock: Math.max(0, p.stock - item.quantity) })
          .eq("id", item.product_id).gte("stock", item.quantity);
      }
    }

    return Response.json({ message: "Pedido registrado exitosamente.", sale: newSale });
    
  } catch (err) {
    console.error("Error en checkout:", err);
    return Response.json({ message: "Error en el servidor al procesar pedido." }, { status: 500 });
  }
}
