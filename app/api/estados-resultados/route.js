import { supabase } from "@/lib/supabaseClient";

/*
  SQL para crear la tabla en Supabase:

  CREATE TABLE estados_resultados (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    nombre text NOT NULL,
    periodo text,
    ventas numeric DEFAULT 0,
    gastos_admin jsonb DEFAULT '[]',
    gastos_operativos jsonb DEFAULT '[]',
    compras jsonb DEFAULT '[]',
    total_egresos numeric DEFAULT 0,
    utilidad numeric DEFAULT 0,
    reserva_10 numeric DEFAULT 0,
    distribuible_90 numeric DEFAULT 0,
    nosotros_75 numeric DEFAULT 0,
    socio_25 numeric DEFAULT 0,
    created_at timestamptz DEFAULT now()
  );
*/

function getPanelSession(req) {
  const headerToken = req.headers.get("x-panel-token");
  const secret = process.env.PANEL_TOKEN_SECRET || "agenda_super_secreta_123";
  if (!headerToken) return null;
  try {
    const decoded = Buffer.from(headerToken, "base64").toString("utf8");
    const [json, sig] = decoded.split("|");
    if (sig !== secret) return null;
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function GET(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== "admin") {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("estados_resultados")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return Response.json({ message: error.message }, { status: 500 });
  return Response.json({ estados: data || [] });
}

export async function POST(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== "admin") {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const {
    nombre, ventas,
    gastos_admin, gastos_operativos, compras,
    gastos_personal, gastos_personales,
    total_egresos, utilidad, reserva_10, fin_anio,
    distribuible_90, nosotros_75, socio_25,
  } = body;

  if (!nombre) return Response.json({ message: "Falta el nombre" }, { status: 400 });

  const { data, error } = await supabase
    .from("estados_resultados")
    .insert([{
      nombre, ventas,
      gastos_admin, gastos_operativos, compras,
      gastos_personal: gastos_personal || [],
      gastos_personales: gastos_personales || [],
      total_egresos, utilidad, reserva_10, fin_anio,
      distribuible_90, nosotros_75, socio_25,
    }])
    .select()
    .single();

  if (error) return Response.json({ message: error.message }, { status: 500 });
  return Response.json({ estado: data });
}

export async function DELETE(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== "admin") {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ message: "Falta id" }, { status: 400 });

  const { error } = await supabase.from("estados_resultados").delete().eq("id", id);
  if (error) return Response.json({ message: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
