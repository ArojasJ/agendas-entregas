import { supabase } from "@/lib/supabaseClient";

async function uploadImage(base64Data, label) {
  if (!base64Data || !base64Data.startsWith("data:image")) return base64Data;
  try {
    const [metadata, base64String] = base64Data.split(",");
    const extension = metadata.split(";")[0].split("/")[1] || "jpg";
    const buffer = Buffer.from(base64String, "base64");
    const safeName = (label || "variant").toLowerCase().replace(/[^a-z0-9]/g, "-");
    const path = `variants/${Date.now()}-${safeName}.${extension}`;
    const { error } = await supabase.storage.from("products").upload(path, buffer, {
      contentType: `image/${extension}`,
      upsert: true,
    });
    if (error) return base64Data;
    const { data: { publicUrl } } = supabase.storage.from("products").getPublicUrl(path);
    return publicUrl;
  } catch { return base64Data; }
}

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
  const rows = await Promise.all(items.map(async ({ product_id, option_type, name, sku, barcode, cost, price, stock, image_url, images }) => ({
    product_id,
    option_type: option_type || "Tamaño",
    name,
    sku: sku || null,
    barcode: barcode || null,
    cost: Number(cost) || 0,
    price: Number(price) || 0,
    stock: Number(stock) || 0,
    image_url: await uploadImage(image_url, name),
    images: await Promise.all((images || []).map(img => uploadImage(img, name))),
  })));
  const { data, error } = await supabase.from("product_variants").insert(rows).select();
  if (error) return Response.json({ message: error.message }, { status: 500 });
  return Response.json({ variants: data });
}

export async function PATCH(req) {
  const session = getPanelSession(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });
  const { id, name, sku, barcode, cost, price, stock, image_url, images } = await req.json();
  if (!id) return Response.json({ message: "Falta id" }, { status: 400 });
  const update = {};
  if (name !== undefined) update.name = name;
  if (sku !== undefined) update.sku = sku || null;
  if (barcode !== undefined) update.barcode = barcode || null;
  if (cost !== undefined) update.cost = Number(cost);
  if (price !== undefined) update.price = Number(price);
  if (stock !== undefined) update.stock = Number(stock);
  if (image_url !== undefined) update.image_url = await uploadImage(image_url, name || id);
  if (images !== undefined) update.images = await Promise.all((images || []).map(img => uploadImage(img, name || id)));
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
