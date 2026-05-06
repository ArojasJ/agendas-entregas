import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

export async function POST(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== "admin") {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!file) return Response.json({ message: "Sin archivo" }, { status: 400 });

  const ext = file.name.split(".").pop().toLowerCase();
  const allowed = ["jpg", "jpeg", "png", "webp", "gif", "avif"];
  if (!allowed.includes(ext)) {
    return Response.json({ message: "Tipo de archivo no permitido" }, { status: 400 });
  }

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const path = `categories/${filename}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { error } = await supabaseAdmin.storage
    .from("catalog")
    .upload(path, buffer, { contentType: file.type, upsert: false });

  if (error) return Response.json({ message: error.message }, { status: 500 });

  const { data: urlData } = supabaseAdmin.storage.from("catalog").getPublicUrl(path);
  return Response.json({ url: urlData.publicUrl });
}
