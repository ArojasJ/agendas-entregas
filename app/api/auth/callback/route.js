import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") || "/perfil/setup";
  
  // Usa NEXT_PUBLIC_SITE_URL si está definida; evita que 0.0.0.0 llegue al browser
  const origin = process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin.replace("0.0.0.0", "localhost");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  // Si llegamos sin code pero hay sesión activa (ej. login por password)
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();

  if (session) {
    return NextResponse.redirect(new URL(next, origin));
  }

  // fallback a login
  return NextResponse.redirect(new URL("/login", origin));
}
