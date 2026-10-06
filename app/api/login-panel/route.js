// app/api/login-panel/route.js
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import bcrypt from "bcryptjs";
import { signPanelToken } from "@/lib/panelAuth";

export async function POST(request) {
  try {
    const { username, password } = await request.json();


    if (!username || !password) {
      return new Response(
        JSON.stringify({ success: false, message: "Faltan credenciales." }),
        { status: 400 }
      );
    }

    // Buscar solo por username — la comparación de contraseña se hace en JS
    const { data: user, error } = await supabase
      .from("staff")
      .select("*")
      .eq("username", username.toLowerCase())
      .single();

    if (error || !user) {
      return new Response(
        JSON.stringify({ success: false, message: "Usuario o contraseña incorrectos." }),
        { status: 401 }
      );
    }

    // Migración automática: si la contraseña NO es un hash bcrypt, comparar en texto
    // plano y rehashear en la BD para que en el próximo login ya use bcrypt
    const storedPassword = user.password || "";
    const isBcryptHash = storedPassword.startsWith("$2b$") || storedPassword.startsWith("$2a$");

    let passwordOk = false;
    if (isBcryptHash) {
      passwordOk = await bcrypt.compare(password, storedPassword);
    } else {
      passwordOk = password === storedPassword;
      if (passwordOk) {
        // Rehashear y guardar — migración silenciosa
        const hash = await bcrypt.hash(password, 12);
        await supabase.from("staff").update({ password: hash }).eq("id", user.id);
      }
    }

    if (!passwordOk) {
      return new Response(
        JSON.stringify({ success: false, message: "Usuario o contraseña incorrectos." }),
        { status: 401 }
      );
    }

    const payload = {
      issuedAt: Date.now(),
      staffId: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name
    };

    const token = signPanelToken(payload);

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
