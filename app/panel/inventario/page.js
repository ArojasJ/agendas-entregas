"use client";
import { useEffect, useState, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function InventarioPage() {
  return (
    <Suspense fallback={<div className="p-10 text-center opacity-50">Cargando inventario...</div>}>
      <InventarioContent />
    </Suspense>
  );
}

function InventarioContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState(searchParams.get("search") || searchParams.get("id") || "");
  
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });
  const [confirmDialog, setConfirmDialog] = useState({ show: false, productId: null });

  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "success" }), 4000);
  };

  const [form, setForm] = useState({
    id: null,
    name: "",
    category: "",
    stock: 0,
    barcode: "",
    cost: 0,
    price: 0,
    image_url: "",
    description: ""
  });

  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);

  useEffect(() => {
    if (showModal && form.id) {
      fetchStats(form.id);
    } else {
      setStats(null);
    }
  }, [showModal, form.id]);

  const fetchStats = async (id) => {
    setLoadingStats(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/products/stats?id=${id}`, { headers: { "x-panel-token": token } });
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingStats(false);
    }
  };

  const [previewImage, setPreviewImage] = useState(null);
  const [isNewCategory, setIsNewCategory] = useState(false);

  const uniqueCategories = useMemo(() => {
    const cats = products.map(p => p.category).filter(c => typeof c === 'string' && c.trim() !== "");
    return Array.from(new Set(cats)).sort();
  }, [products]);

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/products", {
        headers: { "x-panel-token": token },
      });
      if (res.ok) {
        const data = await res.json();
        setProducts(data.products || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 600;
        const scaleSize = MAX_WIDTH / img.width;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * scaleSize;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const base64 = canvas.toDataURL("image/jpeg", 0.7);
        setPreviewImage(base64);
        setForm(f => ({ ...f, image_url: base64 }));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const calculateMargin = () => {
    const c = Number(form.cost) || 0;
    const p = Number(form.price) || 0;
    if (p === 0) return 0;
    const margin = ((p - c) / p) * 100;
    return margin.toFixed(1);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name || form.cost === "" || form.price === "") {
      showToast("Falta el nombre, costo o precio.", "error");
      return;
    }

    setSaving(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const isEdit = !!form.id;
      const url = "/api/products";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify(form)
      });

      if (!res.ok) {
        const errorData = await res.json();
        showToast(errorData.message || "Error al guardar", "error");
      } else {
        await fetchProducts();
        closeModal();
        showToast(isEdit ? "Producto actualizado con éxito" : "Producto agregado con éxito", "success");
      }
    } catch (err) {
      showToast("Error de conexión", "error");
    } finally {
      setSaving(false);
    }
  };

  const executeDelete = async () => {
    const id = confirmDialog.productId;
    setConfirmDialog({ show: false, productId: null });
    
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/products?id=${id}`, {
        method: "DELETE",
        headers: { "x-panel-token": token },
      });
      if (res.ok) {
        fetchProducts();
        showToast("Producto eliminado correctamente", "success");
      } else {
        showToast("Error al eliminar", "error");
      }
    } catch (e) {
      showToast("Error de conexión", "error");
    }
  };

  const openModal = (product = null) => {
    if (product) {
      setForm(product);
      setPreviewImage(product.image_url || null);
      setIsNewCategory(false);
    } else {
      setForm({ id: null, name: "", category: "", stock: 0, barcode: "", cost: "", price: "", image_url: "", description: "" });
      setPreviewImage(null);
      setIsNewCategory(false);
    }
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setForm({ id: null, name: "", category: "", stock: 0, barcode: "", cost: "", price: "", image_url: "", description: "" });
    setPreviewImage(null);
  };

  const filteredProducts = useMemo(() => {
    return products
      .filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || (p.barcode && p.barcode.includes(search)) || (p.id && String(p.id).includes(search)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [products, search]);

  return (
    <main className="max-w-7xl mx-auto px-4 md:px-8 py-8 relative">
      
      {/* ── TOAST NOTIFICATION ── */}
      <div className={`fixed top-6 right-6 z-[60] transition-all duration-500 transform ${toast.show ? "translate-y-0 opacity-100" : "-translate-y-10 opacity-0 pointer-events-none"}`}>
        <div className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-md ${toast.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
          <span className="text-xl">{toast.type === 'error' ? '⚠️' : '✓'}</span>
          <span className="font-semibold text-sm">{toast.message}</span>
        </div>
      </div>

      {/* ── CONFIRM DELETE MODAL ── */}
      {confirmDialog.show && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">🗑</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">¿Eliminar producto?</h3>
              <p className="text-sm text-slate-500">Esta acción no se puede deshacer. El producto desaparecerá del inventario permanentemente.</p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-3">
              <button onClick={() => setConfirmDialog({ show: false, productId: null })} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors">
                Cancelar
              </button>
              <button onClick={executeDelete} className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-slate-900 font-bold shadow-lg shadow-red-500/20 transition-all">
                Sí, eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Inventario</h1>
          <p className="text-sm mt-1 opacity-70">Gestiona tus productos, stock y precios.</p>
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50">🔍</span>
            <input 
              type="text" 
              placeholder="Buscar producto o código..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl border bg-slate-50 border-slate-200 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
          
          <button 
            onClick={() => openModal()}
            className="flex-shrink-0 bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-semibold px-5 py-2.5 rounded-xl transition-all shadow-lg active:scale-95"
          >
            + Nuevo
          </button>
        </div>
      </div>

      {/* Lista de productos */}
      <div className="rounded-2xl border bg-slate-50 border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center opacity-50">Cargando inventario...</div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-10 text-center opacity-50">No hay productos que coincidan con la búsqueda.</div>
        ) : (
          <div className="divide-y divide-white/[0.06]">
            {filteredProducts.map(p => (
              <div key={p.id} className="p-4 hover:bg-slate-100 transition-colors flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  {p.image_url ? (
                    <img src={p.image_url} alt={p.name} className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-xl opacity-50">📦</div>
                  )}
                  <div>
                    <h3 className="font-bold text-base">{p.name}</h3>
                    <div className="flex flex-wrap items-center gap-3 text-xs opacity-60 mt-1">
                      {p.category && <span>🏷 {p.category}</span>}
                      {p.barcode && <span>⏸ {p.barcode}</span>}
                      <span className={p.stock <= 0 ? "text-red-400 font-bold" : "text-emerald-400 font-bold"}>
                        📦 Stock: {p.stock}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-6">
                  <div className="text-right hidden sm:block">
                    <p className="text-sm font-bold text-emerald-400">${p.price}</p>
                    <p className="text-[10px] opacity-50">Costo: ${p.cost}</p>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <button onClick={() => openModal(p)} className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-50 hover:bg-slate-100 text-sm transition-colors border border-transparent hover:border-slate-200">✏️</button>
                    <button onClick={() => setConfirmDialog({ show: true, productId: p.id })} className="w-9 h-9 rounded-xl flex items-center justify-center bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm transition-colors border border-transparent hover:border-red-500/20">🗑</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal Agregar/Editar */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden my-8 animate-in fade-in zoom-in duration-200">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white z-10">
              <h2 className="text-lg font-bold text-slate-900">{form.id ? "Editar Producto" : "Nuevo Producto"}</h2>
              <button onClick={closeModal} className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center transition-colors">✕</button>
            </div>
            
            <form onSubmit={handleSave} className="p-6 space-y-5">
              
              <div className="flex items-center gap-5">
                <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center relative overflow-hidden bg-slate-50 cursor-pointer hover:bg-slate-100 hover:border-slate-400 transition-all group">
                  {previewImage ? (
                    <img src={previewImage} alt="Preview" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                  ) : (
                    <span className="text-xs opacity-50 text-center px-2">📷<br/>Añadir Foto</span>
                  )}
                  <input type="file" accept="image/*" onChange={handleImageUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Nombre del producto *</label>
                  <input required type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-emerald-500 focus:bg-slate-100 transition-all" placeholder="Ej: Bolsa Guess Negra" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Categoría</label>
                  {!isNewCategory && uniqueCategories.length > 0 ? (
                    <div className="relative">
                      <select 
                        value={form.category} 
                        onChange={e => {
                          if (e.target.value === "NEW") {
                            setIsNewCategory(true);
                            setForm({...form, category: ""});
                          } else {
                            setForm({...form, category: e.target.value});
                          }
                        }}
                        className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-emerald-500 focus:bg-slate-100 transition-all appearance-none cursor-pointer"
                      >
                        <option value="" className="bg-white">Selecciona o crea...</option>
                        {uniqueCategories.map(c => <option key={c} value={c} className="bg-white">{c}</option>)}
                        <option value="NEW" className="bg-emerald-900 font-bold">+ Crear nueva categoría</option>
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50 text-xs">▼</div>
                    </div>
                  ) : (
                    <div className="relative">
                      <input 
                        type="text" 
                        required 
                        value={form.category} 
                        onChange={e => setForm({...form, category: e.target.value})} 
                        className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-emerald-500 focus:bg-slate-100 transition-all pr-10" 
                        placeholder="Nueva categoría..." 
                      />
                      {uniqueCategories.length > 0 && (
                        <button 
                          type="button" 
                          onClick={() => { setIsNewCategory(false); setForm({...form, category: ""}); }} 
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg bg-slate-50 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                          title="Cancelar nueva categoría"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Código (SKU)</label>
                  <input type="text" value={form.barcode} onChange={e => setForm({...form, barcode: e.target.value})} className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-emerald-500 focus:bg-slate-100 transition-all" placeholder="Escanea o escribe..." />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 border-t border-slate-200 pt-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Costo *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-medium">$</span>
                    <input required type="number" step="0.01" value={form.cost} onChange={e => setForm({...form, cost: e.target.value})} className="w-full pl-7 pr-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-emerald-500 focus:bg-slate-100 transition-all" placeholder="0.00" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-emerald-400 mb-1.5 uppercase tracking-wider">Venta *</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400 font-bold">$</span>
                    <input required type="number" step="0.01" value={form.price} onChange={e => setForm({...form, price: e.target.value})} className="w-full pl-7 pr-3 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-bold text-sm focus:outline-none focus:border-emerald-500 transition-all" placeholder="0.00" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Stock</label>
                  <input type="number" value={form.stock} onChange={e => setForm({...form, stock: e.target.value})} className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-emerald-500 focus:bg-slate-100 transition-all" placeholder="0" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Descripción (para el catálogo)</label>
                <textarea 
                  placeholder="Describe el producto (material, uso, detalles)..." 
                  value={form.description || ""}
                  onChange={e => setForm({...form, description: e.target.value})}
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-emerald-500 focus:bg-slate-100 transition-all min-h-[80px] resize-y"
                />
              </div>

              {/* Margen de ganancia */}
              <div className="bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.15),transparent)] border border-emerald-500/20 rounded-2xl p-4 flex items-center justify-between shadow-inner">
                <span className="text-xs font-medium text-emerald-400 uppercase tracking-widest">Margen estimado</span>
                <span className="text-xl font-black text-emerald-400 tracking-tight">{calculateMargin()}%</span>
              </div>

              <div className="pt-2 flex justify-end gap-3 border-b border-slate-100 pb-6 mb-4">
                <button type="button" onClick={closeModal} className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors">Cancelar</button>
                <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition-all active:scale-95">
                  {saving ? "Guardando..." : "Guardar Producto"}
                </button>
              </div>

            </form>

            {/* ESTADÍSTICAS E HISTORIAL */}
            {form.id && (
              <div className="px-6 pb-6">
                <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <span className="text-xl">📊</span> Trazabilidad del Producto
                </h3>
                
                {loadingStats ? (
                  <div className="text-center opacity-50 py-4 text-sm">Cargando estadísticas...</div>
                ) : stats ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <span className="text-[10px] uppercase font-bold text-slate-400">Creación</span>
                        <p className="text-sm font-bold text-slate-700">
                          {new Date(stats.product?.created_at).toLocaleDateString("es-MX")}
                        </p>
                      </div>
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <span className="text-[10px] uppercase font-bold text-slate-400">Stock Inicial (Est.)</span>
                        <p className="text-sm font-bold text-slate-700">{stats.stats?.estimated_initial_stock}</p>
                      </div>
                      <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100">
                        <span className="text-[10px] uppercase font-bold text-emerald-600">Total Vendidos</span>
                        <p className="text-xl font-black text-emerald-700">{stats.stats?.total_units_sold}</p>
                      </div>
                      <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                        <span className="text-[10px] uppercase font-bold text-blue-600">Veces Vendido</span>
                        <p className="text-xl font-black text-blue-700">{stats.stats?.total_sales_count}</p>
                      </div>
                    </div>

                    <div className="mt-4">
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">A quién se le vendió</h4>
                      <div className="bg-slate-50 border border-slate-200 rounded-xl max-h-48 overflow-y-auto">
                        {stats.sales_history && stats.sales_history.length > 0 ? (
                          <div className="divide-y divide-slate-200">
                            {stats.sales_history.map((sale, idx) => (
                              <div key={idx} className="p-3 flex items-center justify-between hover:bg-white transition-colors">
                                <div>
                                  <p className="font-bold text-sm text-slate-900">
                                    {sale.client_instagram ? `@${sale.client_instagram.replace(/^@/, '')}` : sale.client_name}
                                  </p>
                                  <p className="text-[10px] text-slate-500">
                                    {new Date(sale.date).toLocaleString("es-MX", { day: '2-digit', month: 'short', year: 'numeric' })}
                                  </p>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-xs font-bold text-slate-400">{sale.quantity}x</span>
                                  <button 
                                    type="button"
                                    onClick={() => router.push(`/panel/ventas/${sale.sale_id}`)}
                                    className="px-2 py-1 bg-white border border-slate-200 rounded-md text-xs font-bold text-slate-600 hover:bg-slate-100 hover:text-emerald-600 transition-colors"
                                  >
                                    Ver Venta ➔
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 text-center text-xs text-slate-500">
                            Aún no hay ventas registradas para este producto.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-red-500 py-4 text-sm">Error al cargar estadísticas.</div>
                )}
              </div>
            )}

          </div>
        </div>
      )}
    </main>
  );
}
