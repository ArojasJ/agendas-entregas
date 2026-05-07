import { createClient } from "@supabase/supabase-js";
import { supabase as supabaseAnon } from "@/lib/supabaseClient";

const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : supabaseAnon;

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

export async function PATCH(req, { params }) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  const allowed = ["box_1", "box_2", "name", "instagram", "phone", "balance", "needs_review"];
  const updates = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ message: "Sin campos para actualizar" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("clients")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error(error);
    return Response.json({ message: "Error al actualizar cliente" }, { status: 500 });
  }

  return Response.json({ client: data });
}
