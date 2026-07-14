"use client";
import { useEffect, useState } from "react";

export default function ReportesPage() {
  const [cuts, setCuts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCuts();
  }, []);

  const fetchCuts = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/pos_cuts", {
        headers: { "x-panel-token": token },
      });
      if (res.ok) {
        const data = await res.json();
        setCuts(data.cuts || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (isoString) => {
    if (!isoString) return "Inicio de los tiempos";
    return new Date(isoString).toLocaleString("es-MX", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
    });
  };

  return (
    <main className="max-w-7xl mx-auto px-4 md:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Reportes de Caja</h1>
        <p className="text-sm mt-1 opacity-70">Historial de cortes de caja de mostrador.</p>
      </div>

      {/* Lista de Cortes */}
      <div className="rounded-2xl border bg-slate-50 border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center opacity-50">Cargando reportes...</div>
        ) : cuts.length === 0 ? (
          <div className="p-10 text-center opacity-50 flex flex-col items-center">
            <span className="text-4xl mb-3">📇</span>
            <p>Aún no hay cortes de caja registrados.</p>
            <p className="text-xs mt-1">Ve a Ventas y presiona "Corte de Caja".</p>
          </div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {cuts.map(cut => {
              const start = formatDateTime(cut.from_datetime);
              const end = formatDateTime(cut.to_datetime);
              
              return (
                <div key={cut.id} className="p-6 hover:bg-slate-50 transition-colors flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                  <div className="flex items-center gap-5">
                    <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-2xl">
                      📑
                    </div>
                    <div>
                      <h3 className="font-bold text-lg mb-1 text-indigo-300">Corte Generado</h3>
                      <div className="text-sm text-slate-500 space-y-1">
                        <p className="flex items-center gap-2"><span className="opacity-50">Desde:</span> {start}</p>
                        <p className="flex items-center gap-2"><span className="opacity-50">Hasta:</span> {end}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-xl px-6 py-4 text-right min-w-[200px]">
                    <span className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Total del Corte</span>
                    <span className="text-3xl font-black text-slate-900">${Number(cut.total_amount || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </main>
  );
}
