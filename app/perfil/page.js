"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function PerfilPage() {
  const router = useRouter();
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ client: null, sales: [], bookings: [] });
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", instagram: "", phone: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const res = await fetch("/api/clients/me/dashboard", { cache: "no-store" });
      if (res.ok) {
        const json = await res.json();
        setData(json);
        setEditForm({
          name: json.client.name,
          instagram: json.client.instagram,
          phone: json.client.phone || ""
        });
      } else {
        router.push("/login");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/");
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/clients/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm)
      });
      if (res.ok) {
        const json = await res.json();
        setData({ ...data, client: json.client });
        setEditing(false);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const calcTotalDebt = () => {
    let debt = 0;
    data.sales.forEach(sale => {
      if (sale.status === "credit") {
        const paidAbonos = sale.payments ? sale.payments.reduce((acc, p) => acc + p.amount, 0) : 0;
        const totalPaid = Number(sale.down_payment || 0) + paidAbonos;
        debt += (sale.total - totalPaid);
      }
    });
    return debt > 0 ? debt : 0;
  };

  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center">Cargando tu perfil...</div>;

  const totalDebt = calcTotalDebt();

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* HEADER */}
      <div className="bg-white border-b border-slate-200 sticky top-0 z-10" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href="/" className="text-emerald-600 font-bold flex items-center gap-2 text-sm">
            <span>←</span> Volver a Inicio
          </a>
          <button onClick={handleLogout} className="text-red-500 text-sm font-medium hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors">
            Cerrar Sesión
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* COLUMNA IZQUIERDA: PERFIL Y DEUDA */}
        <div className="space-y-6">
          
          {/* DEUDA GLOBAL */}
          <div className={`rounded-2xl p-6 shadow-sm border ${totalDebt > 0 ? 'bg-rose-50 border-rose-100' : 'bg-emerald-50 border-emerald-100'}`}>
            <h2 className={`text-sm font-bold uppercase tracking-wider mb-2 ${totalDebt > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
              Mi Adeudo Total
            </h2>
            <p className={`text-4xl font-black ${totalDebt > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
              ${totalDebt.toFixed(2)}
            </p>
            {totalDebt === 0 && <p className="text-xs text-emerald-600 mt-2">¡Todo al corriente! 🥳</p>}
          </div>

          {/* PERFIL */}
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-900">Mis Datos</h2>
              {!editing && (
                <button onClick={() => setEditing(true)} className="text-emerald-600 text-xs font-bold uppercase bg-emerald-50 px-3 py-1 rounded-full">
                  Editar
                </button>
              )}
            </div>

            {editing ? (
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Nombre</label>
                  <input type="text" value={editForm.name} onChange={e => setEditForm({...editForm, name: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Instagram</label>
                  <input type="text" value={editForm.instagram} onChange={e => setEditForm({...editForm, instagram: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Teléfono</label>
                  <input type="tel" value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="button" onClick={() => setEditing(false)} className="flex-1 px-4 py-2 border rounded-xl text-sm font-medium">Cancelar</button>
                  <button type="submit" disabled={saving} className="flex-1 bg-emerald-500 text-white rounded-xl text-sm font-bold">Guardar</button>
                </div>
              </form>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-slate-400 font-medium">Nombre</p>
                  <p className="font-semibold text-slate-800">{data.client?.name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">Instagram</p>
                  <p className="font-semibold text-emerald-600">{data.client?.instagram}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">Teléfono</p>
                  <p className="font-semibold text-slate-800">{data.client?.phone}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">Correo</p>
                  <p className="font-semibold text-slate-800">{data.client?.email}</p>
                </div>
              </div>
            )}
          </div>
          
          <a href="/agendar" className="block w-full text-center bg-slate-900 text-white font-bold py-4 rounded-2xl shadow-lg hover:bg-slate-800 transition-colors">
            📦 Agendar Entrega
          </a>
        </div>

        {/* COLUMNA DERECHA: HISTORIAL */}
        <div className="md:col-span-2 space-y-6">
          <h2 className="text-xl font-bold text-slate-900 px-1">Historial de Compras</h2>
          
          {data.sales.length === 0 ? (
            <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center">
              <span className="text-4xl mb-3 block">🛍️</span>
              <p className="text-slate-500">Aún no tienes compras registradas.</p>
              <a href="/catalogo" className="inline-block mt-4 text-emerald-600 font-bold hover:underline">Ir al catálogo</a>
            </div>
          ) : (
            <div className="space-y-4">
              {data.sales.map(sale => {
                const paidAbonos = sale.payments ? sale.payments.reduce((acc, p) => acc + p.amount, 0) : 0;
                const totalPaid = Number(sale.down_payment || 0) + paidAbonos;
                const debt = sale.total - totalPaid;
                const date = new Date(sale.created_at).toLocaleDateString("es-MX", { day: 'numeric', month: 'short', year: 'numeric' });
                
                return (
                  <div key={sale.id} className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <p className="text-xs text-slate-400 font-medium mb-1">{date}</p>
                        <div className="flex gap-2 items-center">
                          <span className={`text-[10px] uppercase font-black px-2 py-0.5 rounded-md ${
                            sale.status === 'paid' ? 'bg-emerald-100 text-emerald-700' :
                            sale.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                            sale.status === 'credit' ? 'bg-amber-100 text-amber-700' :
                            'bg-indigo-100 text-indigo-700'
                          }`}>
                            {sale.status === 'paid' ? 'Pagado' : sale.status === 'cancelled' ? 'PENALIZACIÓN' : sale.status === 'credit' ? 'Crédito' : 'Pedido Web'}
                          </span>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="font-black text-slate-800">${sale.total.toFixed(2)}</p>
                        {sale.status === 'cancelled' && (
                          <p className="text-xs font-bold text-red-600 mt-0.5 uppercase">Penalización por Impago</p>
                        )}
                        {sale.status === 'credit' && debt > 0 && (
                          <p className="text-xs font-bold text-rose-500 mt-0.5">Resta: ${debt.toFixed(2)}</p>
                        )}
                      </div>
                    </div>

                    <div className="space-y-3 border-t border-slate-100 pt-3">
                      {sale.sale_items?.map(item => {
                        const findBookingForItem = (status) => data.bookings.find(bk => {
                          let ids = bk.sale_item_ids || [];
                          if (typeof ids === 'string') { try { ids = JSON.parse(ids); } catch(e) { ids = []; } }
                          return Array.isArray(ids) && ids.includes(item.id) && bk.delivery_status === status;
                        });

                        const deliveredBooking = item.delivery_status === 'delivered' ? findBookingForItem('entregado') : null;
                        const failedBooking = item.delivery_status !== 'delivered' ? findBookingForItem('no_entregado') : null;

                        const deliveryDateRaw = deliveredBooking?.delivered_at || deliveredBooking?.date || null;
                        const deliveryDate = deliveryDateRaw
                          ? new Date(deliveryDateRaw).toLocaleDateString("es-MX", { day: 'numeric', month: 'short', year: 'numeric' })
                          : null;

                        const failedDateRaw = failedBooking?.date || null;
                        const failedDate = failedDateRaw
                          ? new Date(failedDateRaw + "T00:00:00").toLocaleDateString("es-MX", { day: 'numeric', month: 'short', year: 'numeric' })
                          : null;

                        return (
                          <div key={item.id} className="flex justify-between items-start text-sm">
                            <div className="flex items-start gap-2">
                              <span className="text-slate-400 font-mono text-xs mt-0.5">{item.quantity}x</span>
                              <div>
                                <span className="text-slate-700 font-medium">{item.products?.name}</span>
                                <div className="mt-1 flex flex-col gap-1">
                                  {item.delivery_status === 'delivered' ? (
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-[10px] font-black uppercase px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded-md border border-emerald-100">✓ Entregado</span>
                                      {deliveryDate && <span className="text-[10px] text-slate-400">{deliveryDate}</span>}
                                    </div>
                                  ) : (
                                    <>
                                      {failedBooking && (
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="text-[10px] font-black uppercase px-1.5 py-0.5 bg-rose-50 text-rose-600 rounded-md border border-rose-100">⚠ Intento fallido</span>
                                          {failedDate && <span className="text-[10px] text-slate-400">{failedDate}</span>}
                                        </div>
                                      )}
                                      <span className="text-[10px] font-black uppercase px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded-md border border-amber-100 self-start">⌛ Pendiente de entrega</span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <span className="text-slate-500 shrink-0 ml-2">${(item.quantity * item.unit_price).toFixed(2)}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
