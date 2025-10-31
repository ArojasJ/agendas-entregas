// app/api/blocked-days/route.js
import { supabase } from "@/lib/supabaseClient";

export async function GET() {
  // endpoint público: solo lee qué días están bloqueados
  const { data, error } = await supabase
    .from("blocked_days")
    .select("*")
    .order("date", { ascending: true });

  if (error) {
    console.error("Error leyendo blocked_days:", error);
    return Response.json({ blockedDays: [] }, { status: 200 });
  }

  return Response.json({ blockedDays: data || [] }, { status: 200 });
}
