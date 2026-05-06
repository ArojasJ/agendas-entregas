"use client";
import { useEffect, useState, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function ClientesPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center">Cargando...</div>}>
      <ClientesContent />
    </Suspense>
  );
}

function ClientesContent() {
  const router = useRouter();
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [boxFilter, setBoxFilter] = useState("");
  const [boxErrors, setBoxErrors] = useState({ box_1: "", box_2: "" });
  
  // Expediente del cliente
  const [showExpediente, setShowExpediente] = useState(false);
  const [activeClient, setActiveClient] = useState(null);
  const [clientSales, setClientSales] = useState([]);
  const [loadingSales, setLoadingSales] = useState(false);

  // Alertas
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });
  const [confirmDialog, setConfirmDialog] = useState({ show: false, clientId: null });

  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "success" }), 4000);
  };

  const [form, setForm] = useState({ id: null, name: "", instagram: "", phone: "", box_1: "", box_2: "" });

  const searchParams = useSearchParams();

  useEffect(() => {
    fetchClients();
    const query = searchParams.get("search");
    if (query) setSearch(query);
  }, [searchParams]);

  useEffect(() => {
    const openId = searchParams.get("openId");
    if (!openId || clients.length === 0) return;
    const client = clients.find(c => String(c.id) === String(openId));
    if (client) openExpediente(client);
  }, [clients, searchParams]);

  const fetchClients = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/clients", { headers: { "x-panel-token": token } });
      if (res.ok) {
        const data = await res.json();
        setClients(data.clients || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const openExpediente = async (client) => {
    setActiveClient(client);
    setShowExpediente(true);
    setLoadingSales(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/clients?id=${client.id}`, { headers: { "x-panel-token": token } });
      if (res.ok) {
        const data = await res.json();
        setClientSales(data.sales || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSales(false);
    }
  };

  const checkBoxConflict = async (field, value) => {
    if (!value || !value.trim()) {
      setBoxErrors(prev => ({ ...prev, [field]: "" }));
      return;
    }
    try {
      const token = localStorage.getItem("panelToken") || "";
      const excludeParam = form.id ? `&excludeId=${form.id}` : "";
      const res = await fetch(`/api/clients?checkBox=${encodeURIComponent(value.trim())}${excludeParam}`, {
        headers: { "x-panel-token": token }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.conflicts && data.conflicts.length > 0) {
          const c = data.conflicts[0];
          const who = c.instagram || c.name || "otro cliente";
          const inField = c.box_1 === value.trim() ? "Caja 1" : "Caja 2";
          setBoxErrors(prev => ({ ...prev, [field]: `En uso por ${who} (${inField})` }));
        } else {
          setBoxErrors(prev => ({ ...prev, [field]: "" }));
        }
      }
    } catch {}
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (boxErrors.box_1 || boxErrors.box_2) return;

    setSaving(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const isEdit = !!form.id;
      const res = await fetch("/api/clients", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (res.ok) {
        await fetchClients();
        closeModal();
        showToast(isEdit ? "Cliente actualizado" : "Cliente agregado", "success");
      } else {
        showToast(data.message || "Error al guardar", "error");
      }
    } catch (err) {
      showToast("Error de conexión", "error");
    } finally {
      setSaving(false);
    }
  };

  const executeDelete = async () => {
    const id = confirmDialog.clientId;
    setConfirmDialog({ show: false, clientId: null });
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/clients?id=${id}`, { method: "DELETE", headers: { "x-panel-token": token } });
      if (res.ok) {
        fetchClients();
        showToast("Cliente eliminado", "success");
      } else {
        showToast("Error al eliminar", "error");
      }
    } catch (e) {
      showToast("Error de conexión", "error");
    }
  };

  const openModal = (client = null) => {
    setForm(client || { id: null, name: "", instagram: "", phone: "", box_1: "", box_2: "" });
    setBoxErrors({ box_1: "", box_2: "" });
    setShowModal(true);
  };

  const closeModal = () => {
    setBoxErrors({ box_1: "", box_2: "" });
    setShowModal(false);
  };

  const filteredClients = useMemo(() => {
    const searchStr = search.replace('@', '').toLowerCase();
    const boxStr = boxFilter.trim();
    return clients
      .filter(c => {
        const matchSearch = !searchStr ||
          (c.instagram && c.instagram.toLowerCase().includes(searchStr)) ||
          (c.name && c.name.toLowerCase().includes(searchStr));
        const matchBox = !boxStr ||
          (c.box_1 && c.box_1 === boxStr) ||
          (c.box_2 && c.box_2 === boxStr);
        return matchSearch && matchBox;
      })
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [clients, search, boxFilter]);

  return (
    <main className="max-w-6xl mx-auto px-4 md:px-8 py-8 relative">
      
      {/* TOAST */}
      <div className={`fixed top-6 right-6 z-[60] transition-all duration-500 transform ${toast.show ? "translate-y-0 opacity-100" : "-translate-y-10 opacity-0 pointer-events-none"}`}>
        <div className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-md ${toast.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
          <span className="text-xl">{toast.type === 'error' ? '⚠️' : '✓'}</span>
          <span className="font-semibold text-sm">{toast.message}</span>
        </div>
      </div>

      {/* CONFIRM DELETE */}
      {confirmDialog.show && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden animate-in fade-in zoom-in">
            <div className="p-6 text-center">
              <span className="text-4xl block mb-2">🗑</span>
              <h3 className="text-lg font-bold text-slate-900 mb-2">¿Eliminar cliente?</h3>
              <p className="text-sm text-slate-500">Esta acción no se puede deshacer.</p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-3">
              <button onClick={() => setConfirmDialog({ show: false, clientId: null })} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50">Cancelar</button>
              <button onClick={executeDelete} className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-slate-900 font-bold shadow-lg shadow-red-500/20">Sí, eliminar</button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Directorio de Clientes</h1>
          <p className="text-sm mt-1 opacity-70">Gestiona expedientes y créditos.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 min-w-[160px] md:w-64">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50">🔍</span>
            <input type="text" placeholder="Buscar por @instagram..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9 pr-4 py-2.5 rounded-xl border bg-slate-50 border-slate-200 focus:outline-none focus:border-emerald-500 transition-colors" />
          </div>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50">📦</span>
            <input
              type="text"
              placeholder="N° caja..."
              value={boxFilter}
              onChange={e => setBoxFilter(e.target.value)}
              className={`pl-9 pr-4 py-2.5 rounded-xl border text-sm w-28 focus:outline-none transition-colors ${boxFilter ? "bg-indigo-50 border-indigo-400 text-indigo-700 font-semibold" : "bg-slate-50 border-slate-200 focus:border-indigo-400"}`}
            />
            {boxFilter && (
              <button onClick={() => setBoxFilter("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-indigo-400 hover:text-indigo-600 text-xs font-bold">✕</button>
            )}
          </div>
          <button onClick={() => openModal()} className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-semibold px-5 py-2.5 rounded-xl shadow-lg active:scale-95 transition-all">
            + Nuevo Cliente
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {loading ? (
          <div className="col-span-full p-10 text-center opacity-50">Cargando clientes...</div>
        ) : filteredClients.map(c => (
          <div key={c.id} className="rounded-2xl border bg-slate-50 border-slate-200 p-5 hover:bg-slate-100 transition-colors relative group">
            <div className="absolute right-4 top-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => openModal(c)} className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center hover:bg-slate-200">✏️</button>
              <button onClick={() => setConfirmDialog({ show: true, clientId: c.id })} className="w-8 h-8 rounded-lg bg-red-500/20 text-red-400 flex items-center justify-center hover:bg-red-500/40">🗑</button>
            </div>
            
            <div className="flex items-center gap-4 mb-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 font-bold text-2xl uppercase">
                {c.name.charAt(0)}
              </div>
              <div>
                <h3 className="font-bold text-lg text-emerald-400 leading-tight">
                  {c.instagram || c.name}
                </h3>
                <p className="text-xs opacity-60">
                  {c.instagram ? c.name : ""} {c.phone && `📱 ${c.phone}`}
                </p>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {c.box_1 && <span className="px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[10px] font-bold rounded-md">Caja 1: {c.box_1}</span>}
                  {c.box_2 && <span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[10px] font-bold rounded-md">Caja 2: {c.box_2}</span>}
                  {Number(c.saldo_favor) > 0 && <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-[10px] font-black rounded-md">💚 ${Number(c.saldo_favor).toFixed(2)} a favor</span>}
                </div>
              </div>
            </div>
            
            <button 
              onClick={() => openExpediente(c)}
              className="w-full py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold hover:bg-slate-100 transition-colors"
            >
              Ver Expediente
            </button>
          </div>
        ))}
      </div>

      {/* MODAL NUEVO/EDITAR */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm shadow-2xl animate-in fade-in zoom-in">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-white">
              <h2 className="text-lg font-bold">{form.id ? "Editar Cliente" : "Nuevo Cliente"}</h2>
              <button onClick={closeModal} className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center">✕</button>
            </div>
            <form onSubmit={handleSave} className="p-6 space-y-4">
              <input type="text" placeholder="Nombre completo (opcional)" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-emerald-500 focus:outline-none" />
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium">@</span>
                <input 
                  type="text" 
                  placeholder="usuario_ig" 
                  value={form.instagram.replace(/^@/, '')} 
                  onChange={e => setForm({...form, instagram: e.target.value.replace(/^@/, '')})} 
                  className="w-full pl-8 pr-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-emerald-500 focus:outline-none" 
                />
              </div>
              <input type="tel" placeholder="Teléfono" value={form.phone || ""} onChange={e => setForm({...form, phone: e.target.value})} className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-emerald-500 focus:outline-none" />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 ml-1">Caja 1</label>
                  <input
                    type="text"
                    placeholder="Núm. Caja"
                    value={form.box_1 || ""}
                    onChange={e => { setForm({...form, box_1: e.target.value}); setBoxErrors(prev => ({ ...prev, box_1: "" })); }}
                    onBlur={e => checkBoxConflict("box_1", e.target.value)}
                    className={`w-full px-4 py-2.5 rounded-xl bg-slate-50 border text-sm focus:outline-none ${boxErrors.box_1 ? "border-red-400 focus:border-red-400" : "border-slate-200 focus:border-indigo-500"}`}
                  />
                  {boxErrors.box_1 && <p className="text-[10px] text-red-500 mt-1 ml-1">{boxErrors.box_1}</p>}
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1 ml-1">Caja 2</label>
                  <input
                    type="text"
                    placeholder="Núm. Caja"
                    value={form.box_2 || ""}
                    onChange={e => { setForm({...form, box_2: e.target.value}); setBoxErrors(prev => ({ ...prev, box_2: "" })); }}
                    onBlur={e => checkBoxConflict("box_2", e.target.value)}
                    className={`w-full px-4 py-2.5 rounded-xl bg-slate-50 border text-sm focus:outline-none ${boxErrors.box_2 ? "border-red-400 focus:border-red-400" : "border-slate-200 focus:border-blue-500"}`}
                  />
                  {boxErrors.box_2 && <p className="text-[10px] text-red-500 mt-1 ml-1">{boxErrors.box_2}</p>}
                </div>
              </div>
              <button type="submit" disabled={saving} className="w-full py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold shadow-lg mt-2">{saving ? "Guardando..." : "Guardar"}</button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL EXPEDIENTE PREMIUM (FULLSCREEN EN MÓVIL) */}
      {showExpediente && activeClient && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-50 sm:p-4">
          <div className="bg-white w-full h-full sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-[3rem] shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom sm:zoom-in duration-300">
            {/* HEADER DEL EXPEDIENTE */}
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white sticky top-0 z-10">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500 text-slate-900 flex items-center justify-center text-xl font-black shadow-lg shadow-emerald-500/20">
                  {activeClient.name.charAt(0)}
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900 leading-tight">{activeClient.name}</h2>
                  <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">{activeClient.instagram || "Sin Instagram"}</p>
                  {Number(activeClient.saldo_favor) > 0 && (
                    <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-emerald-100 border border-emerald-200 text-emerald-700 text-[10px] font-black rounded-full">
                      💚 ${Number(activeClient.saldo_favor).toFixed(2)} a favor
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => setShowExpediente(false)} className="w-10 h-10 rounded-2xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors">✕</button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              {loadingSales ? (
                <div className="flex flex-col items-center justify-center py-20 gap-4">
                  <div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Cargando historial...</p>
                </div>
              ) : clientSales.length === 0 ? (
                <div className="text-center py-20">
                  <span className="text-5xl block mb-4">🛍️</span>
                  <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Aún no tiene compras registradas</p>
                </div>
              ) : (
                <div className="grid gap-4">
                  {clientSales.map(sale => {
                    const isCredit = sale.status === 'credit';
                    const totalAbonos = (sale.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
                    const remaining = sale.total - sale.down_payment - totalAbonos;
                    const saleDate = new Date(sale.created_at);
                    
                    return (
                      <div 
                        key={sale.id} 
                        onClick={() => router.push(`/panel/ventas/${sale.id}`)}
                        className={`group rounded-[2rem] border-2 p-6 transition-all active:scale-[0.98] ${
                          isCredit && remaining > 0 
                            ? 'bg-amber-50/30 border-amber-100 hover:bg-amber-50' 
                            : 'bg-slate-50/50 border-slate-100 hover:bg-white hover:border-emerald-500/20'
                        }`}
                      >
                        <div className="flex justify-between items-start mb-6">
                          <div>
                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">
                              {saleDate.toLocaleDateString("es-MX", { day: 'numeric', month: 'short', year: 'numeric' })}
                            </span>
                            <h4 className="text-2xl font-black text-slate-900">${sale.total.toFixed(2)}</h4>
                          </div>
                          <div className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                            isCredit && remaining > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                          }`}>
                            {isCredit && remaining > 0 ? 'CRÉDITO PENDIENTE' : 'PAGADO'}
                          </div>
                        </div>

                        {/* LISTA DE ITEMS */}
                        <div className="space-y-2 mb-6">
                          {sale.sale_items?.map((item, idx) => (
                            <div key={idx} className="flex justify-between items-center">
                              <p className="text-xs font-bold text-slate-600">
                                <span className="text-emerald-500 mr-2">{item.quantity}x</span>
                                {item.products?.name}
                              </p>
                              <span className="text-[10px] font-mono text-slate-400">${item.unit_price}</span>
                            </div>
                          ))}
                        </div>

                        {isCredit && remaining > 0 && (
                          <div className="pt-5 border-t border-amber-200/50 flex justify-between items-end">
                            <div>
                              <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-1">Deuda actual</p>
                              <p className="text-lg font-black text-amber-900">${remaining.toFixed(2)}</p>
                            </div>
                            <div className="text-right">
                              <p className="text-[9px] font-bold text-slate-400">Enganche: ${sale.down_payment}</p>
                              {totalAbonos > 0 && <p className="text-[9px] font-bold text-emerald-500">Abonos: +${totalAbonos}</p>}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            
            {/* FOOTER DEL MODAL */}
            <div className="p-6 bg-slate-50 border-t border-slate-100 sm:rounded-b-[3rem]">
              <button 
                onClick={() => setShowExpediente(false)}
                className="w-full bg-slate-900 text-white font-black py-4 rounded-2xl shadow-xl active:scale-[0.97] transition-all"
              >
                CERRAR EXPEDIENTE
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
