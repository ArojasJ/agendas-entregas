// app/api/login-panel/route.js

export async function POST(request) {
  try {
    const { password } = await request.json();

    // La clave real está en el archivo .env.local
    const validPassword = process.env.PANEL_PASSWORD;

    if (!password) {
      return new Response(
        JSON.stringify({ success: false, message: "Falta la contraseña." }),
        { status: 400 }
      );
    }

    if (password === validPassword) {
      return new Response(
        JSON.stringify({ success: true, message: "Acceso autorizado." }),
        { status: 200 }
      );
    } else {
      return new Response(
        JSON.stringify({ success: false, message: "Contraseña incorrecta." }),
        { status: 401 }
      );
    }
  } catch (err) {
    console.error(err);
    return new Response(
      JSON.stringify({ success: false, message: "Error del servidor." }),
      { status: 500 }
    );
  }
}
