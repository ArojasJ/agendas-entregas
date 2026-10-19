import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Devuelve al inventario las piezas de las ventas que esperaban pago y ya vencieron.
// Lo pesado lo hace la función de Postgres, que corre todo en una transacción para que
// un pago que entra a destiempo no compita con el barrido.
//
// Lo invoca el cron de Vercel, que manda CRON_SECRET en el encabezado. Sin ese secreto
// configurado la ruta queda cerrada: es preferible que el barrido no corra a que
// cualquiera pueda dispararlo.
export async function GET(req) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    console.error("CRON_SECRET no está configurado; el barrido no corre.");
    return Response.json({ message: "No configurado" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("liberar_reservas_vencidas");

  if (error) {
    console.error("Error al liberar reservas vencidas:", error);
    return Response.json({ message: "Error al liberar reservas" }, { status: 500 });
  }

  const liberadas = data || [];
  const piezas = liberadas.reduce((s, r) => s + (Number(r.piezas) || 0), 0);

  if (liberadas.length > 0) {
    console.log(`Reservas vencidas liberadas: ${liberadas.length} ventas, ${piezas} piezas`);
  }

  return Response.json({ ventas: liberadas.length, piezas });
}
