import crypto from "crypto";

const API = "https://api.mercadopago.com";

// Los montos viajan como texto con dos decimales; un número suelto lo rechaza.
export function monto(n) {
  return Number(n).toFixed(2);
}

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://www.norestecm.com").replace(/\/$/, "");
}

// Crea la orden de Checkout Pro y devuelve a dónde mandar a la clienta.
//
// Ojo con dos cosas que la documentación de MercadoPago tiene mal y se verificaron
// contra la API real: los items NO aceptan `unit_measure` ni `total_amount`, y la URL
// de notificación no va aquí — se configura en el panel de la aplicación.
export async function crearOrden({ ventaId, items, emailComprador, totalEsperado }) {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token) throw new Error("Falta MERCADOPAGO_ACCESS_TOKEN");

  const base = siteUrl();

  const res = await fetch(`${API}/v1/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // Un UUID por intento: si la red falla y se reintenta, MercadoPago no crea dos órdenes
      "X-Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({
      type: "online",
      processing_mode: "manual",
      total_amount: monto(totalEsperado),
      // Así es como el webhook sabrá a qué venta corresponde el pago
      external_reference: ventaId,
      expiration_time: "PT30M",
      payer: { email: emailComprador },
      items: items.map((i) => ({
        title: i.title,
        unit_price: monto(i.unit_price),
        quantity: i.quantity,
      })),
      config: {
        online: {
          success_url: `${base}/compra/${ventaId}?pago=ok`,
          pending_url: `${base}/compra/${ventaId}?pago=pendiente`,
          failure_url: `${base}/compra/${ventaId}?pago=fallo`,
        },
      },
    }),
  });

  const data = await res.json();

  if (!res.ok || !data.checkout_url) {
    const detalle = data?.errors?.[0]?.details?.join(" | ")
      || data?.errors?.[0]?.message
      || data?.message
      || `HTTP ${res.status}`;
    throw new Error(`MercadoPago rechazó la orden: ${detalle}`);
  }

  return { ordenId: data.id, checkoutUrl: data.checkout_url };
}
