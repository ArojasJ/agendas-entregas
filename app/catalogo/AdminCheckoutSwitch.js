"use client";
import { useState } from "react";
import { CHECKOUT_APARTADO, CHECKOUT_TIENDA } from "@/lib/constants";

const ETIQUETA = {
  [CHECKOUT_APARTADO]: "Apartado",
  [CHECKOUT_TIENDA]: "Pago en línea",
};

// Widget flotante que solo se pinta si el token guardado dice que quien mira es admin.
// La comprobación es de pantalla: quien cambie el modo real tiene que pasar por
// /api/settings, que valida el rol contra la firma del token en el servidor.
export default function AdminCheckoutSwitch({
  modoGlobal,
  vistaPrevia,
  onCambiarGlobal,
  onCambiarVistaPrevia,
}) {
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const efectivo = vistaPrevia || modoGlobal;

  const cambiarGlobal = async (modo) => {
    if (modo === modoGlobal) return;
    setGuardando(true);
    await onCambiarGlobal(modo);
    setGuardando(false);
  };

  if (!abierto) {
    return (
      <button
        onClick={() => setAbierto(true)}
        className="fixed z-[70] bg-slate-900 text-white text-xs font-bold px-3 py-2 rounded-xl shadow-lg hover:bg-slate-800 transition-colors flex items-center gap-2"
        style={{
          left: "calc(1rem + env(safe-area-inset-left, 0px))",
          bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
        }}
      >
        <span className={`w-2 h-2 rounded-full ${vistaPrevia ? "bg-amber-400" : "bg-emerald-400"}`} />
        Checkout: {ETIQUETA[efectivo]}
      </button>
    );
  }

  return (
    <div
      className="fixed z-[70] bg-white border border-slate-200 rounded-2xl shadow-2xl w-[19rem] max-w-[calc(100vw-2rem)] overflow-hidden"
      style={{
        left: "calc(1rem + env(safe-area-inset-left, 0px))",
        bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Solo admin</p>
        <button onClick={() => setAbierto(false)} className="text-slate-400 hover:text-slate-700 text-lg leading-none">×</button>
      </div>

      <div className="p-4 space-y-4">
        <div className="space-y-2">
          <p className="text-xs font-bold text-slate-700">Lo que ven las clientas</p>
          <div className="grid grid-cols-2 gap-2">
            {[CHECKOUT_APARTADO, CHECKOUT_TIENDA].map((modo) => (
              <button
                key={modo}
                onClick={() => cambiarGlobal(modo)}
                disabled={guardando}
                className={`text-xs font-bold px-2 py-2 rounded-xl border transition-all active:scale-95 disabled:opacity-50 ${
                  modoGlobal === modo
                    ? "bg-emerald-50 border-emerald-300 text-emerald-700"
                    : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                }`}
              >
                {ETIQUETA[modo]}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Esto cambia la tienda para todas, al instante.
          </p>
        </div>

        <div className="border-t border-slate-100 pt-4 space-y-2">
          <p className="text-xs font-bold text-slate-700">Probar el otro, solo tú</p>
          <button
            onClick={() => onCambiarVistaPrevia(vistaPrevia ? null : (modoGlobal === CHECKOUT_APARTADO ? CHECKOUT_TIENDA : CHECKOUT_APARTADO))}
            className={`w-full text-xs font-bold px-3 py-2 rounded-xl border transition-all active:scale-95 ${
              vistaPrevia
                ? "bg-amber-50 border-amber-300 text-amber-800"
                : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
            }`}
          >
            {vistaPrevia ? `Viendo ${ETIQUETA[vistaPrevia]} — quitar` : `Ver ${ETIQUETA[modoGlobal === CHECKOUT_APARTADO ? CHECKOUT_TIENDA : CHECKOUT_APARTADO]}`}
          </button>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Solo afecta este navegador. Tus clientas siguen viendo{" "}
            <b className="text-slate-700">{ETIQUETA[modoGlobal]}</b>.
          </p>
        </div>
      </div>
    </div>
  );
}
