"use client";

import { useState } from "react";

// Cuando sale el último producto de una venta a crédito, el sistema solía darla por
// pagada y subir el enganche al total, aunque la clienta no hubiera pagado nada: la
// deuda desaparecía sin que nadie se enterara.
//
// Ahora la venta se queda a crédito y se pregunta aquí. Si ya pagó, el dinero se
// registra como abono de verdad, así cuenta en el corte; si no, queda a deber.
export default function CobroPendiente({ pendientes = [], onCerrar }) {
  const [indice, setIndice] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  const actual = pendientes[indice];
  if (!actual) return null;

  const siguiente = () => {
    setError("");
    if (indice + 1 < pendientes.length) setIndice(indice + 1);
    else onCerrar?.();
  };

  const registrarPago = async () => {
    if (guardando) return;
    setGuardando(true);
    setError("");
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({ sale_id: actual.saleId, amount: actual.debe }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "No se pudo registrar el pago.");
        return;
      }
      siguiente();
    } catch (e) {
      setError("No se pudo conectar. Revisa tu señal.");
    } finally {
      setGuardando(false);
    }
  };

  const pesos = (n) =>
    "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="text-4xl mb-2">💸</div>
          <h2 className="text-xl font-black text-slate-900">¿Ya te pagó?</h2>
          <p className="text-sm text-slate-500 mt-1">
            <span className="font-bold text-slate-700">{actual.cliente}</span> ya se llevó todo
            lo de esta compra, pero sigue debiendo.
          </p>
        </div>

        <div className="mx-6 mb-5 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center justify-between">
          <span className="text-xs font-black uppercase tracking-widest text-amber-600">Falta por cobrar</span>
          <span className="text-2xl font-black text-amber-700 tabular-nums">{pesos(actual.debe)}</span>
        </div>

        <p className="px-6 text-xs text-slate-400 text-center mb-4">
          De {pesos(actual.total)} lleva pagado {pesos(actual.pagado)}.
        </p>

        {error && (
          <p className="mx-6 mb-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
            {error}
          </p>
        )}

        <div className="px-6 pb-6 space-y-2">
          <button
            type="button"
            onClick={registrarPago}
            disabled={guardando}
            className="w-full py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white font-black shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition-all active:scale-95"
          >
            {guardando ? "Guardando…" : `Sí, me pagó ${pesos(actual.debe)}`}
          </button>
          <button
            type="button"
            onClick={siguiente}
            disabled={guardando}
            className="w-full py-3 rounded-2xl border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-50 transition-colors"
          >
            No, queda a deber
          </button>
        </div>

        {pendientes.length > 1 && (
          <p className="pb-4 text-center text-xs text-slate-400">
            {indice + 1} de {pendientes.length}
          </p>
        )}
      </div>
    </div>
  );
}
