"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDateShort(iso) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("es-MX", {
    day: "numeric", month: "long", year: "numeric",
  });
}

export default function CompraPage() {
  const { id } = useParams();
  const [sale, setSale] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/public/sale/${id}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => setSale(data.sale))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !sale) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-6 text-center">
        <p className="text-5xl mb-4">🔍</p>
        <h1 className="text-xl font-black text-slate-800 mb-2">Compra no encontrada</h1>
        <p className="text-slate-500 text-sm">El link puede haber expirado o ser incorrecto.</p>
      </div>
    );
  }

  const totalAbonos = (sale.payments || []).reduce((s, p) => s + Number(p.amount), 0);
  const isCatalog = sale.status === "catalog_pending" || sale.status === "catalog_viewed";
  const isCredit = sale.status === "credit";
  const isPaid = sale.status === "paid";
  const isCancelled = sale.status === "cancelled";

  const totalPagado = isCatalog ? 0 : Number(sale.down_payment || 0) + totalAbonos;
  const deuda = isPaid ? 0 : Math.max(0, Number(sale.total) - totalPagado);

  const clientName = sale.clients?.name || "—";
  const clientIg = sale.clients?.instagram
    ? `@${sale.clients.instagram.replace(/^@/, "")}`
    : null;

  const statusInfo = isCancelled
    ? { label: "Cancelado", color: "bg-red-100 text-red-700 border-red-200" }
    : isPaid
    ? { label: "✓ Pagado", color: "bg-emerald-100 text-emerald-700 border-emerald-200" }
    : isCatalog
    ? { label: "Apartado — pendiente de confirmar", color: "bg-amber-100 text-amber-700 border-amber-200" }
    : isCredit
    ? { label: "Crédito — pago pendiente", color: "bg-sky-100 text-sky-700 border-sky-200" }
    : { label: sale.status, color: "bg-slate-100 text-slate-600 border-slate-200" };

  return (
    <div
      className="min-h-screen bg-slate-50"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="max-w-lg mx-auto px-4 py-8">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-500 rounded-2xl mb-3 shadow-lg shadow-emerald-500/30">
            <span className="text-2xl">🛍️</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900">Resumen de tu Compra</h1>
          <p className="text-sm text-slate-400 mt-1">{formatDate(sale.created_at)}</p>
        </div>

        {/* Estado */}
        <div className={`flex items-center justify-center mb-5`}>
          <span className={`text-sm font-black px-4 py-1.5 rounded-full border ${statusInfo.color}`}>
            {statusInfo.label}
          </span>
        </div>

        {/* Cliente */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 mb-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center text-lg shrink-0">
            👤
          </div>
          <div>
            <p className="font-black text-slate-900">{clientName}</p>
            {clientIg && <p className="text-sm text-slate-400">{clientIg}</p>}
          </div>
        </div>

        {/* Productos */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Productos</p>
          </div>
          <div className="divide-y divide-slate-100">
            {(sale.sale_items || []).map((item, idx) => {
              const isDelivered = item.delivery_status === "delivered";
              return (
                <div key={idx} className="flex items-center gap-3 px-4 py-3">
                  {item.products?.image_url ? (
                    <img
                      src={item.products.image_url}
                      alt={item.products?.name}
                      className="w-12 h-12 rounded-xl object-cover bg-slate-100 shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-xl shrink-0">
                      📦
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 text-sm leading-tight">
                      {item.products?.name || "Producto"}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {item.quantity} {item.quantity === 1 ? "unidad" : "unidades"} · ${Number(item.unit_price).toFixed(2)} c/u
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-black text-slate-900 text-sm">
                      ${(Number(item.unit_price) * Number(item.quantity)).toFixed(2)}
                    </p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                      isDelivered
                        ? "bg-emerald-50 text-emerald-600"
                        : "bg-amber-50 text-amber-600"
                    }`}>
                      {isDelivered ? "✓ Entregado" : "Pendiente"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Resumen de pago */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-slate-100">
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Resumen de Pago</p>
          </div>
          <div className="px-4 py-3 space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Total de la compra</span>
              <span className="font-black text-slate-900">${Number(sale.total).toFixed(2)}</span>
            </div>
            {Number(sale.discount || 0) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Descuento</span>
                <span className="font-bold text-emerald-600">-${Number(sale.discount).toFixed(2)}</span>
              </div>
            )}
            {!isCatalog && Number(sale.down_payment || 0) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Enganche</span>
                <span className="font-bold text-emerald-600">${Number(sale.down_payment).toFixed(2)}</span>
              </div>
            )}
            {(sale.payments || []).map((p, idx) => (
              <div key={idx} className="flex justify-between text-sm">
                <span className="text-slate-500">
                  Abono {idx + 1}
                  <span className="text-slate-400 text-xs ml-1">
                    ({new Date(p.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" })})
                  </span>
                </span>
                <span className="font-bold text-emerald-600">${Number(p.amount).toFixed(2)}</span>
              </div>
            ))}
            <div className="border-t border-slate-100 pt-2.5 flex justify-between">
              <span className="text-sm font-bold text-slate-700">Total pagado</span>
              <span className="font-black text-emerald-600">${totalPagado.toFixed(2)}</span>
            </div>
            {deuda > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 flex justify-between items-center">
                <span className="text-sm font-black text-amber-700">Saldo pendiente</span>
                <span className="font-black text-xl text-amber-700">${deuda.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Fecha límite de pago */}
        {(isCredit || isCatalog) && sale.due_date && !isCancelled && (
          <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 mb-4 flex items-center gap-3">
            <span className="text-2xl">📅</span>
            <div>
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Fecha límite de pago</p>
              <p className="font-black text-slate-900">{formatDateShort(sale.due_date)}</p>
            </div>
          </div>
        )}


        {/* Footer */}
        <p className="text-center text-xs text-slate-400 pb-6">
          Este es un resumen de tu compra. Para cualquier duda contáctanos.
        </p>

      </div>
    </div>
  );
}
