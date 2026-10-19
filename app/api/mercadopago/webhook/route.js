import crypto from "crypto";
import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { VENTA_ESPERANDO_PAGO } from "@/lib/constants";

export const dynamic = "force-dynamic";

// Confirmación de pago de MercadoPago.
//
// Dos candados, y el segundo es el que de verdad importa:
//
// 1. Se valida la firma del encabezado x-signature.
// 2. Nunca se cree lo que trae el aviso. Llegue de donde llegue, la orden se vuelve a
//    consultar contra la API de MercadoPago con nuestro propio token, y solo eso decide
//    si la venta se marca pagada. Así, aunque alguien falsificara un aviso, tendría que
//    controlar además la respuesta de MercadoPago para cobrarse una venta.
//
// Responde 200 incluso ante avisos que no aplican: un error haría que MercadoPago
// reintente cada 15 minutos para siempre.
export async function POST(req) {
  try {
    const url = new URL(req.url);
    const dataId = url.searchParams.get("data.id") || url.searchParams.get("id");
    const cuerpo = await req.json().catch(() => ({}));
    const recursoId = dataId || cuerpo?.data?.id;

    if (!recursoId) return Response.json({ ok: true, nota: "sin id" });

    if (!firmaValida(req, recursoId)) {
      console.warn("Webhook con firma inválida, ignorado:", recursoId);
      return Response.json({ ok: true, nota: "firma inválida" });
    }

    const orden = await consultarOrden(recursoId);
    if (!orden) return Response.json({ ok: true, nota: "orden no encontrada" });

    const ventaId = orden.external_reference;
    if (!ventaId) return Response.json({ ok: true, nota: "orden sin referencia" });

    const pagado = Number(orden.total_paid_amount || 0);
    if (pagado <= 0) {
      return Response.json({ ok: true, nota: `sin pago aún (${orden.status})` });
    }

    const { data: venta } = await supabase
      .from("sales")
      .select("id, total, status")
      .eq("id", ventaId)
      .single();

    if (!venta) return Response.json({ ok: true, nota: "venta no encontrada" });

    // Ya procesada: MercadoPago reintenta el mismo aviso, y marcarla dos veces
    // duplicaría el abono.
    if (venta.status === "paid") {
      return Response.json({ ok: true, nota: "ya estaba pagada" });
    }

    // Solo avanza quien gana el cambio de estado. Si el barrido de reservas vencidas
    // corre en este instante, uno de los dos pierde y no quedan estados mezclados.
    const { data: ganada } = await supabase
      .from("sales")
      .update({ status: "paid", down_payment: pagado, payment_method: "Pedido Web" })
      .eq("id", ventaId)
      .in("status", [VENTA_ESPERANDO_PAGO, "cancelled"])
      .select("id");

    if (!ganada || ganada.length === 0) {
      return Response.json({ ok: true, nota: "otro proceso la tomó" });
    }

    await supabase.from("payments").insert([{ sale_id: ventaId, amount: pagado }]);

    console.log(`Pago confirmado: venta ${ventaId} por $${pagado}`);
    return Response.json({ ok: true, venta: ventaId, pagado });
  } catch (err) {
    console.error("Error en webhook de MercadoPago:", err);
    // 200 a propósito: si respondemos error, MercadoPago reintenta sin parar
    return Response.json({ ok: true, nota: "error registrado" });
  }
}

export async function GET() {
  return Response.json({ ok: true });
}

function firmaValida(req, recursoId) {
  const secreto = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secreto) {
    console.warn("MERCADOPAGO_WEBHOOK_SECRET sin configurar; se omite la validación de firma.");
    return true;
  }

  const firma = req.headers.get("x-signature");
  const requestId = req.headers.get("x-request-id");
  if (!firma) return false;

  const partes = Object.fromEntries(
    firma.split(",").map((p) => p.split("=").map((s) => s.trim()))
  );
  const { ts, v1 } = partes;
  if (!ts || !v1) return false;

  const manifiesto = `id:${recursoId};request-id:${requestId};ts:${ts};`;
  const esperado = crypto.createHmac("sha256", secreto).update(manifiesto).digest("hex");

  const a = Buffer.from(esperado);
  const b = Buffer.from(v1);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function consultarOrden(id) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) return null;

  // El aviso puede traer el id de la orden o el del pago; se intentan ambos.
  for (const ruta of [`/v1/orders/${id}`, `/v1/payments/${id}`]) {
    const r = await fetch(`https://api.mercadopago.com${ruta}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) continue;
    const d = await r.json();

    if (ruta.startsWith("/v1/orders")) return d;

    // Un pago trae la referencia en otro campo y el monto aprobado aparte
    return {
      external_reference: d.external_reference,
      status: d.status,
      total_paid_amount: d.status === "approved" ? d.transaction_amount : 0,
    };
  }
  return null;
}
