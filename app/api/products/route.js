import { supabase } from "@/lib/supabaseClient";

// Helper para validar token del panel (puedes reutilizar el de bookings si lo externalizas, por ahora lo copiamos para aislar)
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

async function uploadImage(base64Data, productName) {
  if (!base64Data || !base64Data.startsWith("data:image")) return base64Data;

  try {
    const [metadata, base64String] = base64Data.split(",");
    const extension = metadata.split(";")[0].split("/")[1] || "jpg";
    const buffer = Buffer.from(base64String, "base64");
    
    // Limpiar nombre del producto para el archivo
    const safeName = (productName || 'product').toLowerCase().replace(/[^a-z0-9]/g, '-');
    const path = `${Date.now()}-${safeName}.${extension}`;
    
    const { data, error } = await supabase.storage
      .from("products")
      .upload(path, buffer, {
        contentType: `image/${extension}`,
        upsert: true
      });

    if (error) {
      console.error("Error uploading to storage:", error);
      return base64Data; // Fallback
    }

    const { data: { publicUrl } } = supabase.storage
      .from("products")
      .getPublicUrl(path);

    return publicUrl;
  } catch (err) {
    console.error("Upload process error:", err);
    return base64Data;
  }
}

// GET: Obtener todos los productos
export async function GET(req) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const minimal = searchParams.get("minimal") === "true";

  const selectFields = minimal 
    ? "id, name, category, stock, barcode, cost, price, description, created_at, created_by_staff_id"
    : "*";

  const { data: products, error } = await supabase
    .from("products")
    .select(selectFields)
    .order("name", { ascending: true });

  if (error) {
    console.error("Error al obtener productos:", error);
    return Response.json({ message: "Error al leer inventario" }, { status: 500 });
  }

  // OPTIMIZACIÓN CRÍTICA: Si la imagen es Base64 (pesada), la removemos de la lista 
  // para evitar colapsar la conexión. El usuario deberá re-subirla para que sea una URL.
  const optimizedProducts = (products || []).map(p => {
    if (p.image_url && p.image_url.startsWith("data:image")) {
      return { ...p, image_url: null, _hasLegacyImage: true };
    }
    return p;
  });

  return Response.json({ products: optimizedProducts });
}

// POST: Crear un nuevo producto
export async function POST(req) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, category, stock, barcode, cost, price, image_url, description } = body;

    if (!name || cost === undefined || price === undefined) {
      return Response.json({ message: "Faltan campos obligatorios (nombre, costo, precio)." }, { status: 400 });
    }

    // Validar código de barras único
    if (barcode) {
      const { data: existing } = await supabase
        .from("products")
        .select("id, name")
        .eq("barcode", barcode)
        .single();
      
      if (existing) {
        return Response.json({ 
          message: `El código de barras ${barcode} ya está en uso por el producto: ${existing.name}` 
        }, { status: 400 });
      }
    }

    // Procesar imagen si es base64
    const finalImageUrl = await uploadImage(image_url, name);

    const { data, error } = await supabase
      .from("products")
      .insert([
        {
          name,
          category: category || "General",
          stock: Number(stock) || 0,
          barcode: barcode || null,
          cost: Number(cost),
          price: Number(price),
          image_url: finalImageUrl || null,
          description: description || null,
          created_at: new Date().toISOString(),
          created_by_staff_id: session.staffId || null
        },
      ])
      .select()
      .single();

    if (error) {
      console.error(error);
      return Response.json({ message: "No se pudo registrar el producto: " + error.message, errorDetails: error }, { status: 500 });
    }

    return Response.json({ message: "Producto registrado.", product: data });
  } catch (err) {
    console.error(err);
    return Response.json({ message: "Error en el servidor." }, { status: 500 });
  }
}

// PATCH: Actualizar producto
export async function PATCH(req) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, name, category, stock, barcode, cost, price, image_url, description } = body;

    if (!id) return Response.json({ message: "Falta id" }, { status: 400 });

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (category !== undefined) updateData.category = category;
    if (stock !== undefined) updateData.stock = Number(stock);
    if (barcode !== undefined) updateData.barcode = barcode;
    if (cost !== undefined) updateData.cost = Number(cost);
    if (price !== undefined) updateData.price = Number(price);
    if (description !== undefined) updateData.description = description;

    if (image_url !== undefined && image_url && image_url.startsWith("data:image")) {
       updateData.image_url = await uploadImage(image_url, name || id);
    } else if (image_url !== undefined) {
       updateData.image_url = image_url;
    }

    // Validar código de barras único (si cambió)
    if (barcode) {
      const { data: existing } = await supabase
        .from("products")
        .select("id, name")
        .eq("barcode", barcode)
        .neq("id", id)
        .single();
      
      if (existing) {
        return Response.json({ 
          message: `El código de barras ${barcode} ya está siendo usado por: ${existing.name}` 
        }, { status: 400 });
      }
    }

    // 1. Obtener el producto actual para ver si el stock cambió
    const { data: currentProduct } = await supabase
      .from("products")
      .select("stock")
      .eq("id", id)
      .single();

    // 2. Realizar la actualización del producto
    const { data, error } = await supabase
      .from("products")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return Response.json({ message: "Error al actualizar." }, { status: 500 });
    }

    // 3. Registrar el log de stock si la cantidad cambió
    if (stock !== undefined && currentProduct && Number(currentProduct.stock) !== Number(stock)) {
      try {
        await supabase.from("stock_logs").insert([{
          product_id: id,
          old_stock: Number(currentProduct.stock),
          new_stock: Number(stock),
          reason: 'manual_update',
          staff_id: session.staffId || null,
          created_at: new Date().toISOString()
        }]);
      } catch (logErr) {
        // Ignoramos el error si la tabla aún no existe o falla, para no romper la edición
        console.error("No se pudo registrar log de stock:", logErr);
      }
    }

    return Response.json({ message: "Actualizado.", product: data });
  } catch (err) {
    return Response.json({ message: "Error en servidor." }, { status: 500 });
  }
}

// DELETE: Borrar producto
export async function DELETE(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== 'admin') {
    return Response.json({ message: "No autorizado (requiere admin)" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) return Response.json({ message: "Falta id" }, { status: 400 });

  const { error } = await supabase.from("products").delete().eq("id", id);

  if (error) {
    return Response.json({ message: "No se pudo eliminar el producto." }, { status: 500 });
  }

  return Response.json({ message: "Producto eliminado correctamente." });
}
