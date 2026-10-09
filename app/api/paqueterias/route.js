import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { getPanelSession } from "@/lib/panelAuth";

// Listar: cualquiera del panel, para poder elegir la paquetería al armar la ruta.
export async function GET(req) {
  const session = getPanelSession(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });

  const { data, error } = await supabase
    .from("paqueterias")
    .select("*")
    .order("nombre", { ascending: true });

  if (error) {
    console.error("Error al leer paqueterías:", error);
    return Response.json({ message: "Error al leer paqueterías" }, { status: 500 });
  }
  return Response.json({ paqueterias: data || [] });
}

// Alta, edición y baja: solo admin, para que las direcciones y coordenadas del
// catálogo no se ensucien.
export async function POST(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== "admin") {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }

  const { nombre, direccion, lat, lng } = await req.json();
  if (!nombre?.trim() || !direccion?.trim()) {
    return Response.json({ message: "Falta nombre o dirección" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("paqueterias")
    .insert([{
      nombre: nombre.trim(),
      direccion: direccion.trim(),
      lat: lat != null && lat !== "" ? Number(lat) : null,
      lng: lng != null && lng !== "" ? Number(lng) : null,
    }])
    .select()
    .single();

  if (error) {
    console.error("Error al crear paquetería:", error);
    return Response.json({ message: "No se pudo guardar" }, { status: 500 });
  }
  return Response.json({ paqueteria: data });
}

export async function PATCH(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== "admin") {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }

  const { id, ...campos } = await req.json();
  if (!id) return Response.json({ message: "Falta id" }, { status: 400 });

  const update = {};
  if (campos.nombre !== undefined) update.nombre = String(campos.nombre).trim();
  if (campos.direccion !== undefined) update.direccion = String(campos.direccion).trim();
  if (campos.lat !== undefined) update.lat = campos.lat === "" || campos.lat === null ? null : Number(campos.lat);
  if (campos.lng !== undefined) update.lng = campos.lng === "" || campos.lng === null ? null : Number(campos.lng);
  if (campos.activa !== undefined) update.activa = !!campos.activa;

  const { error } = await supabase.from("paqueterias").update(update).eq("id", id);
  if (error) {
    console.error("Error al actualizar paquetería:", error);
    return Response.json({ message: "No se pudo actualizar" }, { status: 500 });
  }
  return Response.json({ ok: true });
}

export async function DELETE(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== "admin") {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ message: "Falta id" }, { status: 400 });

  const { error } = await supabase.from("paqueterias").delete().eq("id", id);
  if (error) {
    console.error("Error al eliminar paquetería:", error);
    return Response.json({ message: "No se pudo eliminar" }, { status: 500 });
  }
  return Response.json({ ok: true });
}
