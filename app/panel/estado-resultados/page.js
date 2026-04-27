"use client";
import { useEffect, useState } from "react";

function getPanelToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("panelToken") || "";
}

function fmt(n) {
  return "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sumaItems(items) {
  return items.reduce((s, i) => s + (Number(i.cantidad) || 0), 0);
}

let _seq = 0;
function newItem() { return { id: ++_seq, concepto: "", cantidad: "" }; }

function SeccionGasto({ titulo, icono, acento, items, onChange, onAdd, onRemove }) {
  const total = sumaItems(items);
  return (
    <div className={`bg-white rounded-2xl border ${acento.border} shadow-sm overflow-hidden`}>
      <div className={`px-4 py-3 ${acento.bg} border-b ${acento.border} flex items-center justify-between gap-2`}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="shrink-0">{icono}</span>
          <span className={`font-black text-[11px] uppercase tracking-wider ${acento.text} leading-tight truncate`}>{titulo}</span>
        </div>
        <span className={`font-black text-sm shrink-0 ${acento.text}`}>{fmt(total)}</span>
      </div>
      <div className="p-3 space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex gap-1.5 items-center group">
            <input
              type="text"
              placeholder="Concepto"
              value={item.concepto}
              onChange={(e) => onChange(item.id, "concepto", e.target.value)}
              className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-slate-400 transition-colors placeholder-slate-300"
            />
            <input
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={item.cantidad}
              onChange={(e) => onChange(item.id, "cantidad", e.target.value)}
              style={{ color: "#1e293b" }}
              className="w-20 shrink-0 px-2 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold focus:outline-none focus:border-slate-400 transition-colors text-right"
            />
            <button
              onClick={() => onRemove(item.id)}
              className="w-7 h-7 shrink-0 rounded-lg opacity-0 group-hover:opacity-100 bg-red-50 hover:bg-red-100 text-red-400 text-xs flex items-center justify-center transition-all"
            >✕</button>
          </div>
        ))}
        <button
          onClick={onAdd}
          className={`w-full py-2 mt-1 rounded-xl border-2 border-dashed ${acento.dashed} text-sm font-bold ${acento.textLight} transition-colors hover:opacity-80`}
        >
          + Agregar concepto
        </button>
      </div>
    </div>
  );
}

