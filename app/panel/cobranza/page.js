"use client";
import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function CobranzaPage() {
  const router = useRouter();
  const [receivables, setReceivables] = useState([]);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all"); // all, today, tomorrow, overdue
  const [search, setSearch] = useState(""); // Buscador por nombre
  const [panelRole, setPanelRole] = useState(null);

  // Modal de Abono
  const [selectedSale, setSelectedSale] = useState(null);
  const [abonoAmount, setAbonoAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });

  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "success" }), 4000);
  };

  useEffect(() => {
    fetchData();
    const savedRole = localStorage.getItem("panelRole");
    if (savedRole) setPanelRole(savedRole);
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/payments", { headers: { "x-panel-token": token } });
      if (res.ok) {
        const data = await res.json();
        setReceivables(data.receivables || []);
      } else {
        setLoadError(true);
      }
    } catch (e) {
      console.error(e);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  // Procesar datos para tener el saldo restante y fechas
  const processedData = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    return receivables.map(sale => {
      const totalPagado = Number(sale.down_payment) + (sale.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
      const remaining = Number(sale.total) - totalPagado;
      
      const createdDate = new Date(sale.created_at);
      const dueDate = sale.due_date
        ? new Date(sale.due_date + "T12:00:00")
        : new Date(createdDate.getTime() + 14 * 24 * 60 * 60 * 1000);
      dueDate.setHours(0, 0, 0, 0);

      const daysLeft = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      
      let statusCat = "normal";
      if (daysLeft < 0) statusCat = "overdue";
      else if (daysLeft === 0) statusCat = "today";
      else if (daysLeft === 1) statusCat = "tomorrow";

      return { ...sale, remaining, dueDate, daysLeft, statusCat };
    }).filter(s => s.remaining > 0); // Solo mostramos los que aún deben
  }, [receivables]);

  const filteredData = useMemo(() => {
    let data = processedData;
    
    // Filtrar por categoría de tiempo
    if (filter !== "all") {
      data = data.filter(s => s.statusCat === filter);
    }
    
    // Filtrar por nombre o IG
    if (search.trim() !== "") {
      const searchStr = search.replace('@', '').toLowerCase();
      data = data.filter(s => 
        (s.clients?.instagram && s.clients.instagram.toLowerCase().includes(searchStr)) ||
        (s.clients?.name && s.clients.name.toLowerCase().includes(searchStr))
      );
    }
    
    return data;
  }, [processedData, filter, search]);

  const handleAbono = async (e) => {
    e.preventDefault();
    if (!abonoAmount || Number(abonoAmount) <= 0) return showToast("Ingresa una cantidad válida", "error");
    if (Number(abonoAmount) > selectedSale.remaining) return showToast("El abono no puede ser mayor al adeudo", "error");

    setSaving(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({ sale_id: selectedSale.id, amount: Number(abonoAmount) })
      });
      if (res.ok) {
        showToast("Abono registrado con éxito", "success");
        setSelectedSale(null);
        setAbonoAmount("");
        fetchData(); // Recargar datos
      } else {
        showToast("Error al registrar abono", "error");
      }
    } catch (err) {
      showToast("Error de conexión", "error");
    } finally {
      setSaving(false);
    }
  };

  const totalDeudaGeneral = processedData.reduce((sum, s) => sum + s.remaining, 0);

  return (
    <main className="max-w-7xl mx-auto px-4 md:px-8 py-8 relative">
      
      {/* TOAST */}
      <div className={`fixed top-6 right-6 z-[60] transition-all duration-500 transform ${toast.show ? "translate-y-0 opacity-100" : "-translate-y-10 opacity-0 pointer-events-none"}`}>
        <div className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-md ${toast.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
          <span className="text-xl">{toast.type === 'error' ? '⚠️' : '✓'}</span>
          <span className="font-semibold text-sm">{toast.message}</span>
        </div>
      </div>

      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Cuentas por Cobrar</h1>
          <p className="text-sm mt-1 opacity-70">Gestiona los créditos pendientes a 15 días.</p>
        </div>
        
        {panelRole === "admin" && (
          <div className="bg-[radial-gradient(ellipse_at_top_right,rgba(245,158,11,0.15),transparent)] border border-amber-500/20 rounded-2xl p-4 flex flex-col items-end shadow-inner min-w-[200px]">
            <span className="text-xs font-medium text-amber-400 uppercase tracking-widest mb-1">Dinero en la Calle</span>
            <span className="text-3xl font-black text-amber-400 tracking-tight">${totalDeudaGeneral.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* FILTROS */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div className="flex flex-wrap gap-3">
          <button onClick={() => setFilter("all")} className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all border ${filter === 'all' ? 'bg-slate-100 border-slate-300 text-slate-900' : 'bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-50'}`}>
            Todos
          </button>
          <button onClick={() => setFilter("today")} className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all border ${filter === 'today' ? 'bg-amber-500/20 border-amber-500/30 text-amber-400' : 'bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-50'}`}>
            Hoy
          </button>
          <button onClick={() => setFilter("tomorrow")} className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all border ${filter === 'tomorrow' ? 'bg-yellow-500/20 border-yellow-500/30 text-yellow-400' : 'bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-50'}`}>
            Mañana
          </button>
          <button onClick={() => setFilter("overdue")} className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all border ${filter === 'overdue' ? 'bg-red-500/20 border-red-500/30 text-red-400' : 'bg-slate-50 border-slate-100 text-slate-500 hover:bg-slate-50'}`}>
            Vencidos
          </button>
        </div>

        <div className="relative w-full md:w-64">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50">🔍</span>
          <input 
            type="text" 
            placeholder="Buscar por @instagram..." 
            value={search} 
            onChange={(e) => setSearch(e.target.value)} 
            className="w-full pl-9 pr-4 py-2.5 rounded-xl border bg-slate-50 border-slate-200 focus:outline-none focus:border-emerald-500 transition-colors text-sm" 
          />
        </div>
      </div>

      {/* GRID DE ADEUDOS */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
        {loading ? (
          <div className="col-span-full p-10 text-center opacity-50">Cargando cuentas...</div>
        ) : loadError ? (
          <div className="col-span-full p-10 text-center text-red-500 flex flex-col items-center gap-3">
            <span className="text-4xl">⚠️</span>
            <p className="font-semibold">Error al cargar las cuentas por cobrar.</p>
            <button onClick={fetchData} className="px-4 py-2 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-100">Reintentar</button>
          </div>
        ) : filteredData.length === 0 ? (
          <div className="col-span-full p-10 text-center opacity-50 flex flex-col items-center border border-slate-100 rounded-3xl border-dashed">
            <span className="text-5xl mb-4">🙌</span>
            <p className="text-lg">No hay cuentas pendientes en esta categoría.</p>
          </div>
        ) : (
          filteredData.map(sale => (
            <div key={sale.id} className={`rounded-2xl border bg-white p-5 relative overflow-hidden flex flex-col ${sale.statusCat === 'overdue' ? 'border-red-500/30' : sale.statusCat === 'today' ? 'border-amber-500/30' : 'border-slate-200'}`}>
              
              {/* Etiqueta superior */}
              <div className={`absolute top-0 right-0 left-0 h-1.5 ${sale.statusCat === 'overdue' ? 'bg-red-500' : sale.statusCat === 'today' ? 'bg-amber-500' : sale.statusCat === 'tomorrow' ? 'bg-yellow-500' : 'bg-emerald-500'}`} />

              <div className="flex justify-between items-start mb-4 mt-2">
                <div>
                  <h3
                    onClick={() => sale.client_id && router.push(`/panel/clientes?openId=${sale.client_id}`)}
                    className={`font-bold text-lg text-emerald-400 leading-tight ${sale.client_id ? "cursor-pointer hover:text-emerald-300" : ""}`}
                  >
                    {sale.clients?.instagram || sale.clients?.name || "Cliente Borrado"}
                  </h3>
                  <p className="text-xs opacity-50 mt-1">
                    {sale.clients?.instagram ? sale.clients.name : ""} {sale.clients?.phone && `📱 ${sale.clients.phone}`}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold tracking-wider opacity-50">Deuda Restante</span>
                  <p className="text-2xl font-black text-slate-900">${sale.remaining.toFixed(2)}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-6">
                <span className={`text-xs px-2 py-1 rounded-md font-bold uppercase ${sale.statusCat === 'overdue' ? 'bg-red-500/20 text-red-400' : sale.statusCat === 'today' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-100 text-slate-700'}`}>
                  {sale.statusCat === 'overdue' ? 'Vencido' : sale.statusCat === 'today' ? 'Vence Hoy' : sale.statusCat === 'tomorrow' ? 'Vence Mañana' : `Vence en ${sale.daysLeft} días`}
                </span>
                <span className="text-xs opacity-50">
                  (Límite: {sale.dueDate.toLocaleDateString("es-MX")})
                </span>
              </div>

              <div className="mt-auto pt-4 border-t border-slate-100">
                <div className="flex gap-2">
                  <button
                    onClick={() => { setSelectedSale(sale); setAbonoAmount(sale.remaining); }}
                    className="flex-1 py-3 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 font-bold text-sm transition-all text-center"
                  >
                    💵 Registrar Abono
                  </button>
                  <Link
                    href={`/panel/ventas/${sale.id}`}
                    className="py-3 px-4 rounded-xl bg-slate-50 hover:bg-slate-100 border border-slate-200 font-bold text-sm transition-all text-center text-slate-500"
                  >
                    Ver venta
                  </Link>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* MODAL DE ABONO */}
      {selectedSale && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm shadow-2xl animate-in fade-in zoom-in">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-white">
              <h2 className="text-lg font-bold">Registrar Abono</h2>
              <button onClick={() => setSelectedSale(null)} className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center">✕</button>
            </div>
            
            <form onSubmit={handleAbono} className="p-6">
              <div className="text-center mb-6">
                <p className="text-sm text-slate-500 mb-1">Adeudo actual de {selectedSale.clients?.name}</p>
                <p className="text-3xl font-black text-amber-400">${selectedSale.remaining.toFixed(2)}</p>
              </div>

              <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">Cantidad a abonar</label>
              <div className="relative mb-6">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-lg">$</span>
                <input 
                  type="number" 
                  step="0.01"
                  required
                  max={selectedSale.remaining}
                  value={abonoAmount}
                  onChange={e => setAbonoAmount(e.target.value)}
                  className="w-full pl-9 pr-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xl font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setSelectedSale(null)} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50">Cancelar</button>
                <button type="submit" disabled={saving} className="flex-1 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold shadow-lg shadow-emerald-500/20 disabled:opacity-50">
                  {saving ? "Guardando..." : "Guardar Pago"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </main>
  );
}
