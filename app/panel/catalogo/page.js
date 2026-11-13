"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ElegirUbicacion from "../ElegirUbicacion";

export default function AdminCatalogoPage() {
  const router = useRouter();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });
  // Un pedido web se paga solo, sin que nadie decida dónde se guarda la mercancía:
  // por eso entraba sin lugar y acababa en la bolsa de "no se sabe dónde está".
  const [sinUbicar, setSinUbicar] = useState([]);
  const [elegida, setElegida] = useState({});
  const [guardando, setGuardando] = useState(null);

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
      // Los pedidos que esperan pago en línea viven en otro estado, así que ya no
      // alcanza con pedirle a la API solo los catalog_pending.
      const res = await fetch("/api/sales", { headers: { "x-panel-token": token } });
      if (res.ok) {
        const data = await res.json();
        const pending = (data.sales || []).filter(
          (s) => s.status === "catalog_pending" || s.status === "catalog_viewed" || s.status === "pending_payment"
        );
        setOrders(pending);

        // Pedidos web ya pagados, de una clienta, con mercancía pendiente y sin
        // lugar. Solo los web: el cobro en línea es el único camino que no pasa por
        // la pantalla que pregunta dónde se guarda. Lo viejo de otras vías se limpia
        // aparte, no aquí, para no convertir esta pantalla en una lista de 340.
        setSinUbicar((data.sales || []).filter((v) =>
          v.client_id && !v.ubicacion &&
          v.payment_method === "Pedido Web" &&
          !["catalog_pending", "catalog_viewed", "pending_payment", "cancelled"].includes(v.status) &&
          (v.sale_items || []).some((i) => i.delivery_status !== "delivered")
        ));
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

  const guardarUbicacion = async (venta) => {
    const elec = elegida[venta.id];
    if (!elec || guardando) return;
    setGuardando(venta.id);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/panel/ubicacion", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({
          saleIds: [venta.id, ...(elec.aMover || [])],
          tipo: elec.tipo,
          caja: elec.caja,
        }),
      });
      if (!res.ok) { showToast("No se pudo guardar el lugar", "error"); return; }
      showToast(elec.tipo === "caja" ? `Guardado en la caja ${elec.caja}` : "Guardado en estante", "success");
      setSinUbicar((prev) => prev.filter((v) => v.id !== venta.id));
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setGuardando(null);
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

      {/* Pedidos ya pagados que nadie ubicó. El cobro en línea no pasa por la
          pantalla que pregunta dónde se guarda, así que se pregunta aquí, con las
          mismas opciones del punto de venta. */}
      {sinUbicar.length > 0 && (
        <div className="mb-8">
          <div className="flex items-baseline gap-2 mb-3">
            <h2 className="text-lg font-black text-slate-900">Falta decir dónde se guardan</h2>
            <span className="text-xs font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg">
              {sinUbicar.length}
            </span>
          </div>
          <div className="space-y-3">
            {sinUbicar.map((v) => {
              const piezas = (v.sale_items || []).reduce((n, i) => n + (i.quantity || 1), 0);
              return (
                <div key={v.id} className="bg-white border border-slate-200 rounded-2xl p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <p className="font-bold text-slate-900 truncate">
                        {v.clients?.name || v.clients?.instagram || "Clienta"}
                      </p>
                      <p className="text-xs text-slate-400 truncate">
                        {v.clients?.instagram ? `@${String(v.clients.instagram).replace(/^@/, "")} · ` : ""}
                        {(v.sale_items || []).map((i) => i.products?.name).filter(Boolean).join(", ")}
                      </p>
                    </div>
                    <span className="text-xs font-bold text-slate-400 shrink-0">
                      {new Date(v.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}
                    </span>
                  </div>

                  <ElegirUbicacion
                    clientId={v.client_id}
                    productos={piezas}
                    elegida={elegida[v.id]}
                    onElegir={(e) => setElegida((prev) => ({ ...prev, [v.id]: e }))}
                  />

                  <button
                    type="button"
                    onClick={() => guardarUbicacion(v)}
                    disabled={!elegida[v.id] || guardando === v.id}
                    className="mt-4 w-full py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white font-black shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition-all active:scale-95"
                  >
                    {guardando === v.id ? "Guardando…" : "Guardar dónde quedó"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

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
                  <span className={`px-2 py-1 text-[10px] font-black uppercase rounded-md tracking-wider ${
                    order.status === 'pending_payment' ? 'bg-indigo-100 text-indigo-700'
                      : order.status === 'catalog_viewed' ? 'bg-slate-100 text-slate-500'
                      : 'bg-amber-100 text-amber-700'
                  }`}>
                    {order.status === 'pending_payment' ? '⏱️ Pagando en línea'
                      : order.status === 'catalog_viewed' ? 'Visto, falta cobro'
                      : 'Nuevo Pedido'}
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
