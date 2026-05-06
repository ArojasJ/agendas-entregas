import { supabase } from "@/lib/supabaseClient";

export async function GET() {
  try {
    const { data, error } = await supabase.from("catalog_settings").select("key, value");
    if (error) throw error;
    const settings = {};
    for (const row of data || []) settings[row.key] = row.value;
    return Response.json({ settings });
  } catch (err) {
    return Response.json({ settings: {} }, { status: 500 });
  }
}