export default function EstadoResultadosPage() {
  const [gastosAdmin, setGastosAdmin] = useState([newItem()]);
  const [gastosOp,    setGastosOp]    = useState([newItem()]);
  const [compras,     setCompras]     = useState([newItem()]);
  const [ventas,      setVentas]      = useState("");
  const [resultado,   setResultado]   = useState(null);
  const [nombreGuardar, setNombreGuardar] = useState("");
  const [guardando,   setGuardando]   = useState(false);
  const [historial,   setHistorial]   = useState([]);
  const [loadingHist, setLoadingHist] = useState(true);
  const [expandedId,  setExpandedId]  = useState(null);
  const [confirmDelId, setConfirmDelId] = useState(null);
  const [toast,       setToast]       = useState(null);

  useEffect(() => { fetchHistorial(); }, []);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchHistorial = async () => {
    setLoadingHist(true);
    try {
      const res = await fetch("/api/estados-resultados", { headers: { "x-panel-token": getPanelToken() } });
      if (res.ok) { const d = await res.json(); setHistorial(d.estados || []); }
    } finally { setLoadingHist(false); }
  };

  function makeHandlers(setter) {
    return {
      onChange: (id, field, val) => setter(prev => prev.map(i => i.id === id ? { ...i, [field]: val } : i)),
      onAdd:    ()  => setter(prev => [...prev, newItem()]),
      onRemove: (id) => setter(prev => prev.length > 1 ? prev.filter(i => i.id !== id) : prev),
    };
  }

  const calcular = () => {
    const totalEgresos   = sumaItems(gastosAdmin) + sumaItems(gastosOp) + sumaItems(compras);
    const utilidad       = (Number(ventas) || 0) - totalEgresos;
    const reserva10      = utilidad * 0.10;
    const distribuible90 = utilidad * 0.90;
    const nosotros75     = distribuible90 * 0.75;
    const socio25        = distribuible90 * 0.25;
    setResultado({ totalEgresos, utilidad, reserva10, distribuible90, nosotros75, socio25 });
  };

  const guardar = async () => {
    if (!nombreGuardar.trim()) { showToast("Ponle un nombre al estado de resultados", "err"); return; }
    if (!resultado) { showToast("Primero realiza la operación", "err"); return; }
    setGuardando(true);
    try {
      const res = await fetch("/api/estados-resultados", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": getPanelToken() },
        body: JSON.stringify({
          nombre: nombreGuardar.trim(),
          ventas: Number(ventas) || 0,
          gastos_admin: gastosAdmin,
          gastos_operativos: gastosOp,
          compras,
          total_egresos:    resultado.totalEgresos,
          utilidad:         resultado.utilidad,
          reserva_10:       resultado.reserva10,
          distribuible_90:  resultado.distribuible90,
          nosotros_75:      resultado.nosotros75,
          socio_25:         resultado.socio25,
        }),
      });
      if (res.ok) {
        showToast("Guardado correctamente");
        setNombreGuardar("");
        fetchHistorial();
      } else {
        const d = await res.json();
        showToast(d.message || "Error al guardar", "err");
      }
    } finally { setGuardando(false); }
  };

  const eliminar = async (id) => {
    await fetch(`/api/estados-resultados?id=${id}`, { method: "DELETE", headers: { "x-panel-token": getPanelToken() } });
    setConfirmDelId(null);
    fetchHistorial();
  };

  const listo = (Number(ventas) || 0) > 0;
  const hAdmin  = makeHandlers(setGastosAdmin);
  const hOp     = makeHandlers(setGastosOp);
  const hCompra = makeHandlers(setCompras);

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-2xl shadow-xl font-semibold text-sm flex items-center gap-2 transition-all ${toast.type === "err" ? "bg-red-500 text-white" : "bg-emerald-500 text-white"}`}>
          {toast.type === "err" ? "⚠" : "✓"} {toast.msg}
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 md:px-6 pt-8 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Estado de Resultados</h1>
            <p className="text-sm text-slate-500 mt-1">Captura los datos y presiona <strong>Realizar Operación</strong> para ver la distribución.</p>
          </div>
          <span className="text-3xl">📑</span>
        </div>

        {/* ── Secciones de egresos ── */}
        <div className="grid md:grid-cols-3 gap-4">
          <SeccionGasto
            titulo="Gastos Administrativos" icono="🏢"
            acento={{ bg: "bg-indigo-50", border: "border-indigo-100", text: "text-indigo-600", textLight: "text-indigo-400", dashed: "border-indigo-200" }}
            items={gastosAdmin} {...hAdmin}
          />
          <SeccionGasto
            titulo="Gastos Operativos" icono="⚙️"
            acento={{ bg: "bg-rose-50", border: "border-rose-100", text: "text-rose-600", textLight: "text-rose-400", dashed: "border-rose-200" }}
            items={gastosOp} {...hOp}
          />
          <SeccionGasto
            titulo="Compras de Producto" icono="📦"
            acento={{ bg: "bg-amber-50", border: "border-amber-100", text: "text-amber-600", textLight: "text-amber-400", dashed: "border-amber-200" }}
            items={compras} {...hCompra}
          />
        </div>

        {/* ── Ventas + Botón en misma fila ── */}
        <div className="flex flex-col sm:flex-row gap-4 items-stretch">
          <div className="bg-white border border-emerald-100 rounded-2xl shadow-sm flex-1">
            <div className="px-5 py-4 bg-emerald-50 border-b border-emerald-100 flex items-center gap-3">
              <span className="text-xl">💰</span>
              <span className="font-black text-sm uppercase tracking-wider text-emerald-600">Ventas Totales del Período</span>
            </div>
            <div className="p-4">
              <p className="text-xs text-slate-400 mb-3">Total acumulado de tus cortes de caja en este período.</p>
              <div className="relative max-w-xs">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                <input
                  type="number"
                  placeholder="0.00"
                  value={ventas}
                  onChange={e => { setVentas(e.target.value); setResultado(null); }}
                  className="w-full pl-9 pr-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 font-bold text-lg focus:outline-none focus:border-emerald-400 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Botón */}
          <button
            onClick={calcular}
            disabled={!listo}
            className="sm:w-56 py-4 px-6 rounded-2xl bg-slate-900 hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-black text-base transition-all active:scale-[0.99] shadow-lg shadow-slate-900/10 flex items-center justify-center gap-3"
          >
            <span className="text-2xl">🧮</span>
            <span>Realizar<br/>Operación</span>
          </button>
        </div>

        {/* ── Resultado ── */}
        {resultado && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            {/* Banner de utilidad */}
            <div className={`px-6 py-5 ${resultado.utilidad >= 0 ? "bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100" : "bg-red-50 border-b border-red-100"}`}>
              <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Utilidad del Período</p>
              <p className={`text-4xl font-black ${resultado.utilidad >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                {fmt(resultado.utilidad)}
              </p>
              <p className="text-xs text-slate-400 mt-1">{fmt(Number(ventas))} ventas − {fmt(resultado.totalEgresos)} egresos</p>
            </div>

            {resultado.utilidad > 0 && (
              <div className="p-6 grid md:grid-cols-2 gap-6">
                {/* Desglose */}
                <div className="space-y-3">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Desglose de Egresos</p>
                  {[
                    { label: "Gastos Administrativos", val: sumaItems(gastosAdmin), color: "text-indigo-500" },
                    { label: "Gastos Operativos",       val: sumaItems(gastosOp),    color: "text-rose-500" },
                    { label: "Compras de Producto",     val: sumaItems(compras),     color: "text-amber-500" },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between items-center py-2 border-b border-slate-100">
                      <span className="text-sm text-slate-600">{r.label}</span>
                      <span className={`font-bold text-sm ${r.color}`}>{fmt(r.val)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between items-center pt-1">
                    <span className="text-sm font-bold text-slate-700">Total Egresos</span>
                    <span className="font-black text-slate-800">{fmt(resultado.totalEgresos)}</span>
                  </div>
                </div>

                {/* Distribución */}
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Distribución</p>
                  <div className="bg-slate-50 rounded-2xl p-4 space-y-3 border border-slate-100">
                    <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                      <span className="text-sm text-slate-500">Reserva (10%)</span>
                      <span className="font-bold text-slate-600">{fmt(resultado.reserva10)}</span>
                    </div>
                    <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                      <span className="text-sm text-slate-500">Para distribuir (90%)</span>
                      <span className="font-bold text-slate-700">{fmt(resultado.distribuible90)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 bg-emerald-50 rounded-xl px-3">
                      <span className="text-sm font-bold text-emerald-700">🏠 Nosotros (75%)</span>
                      <span className="font-black text-emerald-600 text-lg">{fmt(resultado.nosotros75)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 bg-indigo-50 rounded-xl px-3">
                      <span className="text-sm font-bold text-indigo-700">🤝 Socio (25%)</span>
                      <span className="font-black text-indigo-600 text-lg">{fmt(resultado.socio25)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Guardar */}
            <div className="px-6 pb-6 border-t border-slate-100 pt-5">
              <p className="text-sm font-bold text-slate-600 mb-3">Guardar este estado de resultados</p>
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder='Ej: "Abril 2026" o "Q1 2026"'
                  value={nombreGuardar}
                  onChange={e => setNombreGuardar(e.target.value)}
                  className="flex-1 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-emerald-400 transition-colors"
                />
                <button
                  onClick={guardar}
                  disabled={guardando || !nombreGuardar.trim()}
                  className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white font-black text-sm transition-all active:scale-95 shadow-lg shadow-emerald-500/20"
                >
                  {guardando ? "Guardando…" : "💾 Guardar"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Historial ── */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
            <span className="text-xl">📂</span>
            <h2 className="font-black text-slate-800">Historial</h2>
            {historial.length > 0 && (
              <span className="ml-auto text-xs font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">{historial.length} guardados</span>
            )}
          </div>

          {loadingHist ? (
            <div className="p-10 flex justify-center">
              <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : historial.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-3xl mb-3">📋</p>
              <p className="text-slate-400 text-sm">Aún no hay estados guardados.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {historial.map(e => (
                <div key={e.id} className="px-5 py-4 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-black text-slate-800 truncate">{e.nombre}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {new Date(e.created_at).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {confirmDelId === e.id ? (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-1.5">
                          <span className="text-xs text-red-600 font-bold">¿Eliminar?</span>
                          <button
                            onClick={() => eliminar(e.id)}
                            className="px-2.5 py-1 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-black transition-colors"
                          >Sí</button>
                          <button
                            onClick={() => setConfirmDelId(null)}
                            className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-600 text-xs font-bold border border-slate-200 transition-colors"
                          >No</button>
                        </div>
                      ) : (
                        <>
                          <div className="text-right">
                            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Nosotros</p>
                            <p className="font-black text-emerald-600">{fmt(e.nosotros_75)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Socio</p>
                            <p className="font-black text-indigo-500">{fmt(e.socio_25)}</p>
                          </div>
                          <button
                            onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 text-sm flex items-center justify-center transition-colors"
                          >{expandedId === e.id ? "▲" : "▼"}</button>
                          <button
                            onClick={() => setConfirmDelId(e.id)}
                            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 hover:text-red-500 text-slate-400 text-sm flex items-center justify-center transition-colors"
                          >🗑</button>
                        </>
                      )}
                    </div>
                  </div>

                  {expandedId === e.id && (
                    <div className="mt-4 grid md:grid-cols-2 gap-3 text-sm">
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Resumen</p>
                        {[["Ventas", e.ventas], ["Total Egresos", e.total_egresos], ["Utilidad", e.utilidad]].map(([l, v]) => (
                          <div key={l} className="flex justify-between">
                            <span className="text-slate-500">{l}</span>
                            <span className="font-bold">{fmt(v)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Distribución</p>
                        {[["Reserva 10%", e.reserva_10, ""], ["Distribuible 90%", e.distribuible_90, ""], ["Nosotros 75%", e.nosotros_75, "text-emerald-600"], ["Socio 25%", e.socio_25, "text-indigo-500"]].map(([l, v, cls]) => (
                          <div key={l} className="flex justify-between">
                            <span className="text-slate-500">{l}</span>
                            <span className={`font-bold ${cls}`}>{fmt(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
