import { createClient } from "@supabase/supabase-js";

export async function generateMetadata({ params }) {
  const { id } = await params;

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: sale } = await supabase
      .from("sales")
      .select("total, status, down_payment, discount, clients(name)")
      .eq("id", id)
      .single();

    if (!sale) throw new Error("not found");

    const isPaid = sale.status === "paid";
    const isCancelled = sale.status === "cancelled";
    const isCatalog = sale.status === "catalog_pending" || sale.status === "catalog_viewed";

    const total = Number(sale.total || 0);
    const pagado = isCatalog ? 0 : Number(sale.down_payment || 0);
    const deuda = isPaid ? 0 : Math.max(0, total - pagado);
    const clientName = sale.clients?.name || "tu compra";

    let title, description;

    if (isCancelled) {
      title = `Compra cancelada — Noreste CM`;
      description = `El resumen de compra de ${clientName} fue cancelado.`;
    } else if (isPaid) {
      title = `✓ Compra pagada — Noreste CM`;
      description = `La compra de ${clientName} por $${total.toFixed(2)} está completamente pagada.`;
    } else if (deuda > 0) {
      title = `💳 Tienes $${deuda.toFixed(2)} pendientes — Noreste CM`;
      description = `Hola ${clientName}, toca aquí para ver el resumen de tu compra y los detalles de pago.`;
    } else {
      title = `🛍️ Resumen de tu compra — Noreste CM`;
      description = `Hola ${clientName}, toca aquí para ver el detalle de tu pedido en Noreste CM.`;
    }

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        siteName: "Noreste CM",
        locale: "es_MX",
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
    };
  } catch {
    return {
      title: "🛍️ Resumen de tu compra — Noreste CM",
      description: "Toca para ver el detalle de tu pedido en Noreste CM.",
      openGraph: {
        title: "🛍️ Resumen de tu compra — Noreste CM",
        description: "Toca para ver el detalle de tu pedido en Noreste CM.",
        siteName: "Noreste CM",
      },
    };
  }
}

export default function CompraLayout({ children }) {
  return children;
}
