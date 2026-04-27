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

  // Fetch all cuts
  const { data: cuts, error } = await supabase
    .from("pos_cuts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return Response.json({ message: "Error al leer cortes." }, { status: 500 });
  }

  return Response.json({ cuts: cuts || [] });
}

export async function POST(req) {
  const session = getPanelSession(req);
  if (!session || session.role !== 'admin') {
    return Response.json({ message: "No autorizado (requiere admin)" }, { status: 403 });
  }

  try {
    // 1. Obtener todas las ventas nuevas sin corte
    const { data: pendingSales, error: fetchSalesError } = await supabase
      .from("sales")
      .select("id, down_payment, created_at")
      .is("pos_cut_id", null)
      .order("created_at", { ascending: true });

    // 2. Obtener todos los abonos nuevos sin corte
    const { data: pendingPayments, error: fetchPaymentsError } = await supabase
      .from("payments")
      .select("id, amount, created_at")
      .is("pos_cut_id", null)
      .order("created_at", { ascending: true });

    if (fetchSalesError || fetchPaymentsError) {
      return Response.json({ message: "Error al buscar registros pendientes." }, { status: 500 });
    }

    if ((!pendingSales || pendingSales.length === 0) && (!pendingPayments || pendingPayments.length === 0)) {
      return Response.json({ message: "No hay movimientos nuevos para hacer corte." }, { status: 400 });
    }

    // Calcular el total
    const totalSales = (pendingSales || []).reduce((sum, sale) => sum + Number(sale.down_payment), 0);
    const totalPayments = (pendingPayments || []).reduce((sum, p) => sum + Number(p.amount), 0);
    const totalAmount = totalSales + totalPayments;

    // Determinar la fecha de inicio del corte
    let fromDatetime = new Date().toISOString();
    if (pendingSales && pendingSales.length > 0 && pendingPayments && pendingPayments.length > 0) {
      fromDatetime = new Date(pendingSales[0].created_at) < new Date(pendingPayments[0].created_at) ? pendingSales[0].created_at : pendingPayments[0].created_at;
    } else if (pendingSales && pendingSales.length > 0) {
      fromDatetime = pendingSales[0].created_at;
    } else if (pendingPayments && pendingPayments.length > 0) {
      fromDatetime = pendingPayments[0].created_at;
    }
    
    // 3. Crear el corte en pos_cuts
    const { data: newCut, error: cutError } = await supabase
      .from("pos_cuts")
      .insert([{
        from_datetime: fromDatetime,
        total_amount: totalAmount
      }])
      .select()
      .single();

    if (cutError) {
      return Response.json({ message: "Error al crear el corte." }, { status: 500 });
    }

    // 4. Asignar el pos_cut_id a ventas y abonos
    if (pendingSales && pendingSales.length > 0) {
      await supabase.from("sales").update({ pos_cut_id: newCut.id }).in("id", pendingSales.map(s => s.id));
    }
    if (pendingPayments && pendingPayments.length > 0) {
      await supabase.from("payments").update({ pos_cut_id: newCut.id }).in("id", pendingPayments.map(p => p.id));
    }

    return Response.json({ message: "Corte realizado con éxito.", cut: newCut });
  } catch (err) {
    console.error(err);
    return Response.json({ message: "Error en el servidor." }, { status: 500 });
  }
}
