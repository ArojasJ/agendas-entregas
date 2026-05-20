"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function VentasPage() {
  const router = useRouter();
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState(""); // "" | "catalog" | "manual"
  const [panelRole, setPanelRole] = useState(null);

  // Modales y alertas
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });
  const [confirmDelete, setConfirmDelete] = useState({ show: false, saleId: null });
  const [confirmCut, setConfirmCut] = useState(false);

  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "success" }), 4000);
  };

  useEffect(() => {
    fetchSales();
    const savedRole = localStorage.getItem("panelRole");
    if (savedRole) setPanelRole(savedRole);
  }, []);

  const fetchSales = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/sales", {
        headers: { "x-panel-token": token },
      });
      if (res.ok) {
        const data = await res.json();
        setSales(data.sales || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const executeDelete = async () => {
    const id = confirmDelete.saleId;
    setConfirmDelete({ show: false, saleId: null });
    
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/sales?id=${id}`, {
        method: "DELETE",
        headers: { "x-panel-token": token },
      });
      if (res.ok) {
        fetchSales();
        showToast("Venta eliminada y stock restaurado", "success");
      } else {
        const d = await res.json();
        showToast(d.message || "Error al eliminar", "error");
      }
    } catch (e) {
      showToast("Error de conexión", "error");
    }
  };

  const executeCut = async () => {
    setConfirmCut(false);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/pos_cuts", {
        method: "POST",
        headers: { "x-panel-token": token }
      });
      if (res.ok) {
        fetchSales();
        showToast("Corte de caja realizado con éxito", "success");
      } else {
        const d = await res.json();
        showToast(d.message || "Error al hacer corte", "error");
      }
    } catch (e) {
      showToast("Error de conexión", "error");
    }
  };

  const pendingSales = sales.filter(s => s.pos_cut_id === null && s.status !== "catalog_pending" && s.status !== "cancelled");

  // Enganches de ventas sin corte
  const totalDownPayments = pendingSales.reduce((sum, sale) => sum + (Number(sale.down_payment) || 0), 0);

  // Abonos sin corte de TODAS las ventas (incluyendo ventas ya cortadas con abonos posteriores)
  const totalAbonos = sales.reduce((sum, sale) => {
    if (sale.status === "catalog_pending" || sale.status === "cancelled") return sum;
    const abonos = (sale.payments || [])
      .filter(p => p.pos_cut_id === null)
      .reduce((ps, p) => ps + Number(p.amount), 0);
    return sum + abonos;
  }, 0);

  const totalCaja = totalDownPayments + totalAbonos;

  const filteredSales = sales.filter((s) => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const ig = (s.clients?.instagram || "").toLowerCase();
      const name = (s.clients?.name || "").toLowerCase();
      const idStr = String(s.id);
      if (!ig.includes(q) && !name.includes(q) && !idStr.includes(q)) return false;
    }
    if (dateFilter) {
      const saleDate = new Date(s.created_at).toLocaleDateString("en-CA"); // YYYY-MM-DD
      if (saleDate !== dateFilter) return false;
    }
    if (typeFilter === "catalog") {
      if (s.status !== "catalog_pending" && s.status !== "catalog_viewed") return false;
    }
    if (typeFilter === "manual") {
      if (s.status === "catalog_pending" || s.status === "catalog_viewed") return false;
    }
    return true;
  });

  return (
    <main className="max-w-7xl mx-auto px-4 md:px-8 py-8 relative">
      
      {/* TOAST */}
      <div className={`fixed top-6 right-6 z-[60] transition-all duration-500 transform ${toast.show ? "translate-y-0 opacity-100" : "-translate-y-10 opacity-0 pointer-events-none"}`}>
        <div className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-md ${toast.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-600' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600'}`}>
          <span className="text-xl">{toast.type === 'error' ? '⚠️' : '✓'}</span>
          <span className="font-semibold text-sm">{toast.message}</span>
        </div>
      </div>

      {/* CONFIRM DELETE MODAL */}
      {confirmDelete.show && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">🗑</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">¿Eliminar venta?</h3>
              <p className="text-sm text-slate-500">El dinero se restará de tu corte y los productos volverán automáticamente al inventario.</p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-3">
              <button onClick={() => setConfirmDelete({ show: false, saleId: null })} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors">Cancelar</button>
              <button onClick={executeDelete} className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold shadow-lg shadow-red-500/20 transition-all">Sí, eliminar</button>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRM CUT MODAL */}
      {confirmCut && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">✂️</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">¿Hacer Corte de Caja?</h3>
              <p className="text-sm text-slate-500">Se registrará un corte por <strong>${totalCaja.toFixed(2)}</strong> y el "Ingreso Total" volverá a $0.00.</p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-3">
              <button onClick={() => setConfirmCut(false)} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors">Cancelar</button>
              <button onClick={executeCut} className="flex-1 px-4 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold shadow-lg shadow-emerald-500/20 transition-all">Sí, cortar caja</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">VENTAS</h1>
          <p className="text-sm mt-1 opacity-70">Registro de ventas en mostrador (pagadas y a crédito).</p>
        </div>
        
        {panelRole === "admin" && (
          <div className="flex flex-col md:flex-row items-stretch md:items-center gap-4">
            <div className="bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.15),transparent)] border border-emerald-500/20 rounded-2xl p-4 flex flex-col items-end shadow-inner min-w-[200px]">
              <span className="text-xs font-medium text-emerald-600 uppercase tracking-widest mb-1">INGRESO TOTAL</span>
              <span className="text-3xl font-black text-emerald-600 tracking-tight">${totalCaja.toFixed(2)}</span>
              <span className="text-[10px] opacity-50 mt-1">Sin hacer corte</span>
            </div>
            
            <button 
              onClick={() => setConfirmCut(true)}
              disabled={pendingSales.length === 0}
              className="h-full px-6 py-4 rounded-2xl border-2 border-emerald-500/50 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold transition-all disabled:opacity-30 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-1"
            >
              <span className="text-xl">✂️</span>
              <span>Corte de Caja</span>
            </button>
          </div>
        )}
      </div>

      {/* BARRA DE BÚSQUEDA Y FILTROS */}
      <div className="mb-6 flex flex-col gap-3">
        <div className="relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">🔍</span>
          <input
            type="text"
            placeholder="Buscar por cliente (@instagram o nombre)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-2xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all shadow-sm text-slate-900 placeholder-slate-400"
          />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {/* Filtro por fecha */}
          <div className="relative">
            <input
              type="date"
              value={dateFilter}
              onChange={e => setDateFilter(e.target.value)}
              className={`py-2 px-3 rounded-xl border text-sm focus:outline-none transition-colors ${dateFilter ? "bg-emerald-50 border-emerald-400 text-emerald-700 font-semibold" : "bg-white border-slate-200 text-slate-500"}`}
            />
            {dateFilter && (
              <button onClick={() => setDateFilter("")} className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-emerald-500 text-white text-[10px] flex items-center justify-center font-black">✕</button>
            )}
          </div>
          {/* Filtro por tipo */}
          {[
            { value: "",        label: "Todos" },
            { value: "manual",  label: "Ventas manuales" },
            { value: "catalog", label: "Pedidos web" },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setTypeFilter(opt.value)}
              className={`px-4 py-2 rounded-xl text-xs font-bold border transition-colors ${typeFilter === opt.value ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-500 border-slate-200 hover:border-slate-400"}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Lista de Ventas */}
      <div className="rounded-2xl border bg-white border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-slate-500">Cargando ventas...</div>
        ) : filteredSales.length === 0 ? (
          <div className="p-10 text-center text-slate-500 flex flex-col items-center">
            <span className="text-4xl mb-3">🧾</span>
            <p>{searchQuery ? "No se encontraron ventas para tu búsqueda." : "Aún no hay ventas registradas."}</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredSales.map(sale => {
              const date = new Date(sale.created_at).toLocaleString("es-MX", {
                day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
              });
              const igDisplay = sale.clients?.instagram ? sale.clients.instagram : (sale.clients?.name || "Público General");
              const nameDisplay = sale.clients?.instagram ? sale.clients.name : "";
              const isCredit = sale.status === 'credit';
              const isCatalogPending = sale.status === 'catalog_pending' || sale.status === 'catalog_viewed';
              const isCancelled = sale.status === 'cancelled';
              const isCut = sale.pos_cut_id !== null;

              return (
                <div key={sale.id} className="transition-colors hover:bg-slate-50 group flex flex-col md:flex-row md:items-center justify-between p-4 gap-4">
                  {/* Info Principal - Clickeable para abrir el detalle */}
                  <div 
                    onClick={() => router.push(`/panel/ventas/${sale.id}`)}
                    className="flex-1 flex flex-col md:flex-row md:items-center gap-5 cursor-pointer"
                  >
                    <div className={`w-12 h-12 shrink-0 rounded-xl flex items-center justify-center text-xl border ${isCatalogPending ? 'bg-indigo-50 border-indigo-200' : isCredit ? 'bg-amber-50 border-amber-200' : 'bg-emerald-50 border-emerald-200'}`}>
                      {isCatalogPending ? '🛒' : isCredit ? '⏳' : '💰'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        {/* Botón que manda al cliente (detiene propagación para no abrir detalle venta) */}
                        <button 
                          onClick={(e) => { e.stopPropagation(); sale.client_id && router.push(`/panel/clientes?openId=${sale.client_id}`); }}
                          className="font-bold text-lg text-slate-900 hover:text-emerald-600 transition-colors leading-none cursor-pointer"
                        >
                          {igDisplay}
                        </button>
                        {nameDisplay && <span className="text-xs text-slate-500">{nameDisplay}</span>}
                        <div className="flex gap-2 items-center">
                          <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded-md ${
                            sale.status === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                            isCancelled ? 'bg-red-100 text-red-700' :
                            isCredit ? 'bg-amber-100 text-amber-700' :
                            'bg-indigo-100 text-indigo-700'
                          }`}>
                            {sale.status === 'paid' ? 'Pagado' : isCancelled ? 'PENALIZACIÓN' : isCredit ? 'Crédito' : 'Pedido Web'}
                          </span>
                        </div>
                        {isCut && <span className="bg-slate-100 text-slate-500 text-[10px] uppercase font-black px-2 py-0.5 rounded-md">Cortado</span>}
                      </div>
                      <p className="text-xs text-slate-500 flex items-center gap-2">
                        <span>🕒 {date}</span>
                        <span>•</span>
                        <span>💳 {sale.payment_method}</span>
                      </p>
                    </div>
                  </div>

                  {/* Acciones e Importe */}
                  <div className="flex items-center justify-between md:justify-end gap-6 md:w-auto w-full border-t md:border-t-0 border-slate-100 pt-3 md:pt-0">
                    <div className="text-left md:text-right">
                      {isCatalogPending ? (
                        <p className="text-sm font-bold text-slate-500">Pendiente: ${sale.total}</p>
                      ) : isCancelled ? (
                        <>
                          <p className="text-sm text-red-500 font-bold uppercase tracking-tighter">Penalización</p>
                          <p className="text-xl font-black text-slate-900">Perdió: ${sale.penalty_amount ?? sale.down_payment}</p>
                        </>
                      ) : isCredit ? (
                        <>
                          <p className="text-sm text-slate-500">Total: ${sale.total}</p>
                          <p className="text-xl font-black text-emerald-600">Ingresó: ${Number(sale.down_payment || 0) + (sale.payments || []).reduce((s, p) => s + Number(p.amount), 0)}</p>
                        </>
                      ) : (
                        <span className="text-2xl font-black text-emerald-600">${sale.total}</span>
                      )}
                    </div>
                    
                    {/* Botón Eliminar mejor ubicado */}
                    <button 
                      onClick={() => setConfirmDelete({ show: true, saleId: sale.id })}
                      className="bg-white border border-slate-200 hover:border-red-500 hover:bg-red-50 text-slate-400 hover:text-red-500 w-10 h-10 rounded-xl flex items-center justify-center transition-all shadow-sm shrink-0"
                      title="Eliminar venta"
                    >
                      🗑
                    </button>
                    
                    {/* Indicador visual de "Ver detalles" */}
                    <button onClick={() => router.push(`/panel/ventas/${sale.id}`)} className="hidden md:flex text-slate-400 hover:text-slate-900">
                      ➔
                    </button>
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
