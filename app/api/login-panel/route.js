// app/api/login-panel/route.js
import { supabase } from "@/lib/supabaseClient";

export async function POST(request) {
  try {
    const { username, password } = await request.json();

    const secret = process.env.PANEL_TOKEN_SECRET || "agenda_super_secreta_123";

    if (!username || !password) {
      return new Response(
        JSON.stringify({ success: false, message: "Faltan credenciales." }),
        { status: 400 }
      );
    }

    // 🔍 Buscar en la tabla staff
    const { data: user, error } = await supabase
      .from("staff")
      .select("*")
      .eq("username", username.toLowerCase())
      .eq("password", password) // En un sistema real usaríamos bcrypt, pero seguiremos la estructura simple solicitada
      .single();

    if (error || !user) {
      return new Response(
        JSON.stringify({ success: false, message: "Usuario o contraseña incorrectos." }),
        { status: 401 }
      );
    }

    // ✅ token con info completa
    const payload = {
      issuedAt: Date.now(),
      staffId: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name
    };

    const token = Buffer.from(
      JSON.stringify(payload) + "|" + secret
    ).toString("base64");

    return new Response(
      JSON.stringify({
        success: true,
        message: "Acceso autorizado.",
        token,
        role: user.role,
        displayName: user.display_name,
        staffId: user.id
      }),
      { status: 200 }
    );
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ success: false, message: "Error del servidor." }),
      { status: 500 }
    );
  }
}


