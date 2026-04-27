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

  if (id) {
    // Traer historial de ventas de un cliente específico
    const { data, error } = await supabase
      .from("sales")
      .select(`
        *,
        payments ( amount, created_at ),
        sale_items ( quantity, unit_price, products (name) )
      `)
      .eq("client_id", id)
      .order("created_at", { ascending: false });

    if (error) {
      return Response.json({ message: "Error al leer historial: " + error.message }, { status: 500 });
    }
    return Response.json({ sales: data || [] });
  }

  // Traer todos los clientes
  const { data: clients, error } = await supabase
    .from("clients")
    .select("*, staff(display_name)")
    .order("name", { ascending: true });

  if (error) {
    console.error(error);
    return Response.json({ message: "Error al leer clientes: " + error.message }, { status: 500 });
  }

  return Response.json({ clients: clients || [] });
}

export async function POST(req) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, instagram, phone, box_1, box_2 } = body;

    if (!name) {
      return Response.json({ message: "Falta el nombre del cliente." }, { status: 400 });
    }

    let finalInstagram = instagram ? instagram.trim() : null;
    if (finalInstagram && !finalInstagram.startsWith("@")) {
      finalInstagram = `@${finalInstagram}`;
    }

    const cleanIg = finalInstagram.replace(/^@/, '');
    
    // 1. Buscar si ya existe un cliente con este instagram (con o sin @)
    const { data: existingClients, error: searchError } = await supabase
      .from("clients")
      .select("*")
      .or(`instagram.ilike.${cleanIg},instagram.ilike.@${cleanIg}`);

    if (searchError) {
      console.error("Error buscando cliente:", searchError);
      return Response.json({ message: "Error al buscar duplicados" }, { status: 500 });
    }

    if (existingClients && existingClients.length > 0) {
      // 2. Si ya existe, lo actualizamos (suplantamos)
      const existingClient = existingClients[0];
      
      const { data: updatedClient, error: updateError } = await supabase
        .from("clients")
        .update({
          name: name,
          phone: phone || existingClient.phone
        })
        .eq("id", existingClient.id)
        .select()
        .single();

      if (updateError) {
        return Response.json({ message: "Error al actualizar cliente existente: " + updateError.message }, { status: 500 });
      }

      return Response.json({ message: "Cliente actualizado (ya existía).", client: updatedClient });
    }

    // 3. Si no existe, lo creamos
    const { data, error } = await supabase
      .from("clients")
      .insert([{ 
        name, 
        instagram: finalInstagram, 
        phone: phone || null,
        box_1: box_1 || null,
        box_2: box_2 || null,
        created_by_staff_id: session.staffId || null
      }])
      .select()
      .single();

    if (error) {
      console.error(error);
      return Response.json({ message: "No se pudo registrar el cliente: " + error.message }, { status: 500 });
    }

    return Response.json({ message: "Cliente registrado.", client: data });
  } catch (err) {
    return Response.json({ message: "Error en el servidor." }, { status: 500 });
  }
}

export async function PATCH(req) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, name, instagram, phone, box_1, box_2 } = body;

    if (!id) return Response.json({ message: "Falta id" }, { status: 400 });

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (instagram !== undefined) {
      let finalInstagram = instagram ? instagram.trim() : null;
      if (finalInstagram && !finalInstagram.startsWith("@")) {
        finalInstagram = `@${finalInstagram}`;
      }
      updateData.instagram = finalInstagram;
    }
    if (phone !== undefined) updateData.phone = phone || null;
    if (box_1 !== undefined) updateData.box_1 = box_1 || null;
    if (box_2 !== undefined) updateData.box_2 = box_2 || null;

    const { data, error } = await supabase
      .from("clients")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return Response.json({ message: "Error al actualizar: " + error.message }, { status: 500 });
    }

    return Response.json({ message: "Actualizado.", client: data });
  } catch (err) {
    return Response.json({ message: "Error en servidor." }, { status: 500 });
  }
}

export async function DELETE(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== 'admin') {
    return Response.json({ message: "No autorizado (requiere admin)" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) return Response.json({ message: "Falta id" }, { status: 400 });

  const { error } = await supabase.from("clients").delete().eq("id", id);

  if (error) {
    return Response.json({ message: "No se pudo eliminar el cliente: " + error.message }, { status: 500 });
  }

  return Response.json({ message: "Cliente eliminado correctamente." });
}
