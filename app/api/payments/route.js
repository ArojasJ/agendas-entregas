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
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  // Traer todas las ventas a crédito, con sus abonos y cliente
  const { data: receivables, error } = await supabase
    .from("sales")
    .select(`
      *,
      clients ( name, instagram, phone ),
      payments ( amount, created_at ),
      sale_items ( quantity, unit_price, products(name) )
    `)
    .eq("status", "credit")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error);
    return Response.json({ message: "Error al leer cuentas por cobrar." }, { status: 500 });
  }

  return Response.json({ receivables: receivables || [] });
}

export async function POST(req) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { sale_id, amount } = body;

    if (!sale_id || !amount) {
      return Response.json({ message: "Faltan datos para el abono." }, { status: 400 });
    }

    // Insertar abono
    const { data: newPayment, error: paymentError } = await supabase
      .from("payments")
      .insert([{
        sale_id: sale_id,
        amount: Number(amount)
      }])
      .select()
      .single();

    if (paymentError) {
      console.error(paymentError);
      return Response.json({ message: "Error al registrar abono." }, { status: 500 });
    }

    // Calcular si ya se liquidó para cambiar el status
    const { data: sale } = await supabase
      .from("sales")
      .select("total, down_payment, payments(amount)")
      .eq("id", sale_id)
      .single();

    if (sale) {
      const totalAbonado = sale.payments.reduce((sum, p) => sum + Number(p.amount), 0);
      const totalPagado = Number(sale.down_payment) + totalAbonado;
      
      if (totalPagado >= Number(sale.total)) {
        await supabase
          .from("sales")
          .update({ status: 'paid' })
          .eq("id", sale_id);
      }
    }

    return Response.json({ message: "Abono registrado con éxito.", payment: newPayment });
  } catch (err) {
    console.error(err);
    return Response.json({ message: "Error en el servidor." }, { status: 500 });
  }
}
