"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { decodePanelTokenUnsafe } from "@/lib/panelToken";

const PERIODOS = [
  { v: "90", t: "Últimos 3 meses" },
  { v: "180", t: "Últimos 6 meses" },
  { v: "todo", t: "Todo" },
];

const fecha = (iso) =>
  new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });

const diasDesde = (iso) => Math.floor((Date.now() - new Date(iso)) / 86400000);

export default function ChequeoPage() {
  const router = useRouter();
  const [clientes, setClientes] = useState([]);
  const [total, setTotal] = useState({ productos: 0, clientes: 0 });
  const [periodo, setPeriodo] = useState("90");
  const [cargando, setCargando] = useState(true);
  const [trabajando, setTrabajando] = useState(null);
  const [resueltos, setResueltos] = useState(0);
  const [busqueda, setBusqueda] = useState("");

  const token = () => localStorage.getItem("panelToken") || "";

  useEffect(() => {
    const sesion = decodePanelTokenUnsafe(localStorage.getItem("panelToken"));
    if (sesion?.role !== "admin") { router.push("/panel"); return; }
    cargar(periodo);
  }, []);

  const cargar = async (p) => {
    setCargando(true);
    try {
      const res = await fetch(`/api/panel/chequeo?periodo=${p}`, {
        headers: { "x-panel-token": token() },
      });
      if (res.ok) {
        const d = await res.json();
        setClientes(d.clientes || []);
        setTotal({ productos: d.totalProductos || 0, clientes: d.totalClientes || 0 });
      }
    } catch {}
    setCargando(false);
  };

  const cambiarPeriodo = (p) => { setPeriodo(p); cargar(p); };

  const accionar = async (cliente, accion, productos) => {
    const clave = `${cliente.id}-${productos.map((p) => p.itemId).join(",")}`;
    setTrabajando(clave);
    try {
      const cuerpo = accion === "entregado"
        ? { accion, itemIds: productos.map((p) => p.itemId), clientId: cliente.id }
        : { accion, saleIds: [...new Set(productos.map((p) => p.saleId))] };

      const res = await fetch("/api/panel/chequeo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-panel-token": token() },
        body: JSON.stringify(cuerpo),
      });

      if (!res.ok) {
        const d = await res.json();
        alert(d.message || "No se pudo guardar.");
        setTrabajando(null);
        return;
      }

      const ids = new Set(productos.map((p) => p.itemId));
      setResueltos((n) => n + productos.length);

      if (accion === "entregado") {
        // Lo entregado sale de la lista; ya no hay nada que ubicar
        setClientes((prev) =>
          prev
            .map((c) => c.id !== cliente.id ? c
              : { ...c, productos: c.productos.filter((p) => !ids.has(p.itemId)) })
            .filter((c) => c.productos.length > 0)
        );
      } else {
        // En estante queda registrado y deja de ser un pendiente de revisión
        setClientes((prev) =>
          prev
            .map((c) => c.id !== cliente.id ? c
              : { ...c, productos: c.productos.filter((p) => !ids.has(p.itemId)) })
            .filter((c) => c.productos.length > 0)
        );
      }
    } catch {
      alert("Error de conexión.");
    }
    setTrabajando(null);
  };

  const visibles = busqueda.trim()
    ? clientes.filter((c) => {
        const q = busqueda.toLowerCase();
        return (c.instagram || "").toLowerCase().includes(q)
          || (c.nombre || "").toLowerCase().includes(q);
      })
    : clientes;

  const pendientes = clientes.reduce((n, c) => n + c.productos.length, 0);

  return (
    <div className="min-h-screen bg-slate-50 pb-16">
      <div className="max-w-4xl mx-auto px-5 py-8 space-y-6">

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-black text-slate-900">Chequeo</h1>
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                Provisional
              </span>
            </div>
            <p className="text-sm text-slate-500 max-w-xl leading-relaxed">
              Productos sin entregar que quedaron sin lugar registrado. Revisa con la conversación
              y la bodega, y marca dónde está cada uno. Lo que marques aquí queda aplicado en todo
              el sistema.
            </p>
          </div>
          {resueltos > 0 && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 text-center">
              <p className="text-xl font-black text-emerald-700 tabular-nums">{resueltos}</p>
              <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Resueltos</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {PERIODOS.map(({ v, t }) => (
            <button
              key={v}
              onClick={() => cambiarPeriodo(v)}
              className={`text-xs font-bold px-3 py-2 rounded-xl border transition-all active:scale-95 ${
                periodo === v
                  ? "bg-slate-900 border-slate-900 text-white"
                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t}
            </button>
          ))}
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar clienta…"
            className="flex-1 min-w-[12rem] px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:border-slate-400"
          />
        </div>

        {!cargando && (
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
            {pendientes} producto{pendientes === 1 ? "" : "s"} · {visibles.length} clienta{visibles.length === 1 ? "" : "s"}
          </p>
        )}

        {cargando ? (
          <div className="py-20 text-center">
            <div className="w-7 h-7 border-4 border-slate-300 border-t-slate-700 rounded-full animate-spin mx-auto" />
          </div>
        ) : visibles.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-5xl mb-3">✓</p>
            <p className="font-black text-slate-700">
              {busqueda ? "Nadie con ese nombre" : "No queda nada por revisar en este periodo"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibles.map((c) => {
              const todos = c.productos;
              const clave = `${c.id}-${todos.map((p) => p.itemId).join(",")}`;
              const ocupado = trabajando === clave;
              const masViejo = Math.max(...todos.map((p) => diasDesde(p.compradoEl)));

              return (
                <div key={c.id} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="font-black text-slate-900 leading-tight">
                        {c.instagram ? `@${c.instagram.replace(/^@/, "")}` : c.nombre}
                      </p>
                      <p className="text-xs text-slate-400">
                        {c.instagram && c.nombre ? c.nombre + " · " : ""}
                        {todos.length} producto{todos.length === 1 ? "" : "s"}
                        {masViejo > 0 && ` · el más viejo de hace ${masViejo} días`}
                      </p>
                    </div>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {todos.map((p) => (
                      <div key={p.itemId} className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-800 leading-snug">
                            {p.cantidad > 1 && <span className="text-slate-400">{p.cantidad}× </span>}
                            {p.nombre}
                          </p>
                          <p className="text-[11px] text-slate-400">Comprado el {fecha(p.compradoEl)}</p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => accionar(c, "entregado", [p])}
                            disabled={!!trabajando}
                            className="text-xs font-bold px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors active:scale-95 disabled:opacity-50"
                          >
                            ✓ Ya entregado
                          </button>
                          <button
                            onClick={() => accionar(c, "estante", [p])}
                            disabled={!!trabajando}
                            className="text-xs font-bold px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors active:scale-95 disabled:opacity-50"
                          >
                            🏷️ En estante
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {todos.length > 1 && (
                    <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex gap-2 flex-wrap">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider self-center mr-1">
                        Todo de esta clienta:
                      </span>
                      <button
                        onClick={() => accionar(c, "entregado", todos)}
                        disabled={!!trabajando}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg border border-emerald-200 bg-white text-emerald-700 hover:bg-emerald-50 transition-colors active:scale-95 disabled:opacity-50"
                      >
                        {ocupado ? "…" : "✓ Ya entregado"}
                      </button>
                      <button
                        onClick={() => accionar(c, "estante", todos)}
                        disabled={!!trabajando}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 transition-colors active:scale-95 disabled:opacity-50"
                      >
                        🏷️ En estante
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
