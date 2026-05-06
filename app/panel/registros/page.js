"use client";
import { useEffect, useState, useRef } from "react";

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "ahora mismo";
  if (mins < 60) return `hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `hace ${hrs}h`;
  return `hace ${Math.floor(hrs / 24)}d`;
}

export default function RegistrosPage() {
  const [registros, setRegistros] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [active, setActive]       = useState(null); // id of expanded card
  const [mode, setMode]           = useState(null); // "link" | "approve"
  const [search, setSearch]       = useState("");
  const [results, setResults]     = useState([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState(null);
  const searchRef = useRef(null);

  const token = () => localStorage.getItem("panelToken") || "";

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/panel/registros", { headers: { "x-panel-token": token() } });
    const data = await res.json();
    setRegistros(data.registros || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // Search existing clients for linking
  useEffect(() => {
    if (search.trim().length < 2) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const res = await fetch(`/api/panel/registros?search=${encodeURIComponent(search)}`, {
        headers: { "x-panel-token": token() },
      });
      const data = await res.json();
      setResults(data.clients || []);
      setSearching(false);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const openCard = (id) => {
    if (active === id) { setActive(null); setMode(null); setSearch(""); setResults([]); return; }
    setActive(id);
    setMode(null);
    setSearch("");
    setResults([]);
  };

  const handleApprove = async (registroId) => {
    setSaving(true);
    const res = await fetch("/api/panel/registros", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-panel-token": token() },
      body: JSON.stringify({ action: "approve", registroId }),
    });
    if (res.ok) {
      setRegistros(prev => prev.filter(r => r.id !== registroId));
      setActive(null);
      showToast("Cliente marcado como nuevo");
    } else showToast("Error al guardar", "error");
    setSaving(false);
  };

  const handleLink = async (registroId, targetId) => {
    setSaving(true);
    const res = await fetch("/api/panel/registros", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-panel-token": token() },
      body: JSON.stringify({ action: "link", registroId, targetId }),
    });
    if (res.ok) {
      setRegistros(prev => prev.filter(r => r.id !== registroId));
      setActive(null);
      showToast("Cuenta vinculada correctamente ✓");
    } else showToast("Error al vincular", "error");
    setSaving(false);
  };

  return (
    <div className="p-6 max-w-xl mx-auto pb-16">
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-2xl shadow-xl font-semibold text-sm ${toast.type === "error" ? "bg-red-50 text-red-600 border border-red-100" : "bg-emerald-50 text-emerald-700 border border-emerald-100"}`}>
          {toast.msg}
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-900">Registros</h1>
        <p className="text-slate-500 text-sm mt-1">Clientes que se registraron en el catálogo y necesitan revisión.</p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-24 bg-slate-100 animate-pulse rounded-2xl" />)}
        </div>
      ) : registros.length === 0 ? (
        <div className="text-center py-24 text-slate-400">
          <p className="text-5xl mb-4">✅</p>
          <p className="font-bold text-lg">Sin registros pendientes</p>
          <p className="text-sm mt-1">Aquí aparecerán los nuevos clientes que se registren.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {registros.map(r => (
            <div key={r.id} className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              {/* Card header */}
              <button
                onClick={() => openCard(r.id)}
                className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-lg shrink-0 font-black text-slate-400">
                  {r.name?.[0]?.toUpperCase() || "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-black text-slate-900 text-sm">{r.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{r.instagram} · {timeAgo(r.created_at)}</p>
                </div>
                <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
              </button>

              {/* Expanded */}
              {active === r.id && (
                <div className="border-t border-slate-100 px-5 pb-5 pt-4 space-y-4">
                  {/* Info */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: "Nombre", value: r.name },
                      { label: "Instagram", value: r.instagram },
                      { label: "Teléfono", value: r.phone || "—" },
                      { label: "Correo", value: r.email || "—" },
                    ].map(f => (
                      <div key={f.label} className="bg-slate-50 rounded-xl px-3 py-2.5">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{f.label}</p>
                        <p className="text-sm font-bold text-slate-900 mt-0.5 truncate">{f.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Actions */}
                  {!mode && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => { setMode("link"); setTimeout(() => searchRef.current?.focus(), 100); }}
                        className="flex-1 py-3 rounded-xl bg-indigo-500 text-white font-bold text-sm hover:bg-indigo-400 transition-colors active:scale-95"
                      >
                        🔗 Vincular con existente
                      </button>
                      <button
                        onClick={() => handleApprove(r.id)}
                        disabled={saving}
                        className="flex-1 py-3 rounded-xl bg-emerald-500 text-white font-bold text-sm hover:bg-emerald-400 transition-colors active:scale-95 disabled:opacity-50"
                      >
                        ✨ Cliente nuevo
                      </button>
                    </div>
                  )}

                  {/* Link mode */}
                  {mode === "link" && (
                    <div className="space-y-3">
                      <p className="text-xs font-bold text-slate-500">Busca al cliente existente para vincularle esta cuenta:</p>
                      <input
                        ref={searchRef}
                        type="text"
                        placeholder="Nombre, @instagram o teléfono..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-indigo-400 focus:outline-none"
                      />
                      {searching && <p className="text-xs text-slate-400 text-center">Buscando...</p>}
                      {results.length > 0 && (
                        <div className="border border-slate-200 rounded-xl overflow-hidden">
                          {results.map(c => (
                            <button
                              key={c.id}
                              onClick={() => handleLink(r.id, c.id)}
                              disabled={saving}
                              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-indigo-50 border-b border-slate-100 last:border-0 text-left transition-colors disabled:opacity-50"
                            >
                              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-sm font-black text-indigo-500 shrink-0">
                                {c.name?.[0]?.toUpperCase()}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="font-bold text-sm text-slate-900 truncate">{c.name}</p>
                                <p className="text-xs text-slate-400 truncate">{c.instagram} · {c.phone}</p>
                              </div>
                              <span className="text-indigo-500 font-black text-lg shrink-0">→</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {search.trim().length >= 2 && !searching && results.length === 0 && (
                        <p className="text-sm text-slate-400 text-center py-2">Sin coincidencias</p>
                      )}
                      <button
                        onClick={() => { setMode(null); setSearch(""); setResults([]); }}
                        className="w-full py-2 rounded-xl border border-slate-200 text-slate-500 text-sm font-bold hover:bg-slate-50"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
