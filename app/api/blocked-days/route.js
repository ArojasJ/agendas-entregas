// app/api/blocked-days/route.js
import { supabase } from "@/lib/supabaseClient";

export async function GET() {
  const [
    { data: blockedDays },
    { data: extraBodegaDays },
    { data: specialDays },
  ] = await Promise.all([
    supabase.from("blocked_days").select("*").order("date", { ascending: true }),
    supabase.from("bodega_extra_days").select("*").order("date", { ascending: true }),
    supabase.from("special_days").select("*").order("date", { ascending: true }),
  ]);

  return Response.json({
    blockedDays: blockedDays || [],
    extraBodegaDays: extraBodegaDays || [],
    specialDays: specialDays || [],
  });
}


