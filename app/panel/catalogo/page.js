"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminCatalogoPage() {
  const router = useRouter();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });

  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "success" }), 4000);
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      // Filtramos por catalog_pending en la API para traer lo más pesado ya filtrado
      const res = await fetch("/api/sales?status=catalog_pending", { headers: { "x-panel-token": token } });
      if (res.ok) {
        const data = await res.json();
        // Mostrar pendientes y los que ya se vieron pero no se han cobrado
        const pending = (data.sales || []).filter(s => s.status === "catalog_pending" || s.status === "catalog_viewed");
        setOrders(pending);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleAction = async (orderId, actionType) => {
    try {
      const token = localStorage.getItem("panelToken") || "";
      
      if (actionType === "revert") {
        const confirmDelete = window.confirm("¿Seguro que quieres revertir este pedido? El stock regresará automáticamente.");
        if (!confirmDelete) return;

        const res = await fetch(`/api/sales?id=${orderId}`, {
          method: "DELETE",
          headers: { "x-panel-token": token }
        });
        if (res.ok) {
          showToast("Pedido revertido. Stock restaurado.", "success");
          fetchOrders();
        } else {
          showToast("Error al revertir pedido", "error");
        }
      } else if (actionType === "confirm_paid") {
        // En una API real, actualizaríamos el status a 'paid'. Como no tenemos PUT en /api/sales, podemos simular que pagan completo con el endpoint de pagos o actualizando directamente
        // Vamos a llamar a un nuevo mini endpoint o podemos hacerlo temporalmente marcándolo visualmente, pero es mejor que el usuario vaya al Detalle de Venta para cobrarlo formalmente.
        router.push(`/panel/ventas/${orderId}`);
      }
    } catch (err) {
      showToast("Error de conexión", "error");
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-4 md:px-8 py-8 relative">
      <div className={`fixed top-6 right-6 z-[60] transition-all duration-500 transform ${toast.show ? "translate-y-0 opacity-100" : "-translate-y-10 opacity-0 pointer-events-none"}`}>
        <div className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-md ${toast.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
          <span className="text-xl">{toast.type === 'error' ? '⚠️' : '✓'}</span>
          <span className="font-semibold text-sm">{toast.message}</span>
        </div>
      </div>

      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Pedidos Web</h1>
          <p className="text-sm mt-1 opacity-70">Gestiona los pedidos generados desde el catálogo en línea.</p>
        </div>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="p-10 text-center opacity-50">Cargando pedidos...</div>
        ) : orders.length === 0 ? (
          <div className="p-12 text-center border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50">
            <span className="text-4xl block mb-4">💤</span>
            <h3 className="font-bold text-lg text-slate-700">No hay pedidos pendientes</h3>
            <p className="text-sm text-slate-500 mt-1">Cuando un cliente compre en el catálogo, aparecerá aquí.</p>
          </div>
        ) : (
          orders.map(order => (
            <div key={order.id} className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-6 hover:shadow-md transition-shadow">
              
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className={`px-2 py-1 text-[10px] font-black uppercase rounded-md tracking-wider ${order.status === 'catalog_viewed' ? 'bg-slate-100 text-slate-500' : 'bg-amber-100 text-amber-700'}`}>
                    {order.status === 'catalog_viewed' ? 'Visto, falta cobro' : 'Nuevo Pedido'}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">
                    {new Date(order.created_at).toLocaleString('es-MX', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}
                  </span>
                </div>
                
                <h3 className="font-black text-xl text-slate-900 mb-1">
                  {order.clients?.name} <span className="text-emerald-500">({order.clients?.instagram})</span>
                </h3>
                <p className="text-sm font-bold text-slate-500 mb-4">📱 {order.clients?.phone}</p>
                
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <h4 className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Productos Solicitados</h4>
                  <ul className="space-y-1">
                    {order.sale_items?.map((item, i) => (
                      <li key={i} className="text-sm font-medium text-slate-700">
                        <span className="font-bold text-emerald-600">{item.quantity}x</span> {item.products?.name} <span className="opacity-50">(${item.unit_price})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="flex flex-col items-end justify-between min-h-full gap-4 border-t md:border-t-0 md:border-l border-slate-100 pt-4 md:pt-0 md:pl-6">
                <div className="text-right w-full md:w-auto">
                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest block mb-1">Total a cobrar</span>
                  <span className="text-3xl font-black text-slate-900">${order.total}</span>
                </div>
                
                <div className="flex flex-col gap-2 w-full">
                  <button 
                    onClick={() => handleAction(order.id, "confirm_paid")}
                    className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-black py-2.5 px-6 rounded-xl shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
                  >
                    Ver / Cobrar Venta
                  </button>
                  <button 
                    onClick={() => handleAction(order.id, "revert")}
                    className="w-full bg-red-50 hover:bg-red-100 text-red-600 font-bold py-2 px-6 rounded-xl transition-colors border border-red-100"
                  >
                    Revertir Pedido (Regresar Stock)
                  </button>
                </div>
              </div>

            </div>
          ))
        )}
      </div>
    </main>
  );
}
