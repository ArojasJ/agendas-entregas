"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { decodePanelTokenUnsafe } from "@/lib/panelToken";

const diaLargo = (iso) =>
  new Date(iso + "T12:00:00").toLocaleDateString("es-MX", {
    weekday: "long", day: "numeric", month: "long",
  });

const hoyISO = () => new Date().toLocaleDateString("en-CA");

export default function BitacoraPage() {
  const router = useRouter();
  const [dias, setDias] = useState([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [marcando, setMarcando] = useState(null);
  const [historial, setHistorial] = useState("");

  const token = () => localStorage.getItem("panelToken") || "";

  useEffect(() => {
    const sesion = decodePanelTokenUnsafe(localStorage.getItem("panelToken"));
    if (sesion?.role !== "admin") { router.push("/panel"); return; }
    cargar("");
  }, []);

  const cargar = async (dia) => {
    setCargando(true);
    try {
      const res = await fetch("/api/panel/bitacora" + (dia ? `?dia=${dia}` : ""), {
        headers: { "x-panel-token": token() },
      });
      if (res.ok) {
        const d = await res.json();
        setDias(d.dias || []);
        setTotal(d.total || 0);
      }
    } catch {}
    setCargando(false);
  };

  const marcar = async (ids, hecha = true) => {
    setMarcando(ids.join(","));
    try {
      const res = await fetch("/api/panel/bitacora", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-panel-token": token() },
        body: JSON.stringify({ ids, hecha }),
      });
      if (res.ok) await cargar(historial);
      else alert((await res.json()).message || "No se pudo guardar.");
    } catch {
      alert("Error de conexión.");
    }
    setMarcando(null);
  };

  const verHistorial = (dia) => { setHistorial(dia); cargar(dia); };

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <div className="max-w-3xl mx-auto px-5 py-8 space-y-6">

        <div>
          <h1 className="text-2xl font-black text-slate-900">Bitácora</h1>
          <p className="text-sm text-slate-500 mt-1 leading-relaxed max-w-xl">
            {historial
              ? "Consultando lo que se hizo ese día."
              : "Lo que hay que guardar al llegar a la bodega. Se anota solo cuando vendes estando fuera."}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { setHistorial(""); cargar(""); }}
            className={`text-xs font-bold px-3 py-2 rounded-xl border transition-all active:scale-95 ${
              !historial ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100"
            }`}
          >
            Pendiente
          </button>
          <input
            type="date"
            value={historial}
            max={hoyISO()}
            onChange={(e) => verHistorial(e.target.value)}
            className="text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 bg-white text-slate-600 focus:outline-none focus:border-slate-400"
          />
          {historial && (
            <button
              onClick={() => { setHistorial(""); cargar(""); }}
              className="text-xs font-bold text-slate-400 hover:text-slate-700 px-2"
            >
              Quitar fecha
            </button>
          )}
        </div>

        {cargando ? (
          <div className="py-20 text-center">
            <div className="w-7 h-7 border-4 border-slate-300 border-t-slate-700 rounded-full animate-spin mx-auto" />
          </div>
        ) : dias.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-5xl mb-3">{historial ? "📭" : "✓"}</p>
            <p className="font-black text-slate-700">
              {historial ? "Nada ese día" : "Todo al corriente"}
            </p>
            {!historial && (
              <p className="text-sm text-slate-400 mt-1">
                No hay nada pendiente de guardar en la bodega.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {!historial && (
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                {total} tarea{total === 1 ? "" : "s"} pendiente{total === 1 ? "" : "s"}
              </p>
            )}

            {dias.map(({ fecha, tareas }) => {
              const pendientes = tareas.filter((t) => !t.hecha);
              return (
                <div key={fecha} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
                    <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">
                      {diaLargo(fecha)}
                    </p>
                    {pendientes.length > 1 && (
                      <button
                        onClick={() => marcar(pendientes.map((t) => t.id))}
                        disabled={!!marcando}
                        className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
                      >
                        ✓ Todo este día
                      </button>
                    )}
                  </div>

                  <div className="divide-y divide-slate-100">
                    {tareas.map((t) => (
                      <div key={t.id} className="px-5 py-3 flex items-start gap-3">
                        <button
                          onClick={() => marcar([t.id], !t.hecha)}
                          disabled={!!marcando}
                          className={`w-5 h-5 rounded-md border-2 shrink-0 mt-0.5 transition-all active:scale-90 flex items-center justify-center ${
                            t.hecha
                              ? "bg-emerald-500 border-emerald-500 text-white text-xs"
                              : "border-slate-300 hover:border-emerald-500"
                          }`}
                        >
                          {t.hecha ? "✓" : ""}
                        </button>

                        <div className={`min-w-0 flex-1 ${t.hecha ? "opacity-50" : ""}`}>
                          <div className="flex items-baseline gap-2 flex-wrap">
                            {t.ubicacion === "caja" ? (
                              <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 tabular-nums">
                                Caja {t.caja}
                              </span>
                            ) : t.ubicacion === "estante" ? (
                              <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">
                                Estante
                              </span>
                            ) : (
                              <span className="text-[10px] font-black uppercase px-1.5 py-0.5 rounded bg-slate-200 text-slate-600">
                                Sin lugar
                              </span>
                            )}
                            <span className="text-sm font-bold text-slate-900">
                              {t.cliente?.startsWith("@") ? t.cliente : `@${t.cliente}`}
                            </span>
                          </div>

                          <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                            {t.productos || "sin detalle de productos"}
                          </p>

                          {t.ubicacion === "estante" && !t.hecha && (
                            <p className="text-[11px] text-rose-600 font-semibold mt-1">
                              Ponerle sticker con su usuario y colocar en estante
                            </p>
                          )}
                          {!t.ubicacion && !t.hecha && (
                            <p className="text-[11px] text-amber-600 font-semibold mt-1">
                              Esta venta no tiene lugar asignado — decide dónde va
                            </p>
                          )}
                          {t.hecha && t.hechaAt && (
                            <p className="text-[11px] text-slate-400 mt-1">
                              Hecho{t.hechaPor ? ` por ${t.hechaPor}` : ""} el{" "}
                              {new Date(t.hechaAt).toLocaleString("es-MX", {
                                day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
                              })}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
