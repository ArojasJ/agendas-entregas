import { supabase } from "@/lib/supabaseClient";

function getPanelSession(req) {
  const headerToken = req.headers.get("x-panel-token");
  const secret = process.env.PANEL_TOKEN_SECRET || "agenda_super_secreta_123";
  if (!headerToken) return null;
  try {
    const decoded = Buffer.from(headerToken, "base64").toString("utf8");
    const [json, sig] = decoded.split("|");
    if (sig !== secret) return null;
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}

export async function GET(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== 'admin') {
    return Response.json({ message: "No autorizado (requiere admin)" }, { status: 403 });
  }

  try {
    // Para las gráficas de alto rendimiento, traemos todas las ventas.
    // El frontend hará el filtrado y agrupamiento dinámico para que la interacción sea instántanea
    // al cambiar entre "Hoy", "Ayer", "7 Días", etc.
    const { data: sales, error } = await supabase
      .from("sales")
      .select(`
        *,
        clients ( id, name, instagram ),
        sale_items ( quantity, unit_price, products ( id, name ) ),
        payments ( amount, created_at )
      `)
      .order("created_at", { ascending: true });

    if (error) {
      console.error(error);
      return Response.json({ message: "Error al leer analíticas." }, { status: 500 });
    }

    return Response.json({ sales: sales || [] });
  } catch (err) {
    console.error(err);
    return Response.json({ message: "Error en el servidor." }, { status: 500 });
  }
}
