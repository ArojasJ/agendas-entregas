import { createClient } from "@supabase/supabase-js";
import { supabase as supabaseAnon } from "@/lib/supabaseClient";

const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : supabaseAnon;

const DOMICILIO_LIMIT = 15;

export async function GET() {
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("date, type")
    .eq("type", "domicilio");

  if (error) {
    return Response.json({ counts: {}, limit: DOMICILIO_LIMIT });
  }

  // Contar cuántas agendas domicilio hay por fecha
  const counts = {};
  for (const b of bookings || []) {
    counts[b.date] = (counts[b.date] || 0) + 1;
  }

  return Response.json({ counts, limit: DOMICILIO_LIMIT });
}
