import { ImageResponse } from "next/og";
import { createClient } from "@supabase/supabase-js";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }) {
  const { id } = await params;

  let clientName = "tu compra";
  let amount = null;
  let isPaid = false;
  let isCancelled = false;

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    const { data: sale } = await supabase
      .from("sales")
      .select("total, status, down_payment, clients(name)")
      .eq("id", id)
      .single();

    if (sale) {
      clientName = sale.clients?.name || "tu compra";
      isPaid = sale.status === "paid";
      isCancelled = sale.status === "cancelled";
      const isCatalog = sale.status === "catalog_pending" || sale.status === "catalog_viewed";
      const pagado = isCatalog ? 0 : Number(sale.down_payment || 0);
      const deuda = isPaid ? 0 : Math.max(0, Number(sale.total) - pagado);
      amount = deuda > 0 ? deuda.toFixed(2) : null;
    }
  } catch {
    // use defaults
  }

  const accentColor = isCancelled ? "#ef4444" : isPaid ? "#10b981" : "#f59e0b";
  const statusText = isCancelled
    ? "Compra cancelada"
    : isPaid
    ? "✓ Compra pagada"
    : amount
    ? `$${amount} pendientes`
    : "Resumen de compra";

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          background: "#0f172a",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px 80px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Header: logo + brand */}
        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "14px",
              background: "#ffffff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "28px",
            }}
          >
            🛍️
          </div>
          <span style={{ color: "#94a3b8", fontSize: "24px", fontWeight: 600 }}>
            Noreste CM
          </span>
        </div>

        {/* Main content */}
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div
            style={{
              display: "inline-flex",
              background: accentColor + "22",
              border: `2px solid ${accentColor}`,
              borderRadius: "999px",
              padding: "8px 24px",
              width: "fit-content",
            }}
          >
            <span style={{ color: accentColor, fontSize: "28px", fontWeight: 800 }}>
              {statusText}
            </span>
          </div>

          <div style={{ color: "#f8fafc", fontSize: "52px", fontWeight: 900, lineHeight: 1.1 }}>
            Hola, {clientName}
          </div>

          <div style={{ color: "#94a3b8", fontSize: "28px", fontWeight: 400 }}>
            {isPaid
              ? "Tu compra está completamente pagada."
              : isCancelled
              ? "Tu compra ha sido cancelada."
              : "Toca para ver el resumen de tu compra y los detalles de pago."}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              background: accentColor,
            }}
          />
          <span style={{ color: "#475569", fontSize: "20px" }}>norestecm.com</span>
        </div>
      </div>
    ),
    { ...size }
  );
}
