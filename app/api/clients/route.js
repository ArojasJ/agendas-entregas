import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { getPanelSession } from "@/lib/panelAuth";
import { cajasDeTexto, cajasATexto } from "@/lib/constants";
import { duenosDeCajas } from "@/lib/ubicaciones";

// Las cajas llegan escritas a mano y pueden venir varias juntas ("19, 42"). Se leen
// todas, se avisa de las que ya son de alguien, y se guardan juntas en un solo campo.
async function revisarCajas({ box_1, box_2, exceptoClientId = null }) {
  const cajas = cajasDeTexto(box_1, box_2);
  const duenos = await duenosDeCajas(cajas, exceptoClientId);
  const choques = [...duenos.entries()].map(
    ([n, c]) => `La caja ${n} ya la usa ${c.instagram || c.name || "otra clienta"}`
  );
  return { cajas, choques };
}


export async function GET(req) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  const checkBox = searchParams.get("checkBox");
  const excludeId = searchParams.get("excludeId");

  if (checkBox) {
    const duenos = await duenosDeCajas(cajasDeTexto(checkBox), excludeId || null);
    return Response.json({
      conflicts: [...duenos.entries()].map(([caja, c]) => ({
        caja, id: c.id, name: c.name, instagram: c.instagram,
      })),
    });
  }

  if (id) {
    // Historial de ventas por cliente (paginado)
    const allSales = [];
    let from = 0;
    const pageSize = 500;
    while (true) {
      const { data, error } = await supabase
        .from("sales")
        .select(`*, payments ( amount, created_at ), sale_items ( quantity, unit_price, products (name) )`)
        .eq("client_id", id)
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) return Response.json({ message: "Error al leer historial: " + error.message }, { status: 500 });
      if (!data || data.length === 0) break;
      allSales.push(...data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return Response.json({ sales: allSales });
  }

  // Traer todos los clientes (paginado)
  const allClients = [];
  let from = 0;
  const pageSize = 500;
  while (true) {
    const { data, error } = await supabase
      .from("clients")
      .select("*, staff(display_name)")
      .order("name", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) {
      console.error(error);
      return Response.json({ message: "Error al leer clientes: " + error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    allClients.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return Response.json({ clients: allClients });
}

export async function POST(req) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { name, instagram, phone, box_1, box_2 } = body;

    if (!instagram && !phone) {
      return Response.json({ message: "Ingresa al menos Instagram o teléfono." }, { status: 400 });
    }

    let finalInstagram = instagram ? instagram.trim() : null;
    if (finalInstagram && !finalInstagram.startsWith("@")) {
      finalInstagram = `@${finalInstagram}`;
    }

    const cleanIg = finalInstagram ? finalInstagram.replace(/^@/, '') : null;
    
    // Validar conflictos de caja
    const { cajas: cajasNuevas, choques } = await revisarCajas({ box_1, box_2 });
    if (choques.length > 0) {
      return Response.json({ message: choques.join(" · ") }, { status: 409 });
    }

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
        box_1: cajasATexto(cajasNuevas),
        box_2: null,
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

    // Validar conflictos de caja
    const { cajas: cajasEditadas, choques: choquesP } =
      await revisarCajas({ box_1, box_2, exceptoClientId: id });
    if (choquesP.length > 0) {
      return Response.json({ message: choquesP.join(" · ") }, { status: 409 });
    }

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
    // Las cajas se normalizan juntas en el primer campo, vengan como vengan escritas
    if (box_1 !== undefined || box_2 !== undefined) {
      updateData.box_1 = cajasATexto(cajasEditadas);
      updateData.box_2 = null;
    }

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
