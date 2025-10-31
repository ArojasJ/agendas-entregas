// app/api/login-panel/route.js

export async function POST(request) {
  try {
    const { password } = await request.json();

    const validPassword = process.env.PANEL_PASSWORD || "MELANNY";
    const secret = process.env.PANEL_TOKEN_SECRET || "agenda_super_secreta_123";

    if (!password) {
      return new Response(
        JSON.stringify({ success: false, message: "Falta la contraseña." }),
        { status: 400 }
      );
    }

    if (password !== validPassword) {
      return new Response(
        JSON.stringify({ success: false, message: "Contraseña incorrecta." }),
        { status: 401 }
      );
    }

    // ✅ si la contraseña es correcta, generamos token simple
    const payload = {
      issuedAt: Date.now(),
    };

    const token = Buffer.from(
      JSON.stringify(payload) + "|" + secret
    ).toString("base64");

    return new Response(
      JSON.stringify({
        success: true,
        message: "Acceso autorizado.",
        token,
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

