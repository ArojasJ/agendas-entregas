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
  } catch {
    return null;
  }
}

export async function GET(req) {
  const session = getPanelSession(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });

  const { data, error } = await supabase
    .from("driver_location")
    .select("*")
    .eq("id", 1)
    .single();

  if (error) return Response.json({ location: null });
  return Response.json({ location: data });
}

export async function POST(req) {
  const session = getPanelSession(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });

  const { lat, lng, is_active } = await req.json();

  const { error } = await supabase
    .from("driver_location")
    .upsert({
      id: 1,
      lat: lat ?? 0,
      lng: lng ?? 0,
      is_active: is_active ?? true,
      updated_at: new Date().toISOString(),
    });

  if (error) return Response.json({ message: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
