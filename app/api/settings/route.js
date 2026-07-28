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

export async function GET() {
  const { data, error } = await supabase.from("app_settings").select("*");
  if (error) return Response.json({ message: error.message }, { status: 500 });
  const settings = {};
  (data || []).forEach(row => { settings[row.key] = row.value; });
  return Response.json({ settings });
}

export async function PATCH(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== "admin") {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }
  const { key, value } = await req.json();
  if (!key) return Response.json({ message: "Falta key" }, { status: 400 });
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key, value: String(value) });
  if (error) return Response.json({ message: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
