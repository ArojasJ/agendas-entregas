import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { crearOrden } from "@/lib/mercadopago";
import { VENTA_ESPERANDO_PAGO, MINUTOS_RESERVA_PAGO } from "@/lib/constants";

// Checkout de la tienda en línea: aparta el inventario, crea la venta esperando pago
// y devuelve a dónde mandar a la clienta para cobrarle.
//
// Los precios se releen de la base; lo que manda el navegador solo dice qué y cuánto,
// nunca a qué precio.
export async function POST(req) {
  let ventaId = null;
  const apartado = [];

  try {
    const { cart, clientData } = await req.json();

    if (!Array.isArray(cart) || cart.length === 0) {
      return Response.json({ message: "El carrito está vacío." }, { status: 400 });
    }
    if (!clientData?.name || !clientData?.phone || !clientData?.instagram) {
      return Response.json({ message: "Faltan datos obligatorios." }, { status: 400 });
    }

    // 1. Precios y existencias desde la base
    let total = 0;
    const items = [];
    const paraVender = [];

    for (const linea of cart) {
      const cantidad = Math.max(1, Number(linea.quantity) || 1);

      if (linea.variant_id) {
        const { data: v } = await supabase
          .from("product_variants")
          .select("id, name, price, stock, products(name)")
          .eq("id", linea.variant_id)
          .single();
        if (!v || v.stock < cantidad) {
          return Response.json({ message: "Una de las opciones ya no tiene existencias." }, { status: 409 });
        }
        total += Number(v.price) * cantidad;
        items.push({ title: `${v.products?.name || "Producto"} ${v.name || ""}`.trim(), unit_price: v.price, quantity: cantidad });
        paraVender.push({ product_id: linea.id, variant_id: v.id, quantity: cantidad, unit_price: v.price });
      } else {
        const { data: p } = await supabase
          .from("products")
          .select("id, name, price, stock")
          .eq("id", linea.id)
          .single();
        if (!p || p.stock < cantidad) {
          return Response.json({ message: "Uno de los productos ya no tiene existencias." }, { status: 409 });
        }
        total += Number(p.price) * cantidad;
        items.push({ title: p.name, unit_price: p.price, quantity: cantidad });
        paraVender.push({ product_id: p.id, variant_id: null, quantity: cantidad, unit_price: p.price });
      }
    }

    // 2. Cliente
    const ig = clientData.instagram.replace(/^@/, "").trim();
    const { data: porIg } = await supabase
      .from("clients").select("id").ilike("instagram", ig).limit(1).maybeSingle();
    const { data: porIgAt } = !porIg
      ? await supabase.from("clients").select("id").ilike("instagram", `@${ig}`).limit(1).maybeSingle()
      : { data: null };

    let clientId = (porIg || porIgAt)?.id;
    if (!clientId) {
      const { data: nuevo, error } = await supabase
        .from("clients")
        .insert([{ name: clientData.name, instagram: ig, phone: clientData.phone }])
        .select("id").single();
      if (error || !nuevo) {
        return Response.json({ message: "No se pudo registrar el cliente." }, { status: 500 });
      }
      clientId = nuevo.id;
    }

    // 3. Apartar el inventario antes de crear nada más. El decremento es atómico, así
    //    que si dos clientas pelean la última pieza solo una pasa de aquí.
    for (const it of paraVender) {
      const { data: ok } = it.variant_id
        ? await supabase.rpc("decrement_variant_stock", { p_variant_id: it.variant_id, p_amount: it.quantity })
        : await supabase.rpc("decrement_product_stock", { p_product_id: it.product_id, p_amount: it.quantity });

      if (!ok) {
        await devolver(apartado);
        return Response.json({ message: "Alguien se adelantó con una de las piezas. Revisa tu carrito." }, { status: 409 });
      }
      apartado.push(it);
    }

    // 4. Venta esperando pago, con vencimiento
    const vence = new Date(Date.now() + MINUTOS_RESERVA_PAGO * 60_000).toISOString();
    const { data: venta, error: errVenta } = await supabase
      .from("sales")
      .insert([{
        client_id: clientId,
        total,
        down_payment: 0,
        discount: 0,
        status: VENTA_ESPERANDO_PAGO,
        payment_method: "Pedido Web",
        expires_at: vence,
      }])
      .select("id").single();

    if (errVenta || !venta) {
      await devolver(apartado);
      return Response.json({ message: "No se pudo crear el pedido." }, { status: 500 });
    }
    ventaId = venta.id;

    const { error: errItems } = await supabase.from("sale_items").insert(
      paraVender.map((it) => ({
        sale_id: ventaId,
        product_id: it.product_id,
        variant_id: it.variant_id,
        quantity: it.quantity,
        unit_price: it.unit_price,
        delivery_status: "pending",
      }))
    );
    if (errItems) {
      await revertir(ventaId, apartado);
      return Response.json({ message: "No se pudo registrar el pedido." }, { status: 500 });
    }

    // 5. Cobro
    const { ordenId, checkoutUrl } = await crearOrden({
      ventaId,
      items,
      emailComprador: clientData.email || `${ig}@noreste.cliente`,
      totalEsperado: total,
    });

    return Response.json({ ventaId, ordenId, checkoutUrl, total, venceEn: vence });
  } catch (err) {
    console.error("Error en checkout de pago:", err);
    await revertir(ventaId, apartado);
    return Response.json({ message: "No se pudo iniciar el pago. Intenta de nuevo." }, { status: 500 });
  }
}

// Si algo truena después de apartar, el inventario tiene que volver de inmediato en vez
// de esperar media hora al barrido.
async function devolver(apartado) {
  for (const it of apartado) {
    if (it.variant_id) {
      const { data: v } = await supabase.from("product_variants").select("stock").eq("id", it.variant_id).single();
      if (v) await supabase.from("product_variants").update({ stock: v.stock + it.quantity }).eq("id", it.variant_id);
    } else {
      const { data: p } = await supabase.from("products").select("stock").eq("id", it.product_id).single();
      if (p) await supabase.from("products").update({ stock: p.stock + it.quantity }).eq("id", it.product_id);
    }
  }
}

async function revertir(ventaId, apartado) {
  if (ventaId) {
    await supabase.from("sale_items").delete().eq("sale_id", ventaId);
    await supabase.from("sales").delete().eq("id", ventaId);
  }
  await devolver(apartado);
}
