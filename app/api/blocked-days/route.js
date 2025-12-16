// app/api/blocked-days/route.js
import { supabase } from "@/lib/supabaseClient";

export async function GET() {
  // endpoint público: lee días bloqueados + días extra bodega
  const { data: blockedDays, error: blockedErr } = await supabase
    .from("blocked_days")
    .select("*")
    .order("date", { ascending: true });

  const { data: extraBodegaDays, error: extraErr } = await supabase
    .from("bodega_extra_days")
    .select("*")
    .order("date", { ascending: true });

  if (blockedErr) {
    console.error("Error leyendo blocked_days:", blockedErr);
  }
  if (extraErr) {
    console.error("Error leyendo bodega_extra_days:", extraErr);
  }

  return Response.json(
    {
      blockedDays: blockedDays || [],
      extraBodegaDays: extraBodegaDays || [],
    },
    { status: 200 }
  );
}


