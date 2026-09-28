import { supabase as supabaseAnon } from "@/lib/supabaseClient";
import { getPanelSession } from "@/lib/panelAuth";
import { createClient } from "@supabase/supabase-js";

const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : supabaseAnon;


export async function GET(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== "admin") {
    return Response.json({ message: "No autorizado" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const entity_type = searchParams.get("entity_type");
  const staff_id = searchParams.get("staff_id");
  const limit = parseInt(searchParams.get("limit") || "100");

  let q = supabase
    .from("audit_logs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (entity_type) q = q.eq("entity_type", entity_type);
  if (staff_id) q = q.eq("staff_id", staff_id);

  const { data, error } = await q;
  if (error) return Response.json({ message: error.message }, { status: 500 });
  return Response.json({ logs: data || [] });
}
