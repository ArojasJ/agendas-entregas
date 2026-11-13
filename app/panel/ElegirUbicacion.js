"use client";

import { useEffect, useState } from "react";
import { etiquetaDeLugar } from "@/lib/constants";

// Dónde se guarda la mercancía de una clienta: la misma pregunta que hace el punto de
// venta al cobrar. Vive aparte porque hacen falta las mismas opciones en más de un
// lugar —el cobro y los pedidos web— y tener dos copias acaba en que una se queda
// atrás: fue justo lo que pasó con la etiqueta de PAQUETE ARMADO.
//
// Avisa hacia afuera con onElegir; quien lo usa decide cuándo guardar.

function Opcion({ elegida, onClick, titulo, detalle, recomendada }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3.5 py-2.5 rounded-xl border transition-all active:scale-[0.99] flex items-start gap-3 ${
        elegida ? "bg-emerald-50 border-emerald-300" : "bg-white border-slate-200 hover:bg-slate-50"
      }`}
    >
      <span className={`text-base leading-none mt-0.5 ${elegida ? "text-emerald-600" : "text-slate-300"}`}>
        {elegida ? "◉" : "○"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2 flex-wrap">
          <span className={`text-sm font-bold ${elegida ? "text-emerald-800" : "text-slate-700"}`}>{titulo}</span>
          {recomendada && (
            <span className="text-[9px] font-black uppercase tracking-wider text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded">
              Sugerido
            </span>
          )}
        </span>
        {detalle && <span className="block text-[11px] text-slate-400 leading-snug mt-0.5">{detalle}</span>}
      </span>
    </button>
  );
}

export default function ElegirUbicacion({ clientId, productos = 1, elegida, onElegir,
                                          compacto = false, propuesta: dada = null }) {
  const [propia, setPropuesta] = useState(null);
  const [cargando, setCargando] = useState(false);
  // Quien ya la tenga cargada la pasa y aquí no se vuelve a pedir: el cálculo de
  // cajas libres recorre toda la base y no vale la pena hacerlo dos veces.
  const propuesta = dada || propia;

  useEffect(() => {
    if (dada || !clientId) { return; }
    let vivo = true;
    setCargando(true);
    (async () => {
      try {
        const token = localStorage.getItem("panelToken") || "";
        const res = await fetch(
          `/api/panel/ubicacion?clientId=${clientId}&productos=${productos}`,
          { headers: { "x-panel-token": token } }
        );
        const p = res.ok ? await res.json() : null;
        if (!vivo) return;
        setPropuesta(p);
        // La sugerencia se deja puesta, para que lo normal sea un solo toque.
        if (p && !elegida) {
          onElegir?.(
            p.tipo === "juntar" || p.tipo === "caja"
              ? { tipo: "caja", caja: p.caja, aMover: p.aMover || [] }
              : p.tipo === "estante" ? { tipo: "estante" } : null
          );
        }
      } catch {
        if (vivo) setPropuesta(null);
      }
      if (vivo) setCargando(false);
    })();
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, productos, dada]);

  if (!clientId) return null;
  if (cargando) {
    return (
      <div className="px-5 py-6 text-center">
        <div className="w-5 h-5 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin mx-auto" />
      </div>
    );
  }
  if (!propuesta) return null;

  return (
    <div className={compacto ? "space-y-2" : "space-y-3"}>
      {!compacto && propuesta.guardado?.length > 0 && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1.5">
          <p className="text-[11px] font-black text-slate-500 uppercase tracking-wider">Ya tiene guardado</p>
          {propuesta.guardado.map((g, i) => (
            <div key={g.saleId || `l-${i}`} className="flex items-baseline gap-2 text-sm">
              <span className={`text-[10px] font-black uppercase px-1.5 py-0.5 rounded tabular-nums ${etiquetaDeLugar(g.ubicacion, g.caja).clase}`}>
                {etiquetaDeLugar(g.ubicacion, g.caja).texto}
              </span>
              <span className="text-slate-500 text-xs leading-snug">
                {g.sinDetalle ? "sin detalle de contenido" : g.productos.map((p) => p.nombre).join(", ")}
              </span>
            </div>
          ))}
        </div>
      )}

      {propuesta.tipo === "juntar" && (
        <Opcion
          elegida={elegida?.tipo === "caja" && elegida?.caja === propuesta.caja}
          onClick={() => onElegir({ tipo: "caja", caja: propuesta.caja, aMover: propuesta.aMover || [] })}
          titulo={`Juntar todo en la caja ${propuesta.caja}`}
          detalle={propuesta.aMover?.length > 0 ? "Mueve también lo que está en estante" : "Donde ya tiene sus cosas"}
          recomendada
        />
      )}

      {propuesta.tipo === "caja" && (
        <Opcion
          elegida={elegida?.tipo === "caja" && elegida?.caja === propuesta.caja}
          onClick={() => onElegir({ tipo: "caja", caja: propuesta.caja, aMover: propuesta.aMover || [] })}
          titulo={`Caja ${propuesta.caja}`}
          detalle={propuesta.motivo}
          recomendada
        />
      )}

      <Opcion
        elegida={elegida?.tipo === "estante"}
        onClick={() => onElegir({ tipo: "estante" })}
        titulo="Poner en estante"
        detalle="Sticker con su usuario de Instagram"
        recomendada={propuesta.tipo === "estante"}
      />

      {propuesta.libres?.length > 0 && (
        <div className="pt-1">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">O elige otra caja</p>
          <div className="flex gap-1.5 flex-wrap">
            {propuesta.libres.slice(0, 8).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onElegir({ tipo: "caja", caja: n, aMover: propuesta.aMover || [] })}
                className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border transition-all active:scale-95 tabular-nums ${
                  elegida?.tipo === "caja" && elegida?.caja === n
                    ? "bg-slate-900 border-slate-900 text-white"
                    : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {propuesta.tipo === "ninguna" && propuesta.libres?.length === 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          No quedan cajas libres. Ponlo en estante o libera una caja primero.
        </p>
      )}
    </div>
  );
}
