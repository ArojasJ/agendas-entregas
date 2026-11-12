"use client";

import { useState } from "react";

// Qué pasó con las cajas al cancelar una venta.
//
// Cancelar devolvía el inventario pero no tocaba las cajas: la caja se quedaba
// anotada en la ficha aunque la mercancía ya hubiera vuelto a la tienda. Ahora se
// suelta sola, pero eso no basta: en esa misma caja —o en otras de la clienta— puede
// quedar mercancía de compras que NO se cancelaron. Eso no lo puede adivinar el
// sistema, así que se pregunta.
export default function CajasTrasCancelar({ cajas, clientId, onCerrar }) {
  const [juntando, setJuntando] = useState(false);
  const [error, setError] = useState("");

  if (!cajas) return null;

  const juntarEn = async (n) => {
    if (juntando) return;
    setJuntando(true);
    setError("");
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/panel/paquetes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({ accion: "juntar", clientId, juntarRestosEn: n }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.message || "No se pudo juntar.");
        return;
      }
      onCerrar?.();
    } catch {
      setError("No se pudo conectar.");
    } finally {
      setJuntando(false);
    }
  };

  const quedan = cajas.quedaGuardado?.length || 0;

  return (
    <div className="fixed inset-0 z-[80] bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-6 pt-6 pb-4 text-center">
          <div className="text-4xl mb-2">📦</div>
          <h2 className="text-xl font-black text-slate-900">¿Y la caja?</h2>
          <p className="text-sm text-slate-500 mt-1">
            La mercancía cancelada ya regresó a la tienda.
          </p>
        </div>

        <div className="px-6 space-y-3">
          {cajas.seLibero && cajas.caja != null && (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3">
              <p className="text-sm font-bold text-emerald-700">
                ✓ La caja {cajas.caja} quedó libre
              </p>
              <p className="text-xs text-emerald-600 mt-0.5">No quedó nada más adentro.</p>
            </div>
          )}

          {cajas.quedaEnLaMisma && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
              <p className="text-sm font-bold text-amber-800">
                En la caja {cajas.caja} todavía queda mercancía de otras compras
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                Por eso no se libera. Ahí siguen {quedan} producto{quedan === 1 ? "" : "s"}.
              </p>
            </div>
          )}

          {cajas.hayQueJuntar ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-bold text-slate-800 mb-1">
                Le quedó mercancía repartida en las cajas {cajas.cajasConRestos.join(" y ")}
              </p>
              <p className="text-xs text-slate-500 mb-2.5">
                ¿La juntas en una sola y sueltas las demás?
              </p>
              <div className="flex gap-2 flex-wrap">
                {cajas.cajasConRestos.map((n) => (
                  <button key={n} type="button" onClick={() => juntarEn(n)} disabled={juntando}
                    className="px-3.5 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-700 disabled:opacity-50 transition-colors active:scale-95">
                    Dejar todo en la {n}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            cajas.cajasConRestos?.length === 1 && !cajas.quedaEnLaMisma && (
              <p className="text-sm text-slate-500">
                Le sigue quedando mercancía en la caja{" "}
                <b className="text-slate-700">{cajas.cajasConRestos[0]}</b>.
              </p>
            )
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</p>
          )}
        </div>

        <div className="px-6 py-5">
          <button type="button" onClick={onCerrar} disabled={juntando}
            className="w-full py-3 rounded-2xl border border-slate-200 text-slate-700 font-bold hover:bg-slate-50 disabled:opacity-50 transition-colors">
            {cajas.hayQueJuntar ? "Dejarlas como están" : "Entendido"}
          </button>
        </div>
      </div>
    </div>
  );
}
