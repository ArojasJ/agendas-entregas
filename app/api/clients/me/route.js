import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabase as adminSupabase } from "@/lib/supabaseClient";

export const dynamic = "force-dynamic";


export async function GET(request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ message: "No autorizado" }, { status: 401 });
  }

  // Buscar si el cliente ya existe en public.clients
  const { data: client, error } = await adminSupabase
    .from("clients")
    .select("*")
    .eq("auth_user_id", user.id)
    .single();

  if (error && error.code !== "PGRST116") { // PGRST116 es not found
    return NextResponse.json({ message: "Error al buscar cliente" }, { status: 500 });
  }

  return NextResponse.json({ client, user });
}

export async function POST(request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ message: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, instagram, phone } = body;

    if (!name || !instagram || !phone) {
      return NextResponse.json({ message: "Faltan datos obligatorios" }, { status: 400 });
    }

    let finalInstagram = instagram.trim();
    if (!finalInstagram.startsWith("@")) {
      finalInstagram = `@${finalInstagram}`;
    }

    const cleanIg = finalInstagram.replace(/^@/, '');

    // 1. Buscar si ya existe un cliente manual con este instagram (con o sin @)
    const { data: existingClients, error: searchError } = await adminSupabase
      .from("clients")
      .select("*")
      .or(`instagram.ilike.${cleanIg},instagram.ilike.@${cleanIg}`);

    if (searchError) {
      console.error("Error buscando cliente:", searchError);
      return NextResponse.json({ message: "Error al buscar cliente" }, { status: 500 });
    }

    if (existingClients && existingClients.length > 0) {
      // 2. Si ya existe, lo suplantamos / vinculamos
      const existingClient = existingClients[0];
      
      const { data: updatedClient, error: updateError } = await adminSupabase
        .from("clients")
        .update({
          auth_user_id: user.id,
          email: user.email,
          name: name, // Actualizamos con los datos que el usuario confirmó
          phone: phone
        })
        .eq("id", existingClient.id)
        .select()
        .single();

      if (updateError) {
        console.error("Error vinculando cliente:", updateError);
        return NextResponse.json({ message: "Error al vincular cliente existente" }, { status: 500 });
      }

      return NextResponse.json({ message: "Perfil vinculado correctamente", client: updatedClient });
    } else {
      // 3. Si no existe, lo creamos como nuevo
      const { data: newClient, error: insertError } = await adminSupabase
        .from("clients")
        .insert([{
          auth_user_id: user.id,
          email: user.email,
          name,
          instagram: finalInstagram,
          phone
        }])
        .select()
        .single();

      if (insertError) {
        console.error("Error creando cliente:", insertError);
        return NextResponse.json({ message: "Error al crear cliente" }, { status: 500 });
      }

      return NextResponse.json({ message: "Perfil completado", client: newClient });
    }

  } catch (err) {
    console.error("Error catch POST:", err);
    return NextResponse.json({ message: "Error interno" }, { status: 500 });
  }
}

export async function PATCH(request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ message: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, instagram, phone } = body;

    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (instagram !== undefined) updateData.instagram = instagram.startsWith("@") ? instagram : `@${instagram}`;
    if (phone !== undefined) updateData.phone = phone;

    const { data: updatedClient, error: updateError } = await adminSupabase
      .from("clients")
      .update(updateData)
      .eq("auth_user_id", user.id)
      .select()
      .single();

    if (updateError) {
      console.error(updateError);
      return NextResponse.json({ message: "Error al actualizar perfil" }, { status: 500 });
    }

    return NextResponse.json({ message: "Perfil actualizado", client: updatedClient });

  } catch (err) {
    return NextResponse.json({ message: "Error interno" }, { status: 500 });
  }
}
