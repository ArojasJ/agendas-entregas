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
  if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("product_id");
  if (!productId) return Response.json({ message: "Falta product_id" }, { status: 400 });
  const { data, error } = await supabase
    .from("product_variants")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: true });
  if (error) return Response.json({ message: error.message }, { status: 500 });
  return Response.json({ variants: data || [] });
}

export async function POST(req) {
  const session = getPanelSession(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });
  const body = await req.json();
  const items = Array.isArray(body) ? body : [body];
  const rows = items.map(({ product_id, option_type, name, sku, barcode, cost, price, stock }) => ({
    product_id,
    option_type: option_type || "Tamaño",
    name,
    sku: sku || null,
    barcode: barcode || null,
    cost: Number(cost) || 0,
    price: Number(price) || 0,
    stock: Number(stock) || 0,
  }));
  const { data, error } = await supabase.from("product_variants").insert(rows).select();
  if (error) return Response.json({ message: error.message }, { status: 500 });
  return Response.json({ variants: data });
}

export async function PATCH(req) {
  const session = getPanelSession(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });
  const { id, name, sku, barcode, cost, price, stock } = await req.json();
  if (!id) return Response.json({ message: "Falta id" }, { status: 400 });
  const update = {};
  if (name !== undefined) update.name = name;
  if (sku !== undefined) update.sku = sku || null;
  if (barcode !== undefined) update.barcode = barcode || null;
  if (cost !== undefined) update.cost = Number(cost);
  if (price !== undefined) update.price = Number(price);
  if (stock !== undefined) update.stock = Number(stock);
  const { data, error } = await supabase
    .from("product_variants").update(update).eq("id", id).select().single();
  if (error) return Response.json({ message: error.message }, { status: 500 });
  return Response.json({ variant: data });
}

export async function DELETE(req) {
  const session = getPanelSession(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return Response.json({ message: "Falta id" }, { status: 400 });
  const { error } = await supabase.from("product_variants").delete().eq("id", id);
  if (error) return Response.json({ message: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
