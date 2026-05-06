import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
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

export async function GET(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== "admin") {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }

  const [{ data: products }, { data: catRows }] = await Promise.all([
    supabase.from("products").select("category"),
    supabase.from("catalog_categories").select("*").order("sort_order", { ascending: true }),
  ]);

  const catMap = {};
  for (const c of catRows || []) catMap[c.name] = c;

  const uniqueNames = [...new Set((products || []).map(p => p.category).filter(Boolean))];

  const categories = uniqueNames
    .map(name => ({
      name,
      image_url: catMap[name]?.image_url || null,
      sort_order: catMap[name]?.sort_order ?? 999,
    }))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  return Response.json({ categories });
}

export async function PATCH(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== "admin") {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }

  const { name, image_url, sort_order } = await req.json();
  if (!name) return Response.json({ message: "Nombre requerido" }, { status: 400 });

  const { error } = await supabase
    .from("catalog_categories")
    .upsert(
      { name, image_url: image_url ?? null, sort_order: sort_order ?? 0 },
      { onConflict: "name" }
    );

  if (error) return Response.json({ message: error.message }, { status: 500 });
  return Response.json({ success: true });
}
