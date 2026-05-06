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
  } catch { return null; }
}

export async function GET(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== "admin") {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }
  const { data } = await supabase.from("catalog_settings").select("key, value");
  const settings = {};
  for (const row of data || []) settings[row.key] = row.value;
  return Response.json({ settings });
}

export async function PATCH(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== "admin") {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }
  const { settings } = await req.json();
  const rows = Object.entries(settings).map(([key, value]) => ({
    key,
    value: String(value),
    updated_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("catalog_settings")
    .upsert(rows, { onConflict: "key" });
  if (error) return Response.json({ message: error.message }, { status: 500 });
  return Response.json({ success: true });
}
