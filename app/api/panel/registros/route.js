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

// GET: pending registrations + count
export async function GET(req) {
  const session = getPanelSession(req);
  if (!session || !["admin", "worker"].includes(session.role)) {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);

  if (searchParams.get("countOnly") === "true") {
    const { count } = await supabase
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("needs_review", true);
    return Response.json({ count: count || 0 });
  }

  // Search for existing clients to link to
  if (searchParams.get("search")) {
    const q = searchParams.get("search").toLowerCase();
    const { data } = await supabase
      .from("clients")
      .select("id, name, instagram, phone, email")
      .eq("needs_review", false)
      .or(`name.ilike.%${q}%,instagram.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(8);
    return Response.json({ clients: data || [] });
  }

  const { data, error } = await supabase
    .from("clients")
    .select("id, name, instagram, phone, email, created_at")
    .eq("needs_review", true)
    .order("created_at", { ascending: false });

  if (error) return Response.json({ message: error.message }, { status: 500 });
  return Response.json({ registros: data || [] });
}

// PATCH: approve (new client) or link (merge into existing)
export async function PATCH(req) {
  const session = getPanelSession(req);
  if (!session || !["admin", "worker"].includes(session.role)) {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }

  const { action, registroId, targetId } = await req.json();

  if (action === "approve") {
    // Mark as reviewed — keep client as-is
    const { error } = await supabase
      .from("clients")
      .update({ needs_review: false })
      .eq("id", registroId);
    if (error) return Response.json({ message: error.message }, { status: 500 });
    return Response.json({ success: true });
  }

  if (action === "link") {
    // Get the registration client (has auth_user_id, email, name, phone)
    const { data: registro } = await supabase
      .from("clients")
      .select("auth_user_id, email, name, phone")
      .eq("id", registroId)
      .single();

    if (!registro) return Response.json({ message: "Registro no encontrado" }, { status: 404 });

    const { auth_user_id, email, name, phone } = registro;

    // Delete the duplicate first so unique constraints are freed
    const { error: deleteErr } = await supabase.from("clients").delete().eq("id", registroId);
    if (deleteErr) return Response.json({ message: deleteErr.message }, { status: 500 });

    // Transfer auth_user_id + email and update name/phone with what the client provided
    const updateFields = { auth_user_id, email, needs_review: false };
    if (name) updateFields.name = name;
    if (phone) updateFields.phone = phone;

    const { error: updateErr } = await supabase
      .from("clients")
      .update(updateFields)
      .eq("id", targetId);

    if (updateErr) return Response.json({ message: updateErr.message }, { status: 500 });

    return Response.json({ success: true });
  }

  return Response.json({ message: "Acción inválida" }, { status: 400 });
}
