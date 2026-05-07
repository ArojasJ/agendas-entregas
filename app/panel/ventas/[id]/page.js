"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";

export default function SaleDetailPage() {
  const router = useRouter();
  const { id } = useParams();
  const [sale, setSale] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  // Estados del modal de pago (Catálogo)
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [paymentMode, setPaymentMode] = useState("paid"); // "paid" o "credit"
  const [downPayment, setDownPayment] = useState("");

  const [showAbonoModal, setShowAbonoModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showRevertModal, setShowRevertModal] = useState(false);
  const [showDueDateModal, setShowDueDateModal] = useState(false);
  const [newDueDate, setNewDueDate] = useState("");
  const [abonoAmount, setAbonoAmount] = useState("");
  const [savingAbono, setSavingAbono] = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState(null);
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });

  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "success" }), 4000);
  };

  useEffect(() => {
    if (id) fetchSaleDetail();
  }, [id]);

  const fetchSaleDetail = async () => {
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/sales/${id}`, {
        headers: { "x-panel-token": token },
      });
      if (res.ok) {
        const data = await res.json();
        
        if (data.sale && data.sale.status === "catalog_pending") {
          await fetch(`/api/sales/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", "x-panel-token": token },
            body: JSON.stringify({ status: "catalog_viewed" })
          });
          data.sale.status = "catalog_viewed";
        }

        setSale(data.sale);
        // Cargar bookings para detectar intentos fallidos por item
        const bRes = await fetch("/api/bookings", { headers: { "x-panel-token": token } });
        if (bRes.ok) {
          const bData = await bRes.json();
          setBookings(bData.bookings || []);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="p-10 text-center opacity-50">Cargando detalles de la venta...</div>;
  }

  if (!sale) {
    return (
      <div className="p-10 text-center">
        <h1 className="text-2xl font-bold mb-4">Venta no encontrada</h1>
        <button onClick={() => router.back()} className="px-4 py-2 bg-slate-100 rounded-xl text-slate-700">Regresar</button>
      </div>
    );
  }

  const date = new Date(sale.created_at).toLocaleString("es-MX", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
  });

  const isCatalog = sale.status === 'catalog_pending' || sale.status === 'catalog_viewed';
  const isCredit = sale.status === 'credit';
  const isCancelled = sale.status === 'cancelled';
  const totalPagadoAbonos = (sale.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
  const totalPagado = isCatalog ? 0 : Number(sale.down_payment) + totalPagadoAbonos;
  const deuda = isCatalog ? Number(sale.total) : isCredit ? Math.max(0, Number(sale.total) - totalPagado) : 0;
  
  const handleConfirmCatalog = async (e) => {
    e.preventDefault();
    if (paymentMode === "credit" && (!downPayment || Number(downPayment) <= 0)) {
      return showToast("Ingresa un enganche válido", "error");
    }

    setSavingAbono(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const finalStatus = paymentMode === "credit" ? "credit" : "paid";
      const finalDownPayment = paymentMode === "credit" ? Number(downPayment) : Number(sale.total);

      const res = await fetch(`/api/sales/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({ 
          status: finalStatus,
          payment_method: "Pedido Web",
          down_payment: finalDownPayment
        })
      });

      if (res.ok) {
        showToast("Venta confirmada exitosamente", "success");
        setShowConfirmModal(false);
        fetchSaleDetail();
      } else {
        showToast("Error al confirmar", "error");
      }
    } catch (err) {
      showToast("Error de conexión", "error");
    } finally {
      setSavingAbono(false);
    }
  };
  
  const handleCancelForfeit = async () => {
    setSavingAbono(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/sales/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({ action: "cancel_forfeit" })
      });
      if (res.ok) {
        showToast("Venta penalizada correctamente", "success");
        setShowCancelModal(false);
        fetchSaleDetail();
      } else {
        showToast("Error al penalizar", "error");
      }
    } catch (err) {
      showToast("Error de conexión", "error");
    } finally {
      setSavingAbono(false);
    }
  };

  const handleAbono = async (e) => {
    e.preventDefault();
    if (!abonoAmount || Number(abonoAmount) <= 0) return showToast("Ingresa una cantidad válida", "error");
    if (Number(abonoAmount) > deuda) return showToast("El abono no puede ser mayor al adeudo", "error");

    setSavingAbono(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({ sale_id: sale.id, amount: Number(abonoAmount) })
      });
      if (res.ok) {
        showToast("Abono registrado con éxito", "success");
        setShowAbonoModal(false);
        setAbonoAmount("");
        fetchSaleDetail(); // Recargar venta
      } else {
        showToast("Error al registrar abono", "error");
      }
    } catch (err) {
      showToast("Error de conexión", "error");
    } finally {
      setSavingAbono(false);
    }
  };

  const handleDeletePayment = async (paymentId) => {
    if (!confirm("¿Eliminar este abono? Esta acción no se puede deshacer.")) return;
    setDeletingPaymentId(paymentId);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/payments?id=${paymentId}`, {
        method: "DELETE",
        headers: { "x-panel-token": token },
      });
      const data = await res.json();
      if (res.ok) {
        showToast("Abono eliminado", "success");
        fetchSaleDetail();
      } else {
        showToast(data.message || "Error al eliminar abono", "error");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setDeletingPaymentId(null);
    }
  };

  const handleRevertCancel = async () => {
    setSavingAbono(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/sales/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({ action: "revert_cancel" })
      });
      if (res.ok) {
        showToast("Penalización revertida correctamente", "success");
        setShowRevertModal(false);
        fetchSaleDetail();
      } else {
        showToast("Error al revertir", "error");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setSavingAbono(false);
    }
  };

  const handleSaveDueDate = async () => {
    if (!newDueDate) return;
    setSavingAbono(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/sales/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({ due_date: newDueDate })
      });
      if (res.ok) {
        showToast("Fecha de vencimiento actualizada", "success");
        setShowDueDateModal(false);
        fetchSaleDetail();
      } else {
        showToast("Error al actualizar", "error");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setSavingAbono(false);
    }
  };

  const effectiveDueDate = sale?.due_date || (() => {
    if (!sale?.created_at) return null;
    const d = new Date(sale.created_at);
    d.setDate(d.getDate() + 15);
    return d.toISOString().split("T")[0];
  })();

  const getDaysRemaining = (dueDateStr) => {
    if (!dueDateStr) return null;
    const due = new Date(dueDateStr + "T00:00:00");
    due.setHours(0, 0, 0, 0);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return Math.ceil((due - now) / (1000 * 60 * 60 * 24));
  };

  const igDisplay = sale.clients?.instagram ? sale.clients.instagram : (sale.clients?.name || "Público General");

  return (
    <main className="max-w-4xl mx-auto px-4 md:px-8 py-8 relative">
      {/* TOAST */}
      <div className={`fixed top-6 right-6 z-[60] transition-all duration-500 transform ${toast.show ? "translate-y-0 opacity-100" : "-translate-y-10 opacity-0 pointer-events-none"}`}>
        <div className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-md ${toast.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
          <span className="text-xl">{toast.type === 'error' ? '⚠️' : '✓'}</span>
          <span className="font-semibold text-sm">{toast.message}</span>
        </div>
      </div>
      <button 
        onClick={() => router.back()} 
        className="mb-6 flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900 transition-colors"
      >
        <span>←</span> Volver atrás
      </button>

      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-black tracking-tight text-slate-900">Detalle de Venta</h1>
          <p className="text-sm mt-1 text-slate-500">ID: {sale.id} • {date}</p>
        </div>
        <div className="flex flex-col items-end">
          {sale.client_id ? (
            <Link
              href={`/panel/clientes?openId=${sale.client_id}`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-xl font-bold transition-colors"
            >
              👤 Ver Cliente: {igDisplay}
            </Link>
          ) : (
            <span className="px-4 py-2 bg-slate-100 text-slate-500 rounded-xl font-bold">👤 Público General</span>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Total de la Venta</span>
          <span className="text-3xl font-black text-slate-900">${sale.total}</span>
          <p className="text-xs text-slate-500 mt-2">Método: {sale.payment_method}</p>
        </div>
        
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500 block mb-1">Total Pagado</span>
          <span className="text-3xl font-black text-emerald-600">${isCatalog ? "0.00" : isCancelled ? Number(sale.penalty_amount || 0).toFixed(2) : isCredit ? totalPagado.toFixed(2) : sale.total}</span>
          <p className="text-xs text-slate-500 mt-2">
            {isCatalog ? "Pendiente de confirmación" : isCancelled ? "15% de penalización retenido" : isCredit ? `Enganche: $${sale.down_payment} + $${totalPagadoAbonos} en abonos` : "Pagado de contado"}
          </p>
        </div>

        {isCancelled ? (
          <div className="border border-red-100 rounded-2xl overflow-hidden shadow-sm">
            <div className="bg-red-50 p-4 border-b border-red-100">
              <span className="text-[10px] font-black uppercase tracking-widest text-red-500 block mb-1">Penalización por impago</span>
              <span className="text-2xl font-black text-red-600">${Number(sale.penalty_amount || 0).toFixed(2)}</span>
              <p className="text-xs text-red-500/70 mt-0.5">15% del total de la venta retenido por la tienda</p>
            </div>
            <div className="bg-emerald-50 p-4">
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-600 block mb-1">Saldo a favor del cliente</span>
              <span className="text-2xl font-black text-emerald-600">
                ${(Math.round(((Number(sale.down_payment) + totalPagadoAbonos) - Number(sale.penalty_amount || 0)) * 100) / 100).toFixed(2)}
              </span>
              <p className="text-xs text-emerald-600/70 mt-0.5">Acreditado en su cuenta para próximas compras</p>
            </div>
          </div>
        ) : (
          <div className={`border rounded-2xl p-6 shadow-sm ${deuda > 0 ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
            <span className={`text-[10px] font-black uppercase tracking-widest block mb-1 ${deuda > 0 ? 'text-amber-500' : 'text-slate-400'}`}>
              Estado / Deuda
            </span>
            <span className={`text-3xl font-black ${deuda > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
              {deuda > 0 ? `$${deuda.toFixed(2)}` : "Liquidada"}
            </span>
            <p className={`text-xs mt-2 ${deuda > 0 ? 'text-amber-600/70' : 'text-slate-500'}`}>
              {isCatalog ? "Pedido Web sin confirmar" : deuda > 0 ? "Pendiente de pago" : "Sin adeudo restante"}
            </p>
          </div>
        )}
      </div>

      {isCatalog && (
        <div className="mb-8 p-6 bg-indigo-50 border border-indigo-200 rounded-3xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
          <div>
            <h2 className="text-lg font-black text-indigo-900 flex items-center gap-2">
              <span>🛒</span> Pedido Web Pendiente
            </h2>
            <p className="text-sm text-indigo-700/80 mt-1">Confirma el pago de este pedido para registrar el ingreso y quitarlo de la lista de pendientes.</p>
          </div>
          <button 
            onClick={() => setShowConfirmModal(true)}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-black rounded-xl shadow-lg shadow-indigo-500/30 transition-all active:scale-95 whitespace-nowrap"
          >
            ✓ Confirmar Pago
          </button>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          {/* PRODUCTOS */}
          <section>
            <h2 className="text-lg font-black text-slate-900 mb-4 flex items-center gap-2">
              <span className="text-xl">📦</span> Productos
            </h2>
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm divide-y divide-slate-100">
              {sale.sale_items && sale.sale_items.map((item) => (
                <div key={item.id} className="p-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-4">
                    {item.products?.image_url ? (
                      <img src={item.products.image_url} alt="Producto" className="w-12 h-12 object-cover rounded-lg border border-slate-200" />
                    ) : (
                      <div className="w-12 h-12 bg-slate-100 rounded-lg border border-slate-200 flex items-center justify-center text-xl">📸</div>
                    )}
                    <div>
                      <h4 className="font-bold text-slate-900">{item.products?.name || "Producto Borrado"}</h4>
                      {item.product_variants && (
                        <p className="text-xs font-semibold text-indigo-600 mt-0.5">
                          {item.product_variants.option_type}: {item.product_variants.name}
                        </p>
                      )}
                      <p className="text-xs text-slate-500">{item.quantity} {item.quantity === 1 ? 'unidad' : 'unidades'} a ${item.unit_price} c/u</p>
                      {item.delivery_status === 'delivered' ? (
                        <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase rounded-md border border-emerald-100">
                          ✓ Entregado
                        </span>
                      ) : (() => {
                        const failedBk = bookings.find(bk => {
                          let ids = bk.sale_item_ids || [];
                          if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch(e) { ids = []; } }
                          return Array.isArray(ids) && ids.includes(item.id) && bk.delivery_status === 'no_entregado';
                        });
                        const failedDate = failedBk?.date
                          ? new Date(failedBk.date + "T00:00:00").toLocaleDateString("es-MX", { day: 'numeric', month: 'short', year: 'numeric' })
                          : null;
                        return (
                          <div className="flex flex-col gap-1 mt-1">
                            {failedBk && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-rose-50 text-rose-600 text-[10px] font-black uppercase rounded-md border border-rose-100">
                                ⚠ Intento fallido{failedDate ? ` — ${failedDate}` : ""}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-600 text-[10px] font-black uppercase rounded-md border border-amber-100">
                              ⌛ Pendiente de Entrega
                            </span>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                  {item.product_id && (
                    <Link 
                      href={`/panel/inventario?id=${item.product_id}`}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
                    >
                      Ver en Inventario
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* ABONOS */}
          {(isCredit || (isCancelled && totalPagadoAbonos > 0)) && (
            <section>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-3">
                <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  <span className="text-xl">💸</span> Historial de Abonos
                </h2>
                {deuda > 0 && !isCancelled && (
                  <button
                    onClick={() => { setAbonoAmount(deuda); setShowAbonoModal(true); }}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold text-sm rounded-xl transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
                  >
                    + Registrar Abono
                  </button>
                )}
              </div>
              <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                {sale.payments && sale.payments.length > 0 ? (
                  <div className="divide-y divide-slate-100">
                    {sale.payments.map(p => (
                      <div key={p.id} className="p-4 flex items-center justify-between hover:bg-slate-50">
                        <div>
                          <p className="font-bold text-slate-900">${p.amount}</p>
                          <p className="text-xs text-slate-500">
                            {new Date(p.created_at).toLocaleString("es-MX", { day: '2-digit', month: 'short', year: 'numeric' })}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDeletePayment(p.id)}
                          disabled={deletingPaymentId === p.id || !!p.pos_cut_id}
                          title={p.pos_cut_id ? "Ya fue incluido en un corte" : "Eliminar abono"}
                          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors px-2 py-1 rounded-lg hover:bg-red-50"
                        >
                          {deletingPaymentId === p.id ? "..." : "Eliminar"}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-6 text-center text-slate-500 text-sm">
                    No se han registrado abonos adicionales a esta venta.
                  </div>
                )}
              </div>
            </section>
          )}
        </div>

        {/* COLUMNA LATERAL (LOG/METADATA SI ES NECESARIO) */}
        <div className="space-y-6">
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
            <h3 className="font-bold text-sm uppercase tracking-widest text-slate-500 mb-4">Acciones de Venta</h3>
            <div className="space-y-3 text-sm">

              {/* Vencimiento — solo ventas a crédito pendientes */}
              {isCredit && deuda > 0 && (() => {
                const days = getDaysRemaining(effectiveDueDate);
                const color = days === null ? "bg-slate-100 text-slate-500 border-slate-200"
                  : days < 0 ? "bg-red-100 text-red-700 border-red-200"
                  : days <= 3 ? "bg-orange-100 text-orange-700 border-orange-200"
                  : days <= 7 ? "bg-amber-100 text-amber-700 border-amber-200"
                  : "bg-emerald-100 text-emerald-700 border-emerald-200";
                const label = days === null ? "Sin fecha de vencimiento"
                  : days < 0 ? `Venció hace ${Math.abs(days)} día${Math.abs(days) !== 1 ? "s" : ""}`
                  : days === 0 ? "Vence hoy"
                  : `Vence en ${days} día${days !== 1 ? "s" : ""}`;
                return (
                  <div className={`rounded-xl border p-3 ${color}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-widest opacity-70 mb-0.5">Plazo de pago</p>
                        <p className="font-black text-sm">{label}</p>
                        {effectiveDueDate && (
                          <p className="text-[10px] opacity-70 mt-0.5">
                            {new Date(effectiveDueDate + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => { setNewDueDate(effectiveDueDate || ""); setShowDueDateModal(true); }}
                        className="text-[10px] font-black underline underline-offset-2 opacity-70 hover:opacity-100 whitespace-nowrap ml-2"
                      >
                        Editar
                      </button>
                    </div>
                  </div>
                );
              })()}

              {(isCredit || isCatalog) && !isCancelled && (
                <button
                  onClick={() => setShowCancelModal(true)}
                  className="w-full py-2.5 bg-white border border-red-200 text-red-600 font-bold rounded-xl hover:bg-red-50 transition-colors"
                >
                  ⚠️ Cancelar y Penalizar
                </button>
              )}
              {sale.status === 'cancelled' && (
                <button
                  onClick={() => setShowRevertModal(true)}
                  className="w-full py-2.5 bg-white border border-amber-300 text-amber-700 font-bold rounded-xl hover:bg-amber-50 transition-colors"
                >
                  ↩️ Revertir Penalización
                </button>
              )}
              <div className="pt-2 border-t border-slate-200 mt-2">
                <div className="flex justify-between border-b border-slate-200 pb-2">
                  <span className="text-slate-500">Registrado por:</span>
                  <span className="font-bold text-emerald-600">{sale.staff?.display_name || "Sistema"}</span>
                </div>
                <div className="flex justify-between border-b border-slate-200 pb-2">
                  <span className="text-slate-500">Corte de Caja:</span>
                  <span className="font-medium text-slate-900">
                    {sale.pos_cut_id
                      ? sale.pos_cuts?.created_at
                        ? new Date(sale.pos_cuts.created_at).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
                        : "Cortado"
                      : "Sin corte"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Descuento:</span>
                  <span className="font-medium text-slate-900">${sale.discount || 0}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL DE CONFIRMAR PEDIDO CATÁLOGO */}
      {showConfirmModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm shadow-2xl animate-in fade-in zoom-in">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-white rounded-t-3xl">
              <h2 className="text-lg font-bold">Confirmar Pago</h2>
              <button onClick={() => setShowConfirmModal(false)} className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center">✕</button>
            </div>
            
            <form onSubmit={handleConfirmCatalog} className="p-6">
              
              <div className="flex gap-2 mb-6 p-1 bg-slate-100 rounded-xl">
                <button type="button" onClick={() => setPaymentMode("paid")} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${paymentMode === 'paid' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>Pago Completo</button>
                <button type="button" onClick={() => setPaymentMode("credit")} className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${paymentMode === 'credit' ? 'bg-white text-amber-500 shadow-sm' : 'text-slate-500 hover:bg-slate-200'}`}>Dejó Apartado</button>
              </div>

              {paymentMode === "credit" && (
                <div className="mb-6 animate-in slide-in-from-top-2">
                  <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">¿Con cuánto apartó?</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-lg">$</span>
                    <input 
                      type="number" 
                      step="0.01"
                      required
                      max={sale.total}
                      value={downPayment}
                      onChange={e => setDownPayment(e.target.value)}
                      className="w-full pl-9 pr-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xl font-bold focus:outline-none focus:border-amber-500"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={() => setShowConfirmModal(false)} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors">Cancelar</button>
                <button type="submit" disabled={savingAbono} className="flex-1 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition-all active:scale-95">
                  {savingAbono ? "Guardando..." : "Confirmar Venta"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL DE ABONO */}
      {showAbonoModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm shadow-2xl animate-in fade-in zoom-in">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-white rounded-t-3xl">
              <h2 className="text-lg font-bold">Registrar Abono</h2>
              <button onClick={() => setShowAbonoModal(false)} className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center">✕</button>
            </div>
            
            <form onSubmit={handleAbono} className="p-6">
              <div className="text-center mb-6">
                <p className="text-sm text-slate-500 mb-1">Adeudo actual</p>
                <p className="text-3xl font-black text-amber-500">${deuda.toFixed(2)}</p>
              </div>

              <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">Cantidad a abonar</label>
              <div className="relative mb-6">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-lg">$</span>
                <input 
                  type="number" 
                  step="0.01"
                  required
                  max={deuda}
                  value={abonoAmount}
                  onChange={e => setAbonoAmount(e.target.value)}
                  className="w-full pl-9 pr-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xl font-bold focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setShowAbonoModal(false)} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors">Cancelar</button>
                <button type="submit" disabled={savingAbono} className="flex-1 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition-all active:scale-95">
                  {savingAbono ? "Guardando..." : "Guardar Pago"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* MODAL EDITAR FECHA DE VENCIMIENTO */}
      {showDueDateModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm shadow-2xl animate-in fade-in zoom-in">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center rounded-t-3xl">
              <h2 className="text-lg font-bold">Fecha de vencimiento</h2>
              <button onClick={() => setShowDueDateModal(false)} className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">Nueva fecha límite de pago</label>
                <input
                  type="date"
                  value={newDueDate}
                  onChange={e => setNewDueDate(e.target.value)}
                  min={new Date().toISOString().split("T")[0]}
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-bold focus:outline-none focus:border-amber-500"
                />
              </div>
              <div className="flex gap-3 pt-1">
                <button onClick={() => setShowDueDateModal(false)} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors">Cancelar</button>
                <button onClick={handleSaveDueDate} disabled={savingAbono || !newDueDate} className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 font-bold shadow-lg shadow-amber-500/20 disabled:opacity-50 transition-all active:scale-95">
                  {savingAbono ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL REVERTIR PENALIZACIÓN */}
      {showRevertModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden animate-in fade-in zoom-in">
            <div className="p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4 text-2xl">
                ↩️
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">¿Revertir Penalización?</h2>
              <p className="text-sm text-slate-500">
                La venta volverá a su estado anterior y los productos se descontarán del inventario de nuevo.
              </p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-3">
              <button onClick={() => setShowRevertModal(false)} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-100 transition-colors">Cancelar</button>
              <button onClick={handleRevertCancel} disabled={savingAbono} className="flex-1 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-bold shadow-lg shadow-amber-500/20 disabled:opacity-50 transition-all active:scale-95">
                {savingAbono ? "Procesando..." : "Sí, Revertir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE PENALIZACIÓN */}
      {showCancelModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden animate-in fade-in zoom-in">
            <div className="p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4 text-2xl">
                ⚠️
              </div>
              <h2 className="text-xl font-bold text-slate-900 mb-2">¿Confirmar Penalización?</h2>
              <p className="text-sm text-slate-500">
                Los productos regresarán al inventario automáticamente. <br/>
                <strong>El dinero recibido se quedará como penalización por impago.</strong>
              </p>
            </div>
            
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-3">
              <button onClick={() => setShowCancelModal(false)} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-100 transition-colors">Cancelar</button>
              <button onClick={handleCancelForfeit} disabled={savingAbono} className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold shadow-lg shadow-red-500/20 disabled:opacity-50 transition-all active:scale-95">
                {savingAbono ? "Procesando..." : "Sí, Penalizar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
