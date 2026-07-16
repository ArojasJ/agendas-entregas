"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";

const ACTION_LABELS = {
  delete_sale:    { label: "Eliminó venta",     icon: "🗑",  color: "text-red-500 bg-red-500/10 border-red-500/20" },
  delete_product: { label: "Eliminó producto",  icon: "📦",  color: "text-orange-500 bg-orange-500/10 border-orange-500/20" },
  stock_add:      { label: "Agregó al stock",   icon: "📈",  color: "text-emerald-600 bg-emerald-500/10 border-emerald-500/20" },
  stock_remove:   { label: "Quitó del stock",   icon: "📉",  color: "text-amber-600 bg-amber-500/10 border-amber-500/20" },
};

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function HistorialPage() {
  const router = useRouter();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState("all");
  const [filterStaff, setFilterStaff] = useState("all");
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    const role = localStorage.getItem("panelRole");
    if (role !== "admin") { router.push("/panel"); return; }
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/audit-logs?limit=200", { headers: { "x-panel-token": token } });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const staffList = useMemo(() => {
    const names = [...new Set(logs.map(l => l.staff_name).filter(Boolean))];
    return names.sort();
  }, [logs]);

  const filtered = useMemo(() => {
    return logs.filter(l => {
      if (filterType !== "all" && l.action !== filterType) return false;
      if (filterStaff !== "all" && l.staff_name !== filterStaff) return false;
      return true;
    });
  }, [logs, filterType, filterStaff]);

  return (
    <main className="max-w-4xl mx-auto px-4 md:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Historial de Acciones</h1>
        <p className="text-sm mt-1 opacity-70">Registro de eliminaciones realizadas por el equipo.</p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium focus:outline-none focus:border-emerald-500"
        >
          <option value="all">Todas las acciones</option>
          <option value="delete_sale">Ventas eliminadas</option>
          <option value="delete_product">Productos eliminados</option>
          <option value="stock_add">Stock agregado</option>
          <option value="stock_remove">Stock quitado</option>
        </select>

        <select
          value={filterStaff}
          onChange={e => setFilterStaff(e.target.value)}
          className="px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm font-medium focus:outline-none focus:border-emerald-500"
        >
          <option value="all">Todos los empleados</option>
          {staffList.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>

        <span className="ml-auto text-sm text-slate-400 self-center">{filtered.length} registros</span>
      </div>

      {loading ? (
        <div className="p-10 text-center opacity-50">Cargando historial...</div>
      ) : filtered.length === 0 ? (
        <div className="p-10 text-center">
          <p className="text-4xl mb-3">📋</p>
          <p className="text-slate-500 font-medium">Sin registros aún</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(log => {
            const meta = ACTION_LABELS[log.action] || { label: log.action, icon: "⚡", color: "text-slate-500 bg-slate-100 border-slate-200" };
            const snap = log.entity_snapshot;
            const isOpen = expanded === log.id;

            // Resumen legible del snapshot
            let summary = null;
            if (log.action === "delete_sale" && snap) {
              const clientInfo = snap.instagram ? `@${snap.instagram.replace(/^@/, "")}` : snap.fullName || "Sin cliente";
              const items = snap.sale_items?.map(i => `${i.quantity}x ${i.products?.name || "producto"}`).join(", ") || "—";
              summary = { title: `$${Number(snap.total || 0).toFixed(2)} — ${clientInfo}`, detail: items };
            } else if (log.action === "delete_product" && snap) {
              summary = { title: snap.name || "Sin nombre", detail: `Precio: $${snap.price || 0} · Stock: ${snap.stock ?? "—"} · Cat: ${snap.category || "—"}` };
            } else if ((log.action === "stock_add" || log.action === "stock_remove") && snap) {
              const productLabel = snap.variant_name
                ? `${snap.product_name} — ${snap.variant_name}`
                : snap.product_name || "Producto";
              const arrow = log.action === "stock_add" ? "+" : "-";
              summary = {
                title: productLabel,
                detail: `${snap.old_stock ?? "?"} → ${snap.new_stock ?? "?"} piezas (${arrow}${snap.diff ?? "?"})`,
              };
            }

            return (
              <div key={log.id} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <div
                  className="p-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors"
                  onClick={() => setExpanded(isOpen ? null : log.id)}
                >
                  <span className={`text-lg px-2 py-1 rounded-lg border text-base ${meta.color}`}>{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-black uppercase tracking-wide px-2 py-0.5 rounded-md border ${meta.color}`}>{meta.label}</span>
                      <span className="text-sm font-semibold text-slate-700 truncate">{summary?.title || `ID: ${log.entity_id}`}</span>
                    </div>
                    {summary?.detail && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{summary.detail}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-slate-600">{log.staff_name || "—"}</p>
                    <p className="text-[10px] text-slate-400">{formatDate(log.created_at)}</p>
                  </div>
                  <span className="text-slate-300 text-sm">{isOpen ? "▲" : "▼"}</span>
                </div>

                {isOpen && snap && (
                  <div className="border-t border-slate-100 bg-slate-50 p-4 space-y-3">
                    {log.action === "delete_sale" ? (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <div className="bg-white border border-slate-200 rounded-xl p-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total</p>
                            <p className="font-black text-slate-900">${Number(snap.total || 0).toFixed(2)}</p>
                          </div>
                          <div className="bg-white border border-slate-200 rounded-xl p-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Enganche pagado</p>
                            <p className="font-black text-emerald-600">${Number(snap.down_payment || 0).toFixed(2)}</p>
                          </div>
                          <div className="bg-white border border-slate-200 rounded-xl p-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Método de pago</p>
                            <p className="font-bold text-slate-700">{snap.payment_method || "—"}</p>
                          </div>
                          <div className="bg-white border border-slate-200 rounded-xl p-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Estado al eliminar</p>
                            <p className="font-bold text-slate-700 capitalize">{snap.status || "—"}</p>
                          </div>
                          <div className="bg-white border border-slate-200 rounded-xl p-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Descuento</p>
                            <p className="font-bold text-slate-700">${snap.discount || 0}</p>
                          </div>
                          <div className="bg-white border border-slate-200 rounded-xl p-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Fecha de venta</p>
                            <p className="font-bold text-slate-700">{formatDate(snap.created_at)}</p>
                          </div>
                        </div>
                        {snap.sale_items?.length > 0 && (
                          <div className="bg-white border border-slate-200 rounded-xl p-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Productos vendidos</p>
                            <div className="space-y-1.5">
                              {snap.sale_items.map((item, i) => (
                                <div key={i} className="flex justify-between text-sm">
                                  <span className="text-slate-700">{item.quantity}x <span className="font-semibold">{item.products?.name || "Producto borrado"}</span></span>
                                  <span className="text-slate-500">${Number(item.unit_price || 0).toFixed(2)} c/u</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    ) : log.action === "delete_product" ? (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          <div className="bg-white border border-slate-200 rounded-xl p-3 sm:col-span-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Nombre del producto</p>
                            <p className="font-black text-slate-900">{snap.name || "—"}</p>
                          </div>
                          <div className="bg-white border border-slate-200 rounded-xl p-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Precio</p>
                            <p className="font-black text-slate-900">${Number(snap.price || 0).toFixed(2)}</p>
                          </div>
                          <div className="bg-white border border-slate-200 rounded-xl p-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Stock al eliminar</p>
                            <p className="font-black text-slate-900">{snap.stock ?? "—"} uds.</p>
                          </div>
                          <div className="bg-white border border-slate-200 rounded-xl p-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Categoría</p>
                            <p className="font-bold text-slate-700">{snap.category || "—"}</p>
                          </div>
                          <div className="bg-white border border-slate-200 rounded-xl p-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Costo</p>
                            <p className="font-bold text-slate-700">${Number(snap.cost || 0).toFixed(2)}</p>
                          </div>
                          <div className="bg-white border border-slate-200 rounded-xl p-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Código de barras</p>
                            <p className="font-bold text-slate-700">{snap.barcode || "—"}</p>
                          </div>
                        </div>
                        {snap.product_variants?.length > 0 && (
                          <div className="bg-white border border-slate-200 rounded-xl p-3">
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Variantes eliminadas</p>
                            <div className="space-y-1.5">
                              {snap.product_variants.map((v, i) => (
                                <div key={i} className="flex justify-between text-sm">
                                  <span className="text-slate-700 font-semibold">{v.option_type}: {v.name}</span>
                                  <span className="text-slate-500">Stock: {v.stock ?? "—"} · ${Number(v.price || 0).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (log.action === "stock_add" || log.action === "stock_remove") ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-white border border-slate-200 rounded-xl p-3 sm:col-span-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Producto</p>
                          <p className="font-black text-slate-900">{snap.product_name || "—"}</p>
                          {snap.variant_name && (
                            <p className="text-xs text-slate-400 mt-0.5">Variante: {snap.variant_name}</p>
                          )}
                        </div>
                        <div className="bg-white border border-slate-200 rounded-xl p-3">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Stock anterior</p>
                          <p className="font-black text-slate-500">{snap.old_stock ?? "—"} pzs.</p>
                        </div>
                        <div className="bg-white border border-slate-200 rounded-xl p-3">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Stock nuevo</p>
                          <p className="font-black text-slate-900">{snap.new_stock ?? "—"} pzs.</p>
                        </div>
                        <div className={`bg-white border rounded-xl p-3 ${log.action === "stock_add" ? "border-emerald-200" : "border-amber-200"}`}>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Cambio</p>
                          <p className={`font-black text-lg ${log.action === "stock_add" ? "text-emerald-600" : "text-amber-600"}`}>
                            {log.action === "stock_add" ? "+" : "-"}{snap.diff ?? "?"} pzs.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <pre className="text-xs text-slate-600 overflow-x-auto whitespace-pre-wrap bg-white border border-slate-200 rounded-xl p-3 max-h-64 overflow-y-auto">
                        {JSON.stringify(snap, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
