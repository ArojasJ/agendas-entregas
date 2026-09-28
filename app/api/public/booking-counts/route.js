import { createClient } from "@supabase/supabase-js";
import { supabase as supabaseAnon } from "@/lib/supabaseClient";
import { DOMICILIO_LIMIT } from "@/lib/constants";

const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : supabaseAnon;

export async function GET() {
  const today = new Date().toISOString().split("T")[0];

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("date, type")
    .eq("type", "domicilio")
    .gte("date", today)
    .not("delivery_status", "in", '("entregado","cancelado")');

  if (error) {
    return Response.json({ counts: {}, limit: DOMICILIO_LIMIT });
  }

  const counts = {};
  for (const b of bookings || []) {
    counts[b.date] = (counts[b.date] || 0) + 1;
  }

  return Response.json({ counts, limit: DOMICILIO_LIMIT });
}
