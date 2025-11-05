// app/api/login-panel/route.js

export async function POST(request) {
  try {
    const { password } = await request.json();

    // 🔑 contraseñas por rol
    const adminPassword = process.env.PANEL_PASSWORD || "MELANNY";
    const driverPassword = process.env.PANEL_DRIVER_PASSWORD || "REPARTIDOR";

    const secret = process.env.PANEL_TOKEN_SECRET || "agenda_super_secreta_123";

    if (!password) {
      return new Response(
        JSON.stringify({ success: false, message: "Falta la contraseña." }),
        { status: 400 }
      );
    }

    let role = null;

    if (password === adminPassword) {
      role = "admin";
    } else if (password === driverPassword) {
      role = "driver";
    }

    if (!role) {
      return new Response(
        JSON.stringify({ success: false, message: "Contraseña incorrecta." }),
        { status: 401 }
      );
    }

    // ✅ token con rol incluido
    const payload = {
      issuedAt: Date.now(),
      role,
    };

    const token = Buffer.from(
      JSON.stringify(payload) + "|" + secret
    ).toString("base64");

    return new Response(
      JSON.stringify({
        success: true,
        message: "Acceso autorizado.",
        token,
        role, // 👈 lo usamos en el frontend para saber qué mostrar
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


