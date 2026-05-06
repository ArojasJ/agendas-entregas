"use client";
import { useEffect, useState, useMemo, useRef } from "react";

export default function PosPage() {
  const [products, setProducts] = useState([]);
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Carrito de compras
  const [cart, setCart] = useState([]);
  const [selectedClient, setSelectedClient] = useState(null); // Objeto completo del cliente
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  
  const [discount, setDiscount] = useState(0);
  const [discountType, setDiscountType] = useState("$"); // "$" | "%"
  
  // Checkout Modal State
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [paymentType, setPaymentType] = useState("paid"); // 'paid' o 'credit'
  const [downPayment, setDownPayment] = useState(0);
  const [creditDays, setCreditDays] = useState(15);
  const [paymentMethod, setPaymentMethod] = useState("efectivo");

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, message: "", type: "success" });

  // Modal tarjeta de cliente
  const [showClientCard, setShowClientCard] = useState(false);
  const [editingBox, setEditingBox] = useState(false);
  const [boxForm, setBoxForm] = useState({ box_1: "", box_2: "" });
  const [savingBox, setSavingBox] = useState(false);

  // Modal nuevo cliente desde POS
  const [showNewClientModal, setShowNewClientModal] = useState(false);
  const [newClientForm, setNewClientForm] = useState({ name: "", instagram: "", phone: "", box_1: "", box_2: "" });
  const [savingNewClient, setSavingNewClient] = useState(false);
  const [confirmClearCart, setConfirmClearCart] = useState(false);
  const [variantPicker, setVariantPicker] = useState(null); // product con variantes

  const searchInputRef = useRef(null);

  const showToast = (message, type = "success") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "success" }), 3000);
  };

  useEffect(() => {
    fetchData();
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const [resProd, resCli] = await Promise.all([
        fetch("/api/products", { headers: { "x-panel-token": token } }),
        fetch("/api/clients", { headers: { "x-panel-token": token } })
      ]);
      
      if (resProd.ok) {
        const dp = await resProd.json();
        setProducts(dp.products || []);
      }
      if (resCli.ok) {
        const dc = await resCli.json();
        setClients(dc.clients || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateClient = async (e) => {
    e.preventDefault();
    if (!newClientForm.name) return;
    setSavingNewClient(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify(newClientForm),
      });
      if (res.ok) {
        const data = await res.json();
        const created = data.client;
        setClients(prev => [...prev, created]);
        setSelectedClient(created);
        setClientSearchQuery(created.instagram ? "@" + created.instagram.replace(/^@/, "") : created.name);
        setShowNewClientModal(false);
        setNewClientForm({ name: "", instagram: "", phone: "", box_1: "", box_2: "" });
        setShowClientDropdown(false);
        showToast("Cliente creado y seleccionado", "success");
      } else {
        const err = await res.json();
        showToast(err.message || "Error al crear cliente", "error");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setSavingNewClient(false);
    }
  };

  const handleSaveBox = async () => {
    setSavingBox(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/clients/${selectedClient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({ box_1: boxForm.box_1, box_2: boxForm.box_2 })
      });
      const data = await res.json();
      if (res.ok) {
        const updated = { ...selectedClient, box_1: boxForm.box_1, box_2: boxForm.box_2 };
        setSelectedClient(updated);
        setClients(prev => prev.map(c => c.id === updated.id ? updated : c));
        setEditingBox(false);
        showToast("Caja actualizada", "success");
      } else {
        showToast(data.message || "Error al guardar", "error");
      }
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setSavingBox(false);
    }
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === "Enter") {
      // Buscar también en barcodes de variantes
      const q = search.toLowerCase();
      let match = products.find(p => p.barcode === search || p.name.toLowerCase() === q);
      if (!match) {
        // Buscar en variantes por barcode
        for (const p of products) {
          const v = (p.product_variants || []).find(v => v.barcode === search);
          if (v) { addVariantDirectly(p, v); setSearch(""); return; }
        }
      }
      if (match) {
        addToCart(match);
        setSearch("");
      } else {
        showToast("Producto no encontrado", "error");
      }
    }
  };

  const addToCart = (product) => {
    const pvs = product.product_variants || [];
    if (pvs.length > 0) {
      setVariantPicker(product);
      return;
    }
    if (product.stock <= 0) { showToast("Producto sin existencias", "error"); return; }
    setCart(prev => {
      const existing = prev.find(item => item._cartKey === product.id);
      if (existing) {
        if (existing.quantity >= existing.max_stock) { showToast("No hay más stock", "error"); return prev; }
        return prev.map(item => item._cartKey === product.id ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { _cartKey: product.id, product_id: product.id, variant_id: null, name: product.name, unit_price: product.price, quantity: 1, max_stock: product.stock }];
    });
  };

  const addVariantDirectly = (product, variant) => {
    if (variant.stock <= 0) { showToast("Sin stock en esta variante", "error"); return; }
    const key = `${product.id}_${variant.id}`;
    setCart(prev => {
      const existing = prev.find(item => item._cartKey === key);
      if (existing) {
        if (existing.quantity >= existing.max_stock) { showToast("No hay más stock", "error"); return prev; }
        return prev.map(item => item._cartKey === key ? { ...item, quantity: item.quantity + 1 } : item);
      }
      return [...prev, { _cartKey: key, product_id: product.id, variant_id: variant.id, name: `${product.name} · ${variant.name}`, unit_price: variant.price, quantity: 1, max_stock: variant.stock }];
    });
    setVariantPicker(null);
  };

  const updateQuantity = (cartKey, delta) => {
    setCart(prev => prev.map(item => {
      if (item._cartKey === cartKey) {
        const newQ = item.quantity + delta;
        if (newQ > item.max_stock) return item;
        if (newQ <= 0) return { ...item, remove: true };
        return { ...item, quantity: newQ };
      }
      return item;
    }).filter(item => !item.remove));
  };

  const filteredProducts = useMemo(() => {
    if (!search || search.trim().length < 2) return [];
    const q = search.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.barcode && p.barcode.includes(search)) ||
      (p.product_variants || []).some(v => v.name?.toLowerCase().includes(q) || v.barcode?.includes(search))
    );
  }, [products, search]);

  const subtotal = cart.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
  const discountAmount = discountType === "%" ? subtotal * (Math.min(discount, 100) / 100) : discount;
  const total = Math.max(0, subtotal - discountAmount);

  const openCheckout = () => {
    if (cart.length === 0) return;
    setPaymentType("paid");
    setDownPayment(total);
    setShowCheckoutModal(true);
  };

  const executeCheckout = async () => {
    if (paymentType === "credit" && !selectedClient) {
      showToast("Para ventas a crédito debes seleccionar un cliente", "error");
      return;
    }

    setSaving(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const body = {
        client_id: selectedClient ? selectedClient.id : null,
        total: total,
        discount: discountAmount,
        payment_method: paymentMethod,
        status: paymentType,
        down_payment: paymentType === 'paid' ? total : downPayment,
        credit_days: paymentType === 'credit' ? creditDays : null,
        items: cart.map(i => ({ product_id: i.product_id, variant_id: i.variant_id || null, quantity: i.quantity, unit_price: i.unit_price }))
      };

      const res = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify(body)
      });

      if (res.ok) {
        showToast("¡Venta completada con éxito!", "success");
        setCart([]);
        setSelectedClient(null);
        setClientSearchQuery("");
        setDiscount(0);
        setSearch("");
        setShowCheckoutModal(false);
        fetchData(); // Actualizar stock
      } else {
        const data = await res.json();
        showToast(data.message || "Error al cobrar", "error");
      }
    } catch (e) {
      showToast("Error de conexión", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col lg:flex-row h-full overflow-hidden bg-slate-50 text-slate-900">
      
      {/* TOAST */}
      <div className={`fixed top-6 right-6 z-[60] transition-all duration-500 transform ${toast.show ? "translate-y-0 opacity-100" : "-translate-y-10 opacity-0 pointer-events-none"}`}>
        <div className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-md ${toast.type === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'}`}>
          <span className="text-xl">{toast.type === 'error' ? '⚠️' : '✓'}</span>
          <span className="font-semibold text-sm">{toast.message}</span>
        </div>
      </div>

      {/* LADO IZQUIERDO: PRODUCTOS */}
      <div className="flex-1 flex flex-col h-full border-r border-slate-200 relative">
        <div className="p-4 border-b border-slate-200 bg-slate-50/80 backdrop-blur-md z-10 sticky top-0">
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 opacity-50 text-lg">🔍</span>
            <input 
              ref={searchInputRef}
              type="text" 
              placeholder="Buscar por nombre, SKU o código de barras (Enter para añadir)..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="w-full pl-12 pr-4 py-4 rounded-2xl bg-slate-50 border border-slate-200 text-slate-900 focus:outline-none focus:border-emerald-500 focus:bg-white/[0.06] transition-all text-lg shadow-inner"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="text-center opacity-50 mt-10">Cargando catálogo...</p>
          ) : search.trim().length < 2 ? (
            <div className="flex flex-col items-center justify-center h-64 opacity-30">
              <span className="text-6xl mb-4">🔍</span>
              <p className="text-lg font-bold">Busca un producto</p>
              <p className="text-sm">Escribe el nombre o escanea el código</p>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 opacity-30">
              <span className="text-6xl mb-4">❓</span>
              <p className="text-lg font-bold">Sin coincidencias</p>
              <p className="text-sm">Intenta con otro nombre o código</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {filteredProducts.map(p => {
                const pvs = p.product_variants || [];
                const hasVars = pvs.length > 0;
                const totalStock = hasVars ? pvs.reduce((s, v) => s + (v.stock || 0), 0) : p.stock;
                const outOfStock = totalStock <= 0;
                const minPrice = hasVars ? Math.min(...pvs.map(v => v.price)) : p.price;
                const maxPrice = hasVars ? Math.max(...pvs.map(v => v.price)) : p.price;
                return (
                  <button
                    key={p.id}
                    onClick={() => addToCart(p)}
                    disabled={outOfStock}
                    className={`flex flex-row items-center text-left rounded-2xl border p-3 transition-all ${outOfStock ? "bg-slate-50 border-transparent opacity-50 cursor-not-allowed" : "bg-white border-slate-200 hover:border-emerald-500/50 hover:bg-emerald-500/5 active:scale-95 shadow-sm"}`}
                  >
                    <div className="w-16 h-16 bg-slate-50 rounded-xl relative overflow-hidden flex items-center justify-center flex-shrink-0 border border-slate-100">
                      {p.image_url ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" /> : <span className="text-2xl opacity-20">📦</span>}
                      {outOfStock && (
                        <div className="absolute inset-0 bg-red-500/10 backdrop-blur-[1px] flex items-center justify-center">
                          <span className="bg-red-500 text-white text-[9px] font-bold px-1 py-0.5 rounded uppercase tracking-widest">Agotado</span>
                        </div>
                      )}
                      {hasVars && !outOfStock && (
                        <div className="absolute bottom-0 left-0 right-0 bg-violet-600/80 text-white text-[8px] font-black text-center py-0.5">VARIANTES</div>
                      )}
                    </div>
                    <div className="flex-1 px-4 flex flex-col justify-center">
                      <h3 className="font-bold text-sm leading-tight mb-1 text-slate-900">{p.name}</h3>
                      <div className="flex gap-3 text-xs text-slate-500 flex-wrap">
                        {!hasVars && p.barcode && <span>{p.barcode}</span>}
                        <span className={outOfStock ? "text-red-500 font-bold" : ""}>Stock: {totalStock}</span>
                        {hasVars && <span className="text-violet-500 font-bold">{pvs.length} variantes</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-emerald-500 font-black text-lg">${minPrice}{minPrice !== maxPrice ? `–$${maxPrice}` : ""}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* LADO DERECHO: CARRITO */}
      <div className="w-full lg:w-[400px] flex flex-col bg-white border-l border-slate-100 h-full">
        <div className="p-5 border-b border-slate-200 bg-white/80 backdrop-blur-md flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">🛒 Nueva Venta</h2>
          {cart.length > 0 && (
            confirmClearCart ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">¿Vaciar carrito?</span>
                <button
                  onClick={() => { setCart([]); setDiscount(0); setConfirmClearCart(false); }}
                  className="text-xs font-black px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-400 transition-colors"
                >Sí, vaciar</button>
                <button
                  onClick={() => setConfirmClearCart(false)}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                >No</button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmClearCart(true)}
                className="text-xs font-bold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-red-50 hover:text-red-500 transition-colors"
              >🗑 Vaciar</button>
            )
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          {cart.length === 0 ? (
            <div className="m-auto text-center opacity-40 flex flex-col items-center">
              <span className="text-6xl mb-4">🛒</span>
              <p className="text-lg font-medium">Tu carrito está vacío</p>
              <p className="text-sm mt-1">Busca o escanea productos</p>
            </div>
          ) : (
            cart.map(item => (
              <div key={item._cartKey} className="flex items-center gap-3 bg-slate-50 border border-slate-200 p-3 rounded-2xl">
                <div className="flex-1">
                  <p className="font-bold text-sm leading-tight">{item.name}</p>
                  <p className="text-emerald-400 text-sm font-semibold">${item.unit_price}</p>
                </div>
                <div className="flex items-center gap-3 bg-white rounded-xl p-1">
                  <button onClick={() => updateQuantity(item._cartKey, -1)} className="w-8 h-8 rounded-lg bg-slate-50 hover:bg-slate-100 flex items-center justify-center font-bold text-lg">-</button>
                  <span className="font-bold w-4 text-center">{item.quantity}</span>
                  <button onClick={() => updateQuantity(item._cartKey, 1)} className="w-8 h-8 rounded-lg bg-slate-50 hover:bg-slate-100 flex items-center justify-center font-bold text-lg">+</button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-5 bg-slate-50/40 border-t border-slate-200 mt-auto">
          {/* Cliente */}
          <div className="mb-4 relative">
            <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Asignar Cliente</label>
            <div className="relative">
              {selectedClient ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowClientCard(true)}
                    className="flex-1 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 transition-all text-left"
                  >
                    <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-600 font-black text-sm uppercase shrink-0">
                      {(selectedClient.name || selectedClient.instagram || "?").charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-emerald-600 truncate">
                        {selectedClient.instagram ? `@${selectedClient.instagram.replace(/^@/, "")}` : selectedClient.name}
                      </p>
                      {selectedClient.instagram && selectedClient.name && (
                        <p className="text-[10px] text-slate-400 truncate">{selectedClient.name}</p>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={() => { setSelectedClient(null); setClientSearchQuery(""); }}
                    className="w-9 h-9 flex items-center justify-center rounded-xl bg-slate-100 hover:bg-red-500/20 hover:text-red-500 text-slate-400 text-sm transition-colors shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <input
                  type="text"
                  placeholder="Buscar cliente por @instagram..."
                  value={clientSearchQuery}
                  onFocus={() => setShowClientDropdown(true)}
                  onChange={e => {
                    setClientSearchQuery(e.target.value);
                    setSelectedClient(null);
                    setShowClientDropdown(true);
                  }}
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-emerald-500 transition-all"
                />
              )}
            </div>
            
            {showClientDropdown && (
              <div className="absolute z-50 mt-2 w-full max-h-64 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-2xl">
                <button
                  onClick={() => { setShowClientDropdown(false); setShowNewClientModal(true); }}
                  className="w-full px-4 py-3 text-sm font-bold text-emerald-600 hover:bg-emerald-50 border-b border-slate-100 text-left transition-colors flex items-center gap-2"
                >
                  <span className="text-base">➕</span> Crear nuevo cliente
                </button>
                {clients.filter(c => {
                  const q = clientSearchQuery.toLowerCase().replace('@', '');
                  return (c.instagram && c.instagram.toLowerCase().includes(q)) || (c.name && c.name.toLowerCase().includes(q));
                }).length === 0 ? (
                  <div className="p-3 text-sm text-slate-500 text-center">Sin coincidencias</div>
                ) : (
                  clients
                    .filter(c => {
                      const q = clientSearchQuery.toLowerCase().replace('@', '');
                      return (c.instagram && c.instagram.toLowerCase().includes(q)) || (c.name && c.name.toLowerCase().includes(q));
                    })
                    .map(c => (
                      <button
                        key={c.id}
                        onClick={() => {
                          setSelectedClient(c);
                          setClientSearchQuery(c.instagram ? '@' + c.instagram.replace(/^@/, '') : c.name);
                          setShowClientDropdown(false);
                        }}
                        className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-100 last:border-0 text-sm transition-colors flex items-center justify-between"
                      >
                        <span className="font-semibold text-emerald-400">{c.instagram ? '@' + c.instagram.replace(/^@/, '') : c.name}</span>
                        <span className="text-xs opacity-50">{c.instagram ? c.name : ""}</span>
                      </button>
                    ))
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between mb-2">
            <span className="text-slate-500">Subtotal</span>
            <span className="font-medium">${subtotal.toFixed(2)}</span>
          </div>

          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="text-slate-500">Descuento</span>
              <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs font-bold">
                <button
                  onClick={() => { setDiscountType("$"); setDiscount(0); }}
                  className={`px-2 py-1 transition-colors ${discountType === "$" ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                >$</button>
                <button
                  onClick={() => { setDiscountType("%"); setDiscount(0); }}
                  className={`px-2 py-1 transition-colors ${discountType === "%" ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                >%</button>
              </div>
            </div>
            <div className="w-28 relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">{discountType}</span>
              <input
                type="number"
                min="0"
                max={discountType === "%" ? 100 : undefined}
                value={discount}
                onChange={e => setDiscount(Number(e.target.value) || 0)}
                className="w-full pl-6 pr-2 py-1.5 rounded-lg bg-slate-100 border border-transparent text-right focus:border-emerald-500 focus:outline-none text-sm"
              />
            </div>
          </div>
          {discountAmount > 0 && (
            <div className="flex items-center justify-between mb-2 -mt-2">
              <span className="text-xs text-emerald-600">Ahorro</span>
              <span className="text-xs font-bold text-emerald-600">-${discountAmount.toFixed(2)}</span>
            </div>
          )}

          <div className="flex items-center justify-between mb-6 pt-4 border-t border-slate-200">
            <span className="text-xl font-bold text-slate-900">Total</span>
            <span className="text-3xl font-black text-emerald-400">${total.toFixed(2)}</span>
          </div>

          <button 
            onClick={openCheckout}
            disabled={cart.length === 0}
            className="w-full py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-emerald-500/20 disabled:text-emerald-500/50 text-slate-900 font-bold text-lg shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
          >
            Siguiente →
          </button>
        </div>
      </div>

      {/* MODAL DE CHECKOUT */}
      {showCheckoutModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center bg-white z-10">
              <h2 className="text-lg font-bold text-slate-900">Método de Pago</h2>
              <button onClick={() => setShowCheckoutModal(false)} className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center transition-colors">✕</button>
            </div>
            
            <div className="p-6">
              <div className="flex items-center justify-center gap-4 mb-6">
                <button 
                  onClick={() => { setPaymentType("paid"); setDownPayment(total); }}
                  className={`flex-1 py-4 rounded-2xl border-2 transition-all font-bold ${paymentType === 'paid' ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                >
                  Pago Completo
                </button>
                <button 
                  onClick={() => setPaymentType("credit")}
                  className={`flex-1 py-4 rounded-2xl border-2 transition-all font-bold ${paymentType === 'credit' ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
                >
                  A Crédito
                </button>
              </div>

              {paymentType === 'credit' && !selectedClient && (
                <div className="p-4 mb-6 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  ⚠️ Debes cerrar esta ventana y <strong>asignar un cliente</strong> en el carrito antes de poder vender a crédito.
                </div>
              )}

              {paymentType === 'credit' && selectedClient && (
                <div className="mb-6 p-5 rounded-2xl bg-white border border-slate-100 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-amber-400 mb-2 uppercase tracking-wider">Monto de Apartado (Enganche)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 text-lg">$</span>
                      <input
                        type="number"
                        value={downPayment}
                        onChange={e => setDownPayment(Number(e.target.value) || 0)}
                        className="w-full pl-9 pr-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xl font-bold focus:outline-none focus:border-amber-500"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-amber-400 mb-2 uppercase tracking-wider">Días de plazo</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={creditDays}
                        onChange={e => setCreditDays(Number(e.target.value) || 15)}
                        className="w-24 px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 font-bold text-center focus:outline-none focus:border-amber-500"
                      />
                      <span className="text-sm text-slate-500">días — vence el <span className="font-bold text-slate-700">{new Date(Date.now() + creditDays * 86400000).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" })}</span></span>
                    </div>
                  </div>
                  <div className="border-t border-slate-100 pt-3 space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Total a pagar hoy:</span>
                      <span className="font-bold text-slate-900">${downPayment.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-slate-500">Restante a crédito:</span>
                      <span className="font-bold text-amber-400">${(total - downPayment).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              )}

              {paymentType === 'paid' && (
                <div className="mb-6 flex justify-between items-center p-5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                  <span className="text-slate-700 font-medium">Total a cobrar:</span>
                  <span className="text-3xl font-black text-emerald-400">${total.toFixed(2)}</span>
                </div>
              )}

              <button 
                onClick={executeCheckout}
                disabled={saving || (paymentType === 'credit' && !selectedClient)}
                className={`w-full py-4 rounded-2xl text-slate-900 font-bold text-lg shadow-lg transition-all active:scale-95 ${paymentType === 'paid' ? 'bg-emerald-500 hover:bg-emerald-400 shadow-emerald-500/20' : 'bg-amber-500 hover:bg-amber-400 shadow-amber-500/20 disabled:bg-amber-500/20 disabled:text-amber-500/50'}`}
              >
                {saving ? "Procesando..." : paymentType === 'paid' ? "Finalizar Cobro" : "Aprobar Crédito"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Tarjeta del cliente seleccionado */}
      {showClientCard && selectedClient && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => { setShowClientCard(false); setEditingBox(false); }}>
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm shadow-2xl animate-in fade-in zoom-in" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-slate-100 flex justify-between items-center">
              <h2 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Perfil del cliente</h2>
              <button onClick={() => { setShowClientCard(false); setEditingBox(false); }} className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-400">✕</button>
            </div>
            <div className="p-6">
              <div className="flex items-center gap-4 mb-5">
                <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-500 font-black text-2xl uppercase shrink-0">
                  {(selectedClient.name || selectedClient.instagram || "?").charAt(0)}
                </div>
                <div>
                  <p className="font-bold text-lg text-emerald-500 leading-tight">
                    {selectedClient.instagram ? `@${selectedClient.instagram.replace(/^@/, "")}` : selectedClient.name}
                  </p>
                  {selectedClient.instagram && selectedClient.name && (
                    <p className="text-sm text-slate-500">{selectedClient.name}</p>
                  )}
                  {selectedClient.phone && (
                    <p className="text-xs text-slate-400 mt-0.5">📱 {selectedClient.phone}</p>
                  )}
                </div>
              </div>
              <div className="mb-5 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cajas asignadas</p>
                  {!editingBox && (
                    <button
                      onClick={() => { setEditingBox(true); setBoxForm({ box_1: selectedClient.box_1 || "", box_2: selectedClient.box_2 || "" }); }}
                      className="text-[10px] font-black text-indigo-500 hover:text-indigo-700 underline underline-offset-2"
                    >
                      Editar
                    </button>
                  )}
                </div>
                {editingBox ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">Caja 1</label>
                        <input
                          type="text"
                          placeholder="Núm."
                          value={boxForm.box_1}
                          onChange={e => setBoxForm(f => ({ ...f, box_1: e.target.value }))}
                          className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] text-slate-400 mb-1">Caja 2</label>
                        <input
                          type="text"
                          placeholder="Núm."
                          value={boxForm.box_2}
                          onChange={e => setBoxForm(f => ({ ...f, box_2: e.target.value }))}
                          className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditingBox(false)} className="flex-1 py-1.5 rounded-lg border border-slate-200 text-slate-500 text-xs font-bold hover:bg-slate-100 transition-colors">Cancelar</button>
                      <button onClick={handleSaveBox} disabled={savingBox} className="flex-1 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-xs font-bold disabled:opacity-50 transition-colors">
                        {savingBox ? "Guardando…" : "Guardar"}
                      </button>
                    </div>
                  </div>
                ) : (selectedClient.box_1 || selectedClient.box_2) ? (
                  <div className="flex gap-2 flex-wrap">
                    {selectedClient.box_1 && <span className="px-2 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 text-xs font-bold rounded-lg">📦 Caja 1: {selectedClient.box_1}</span>}
                    {selectedClient.box_2 && <span className="px-2 py-1 bg-blue-500/10 border border-blue-500/20 text-blue-500 text-xs font-bold rounded-lg">📦 Caja 2: {selectedClient.box_2}</span>}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Sin caja asignada</p>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowClientCard(false); setSelectedClient(null); setClientSearchQuery(""); }}
                  className="flex-1 py-2.5 rounded-xl border border-red-200 text-red-400 text-sm font-bold hover:bg-red-50 transition-colors"
                >
                  Quitar cliente
                </button>
                <button
                  onClick={() => setShowClientCard(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-700 transition-colors"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Nuevo Cliente desde POS */}
      {showNewClientModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm shadow-2xl">
            <div className="p-5 border-b border-slate-200 flex justify-between items-center">
              <h2 className="text-lg font-bold">Nuevo Cliente</h2>
              <button
                onClick={() => { setShowNewClientModal(false); setNewClientForm({ name: "", instagram: "", phone: "", box_1: "", box_2: "" }); }}
                className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center"
              >✕</button>
            </div>
            <form onSubmit={handleCreateClient} className="p-6 space-y-4">
              <input
                required
                type="text"
                placeholder="Nombre completo *"
                value={newClientForm.name}
                onChange={e => setNewClientForm(f => ({ ...f, name: e.target.value }))}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-emerald-500 focus:outline-none"
              />
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium">@</span>
                <input
                  type="text"
                  placeholder="usuario_ig"
                  value={newClientForm.instagram.replace(/^@/, '')}
                  onChange={e => setNewClientForm(f => ({ ...f, instagram: e.target.value.replace(/^@/, '') }))}
                  className="w-full pl-8 pr-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <input
                type="tel"
                placeholder="Teléfono"
                value={newClientForm.phone}
                onChange={e => setNewClientForm(f => ({ ...f, phone: e.target.value }))}
                className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-emerald-500 focus:outline-none"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Caja 1</label>
                  <input
                    type="text"
                    placeholder="Núm. Caja"
                    value={newClientForm.box_1}
                    onChange={e => setNewClientForm(f => ({ ...f, box_1: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-1">Caja 2</label>
                  <input
                    type="text"
                    placeholder="Núm. Caja"
                    value={newClientForm.box_2}
                    onChange={e => setNewClientForm(f => ({ ...f, box_2: e.target.value }))}
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={savingNewClient || !newClientForm.name}
                className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-all active:scale-95"
              >
                {savingNewClient ? "Guardando…" : "Guardar"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── Variant Picker ── */}
      {variantPicker && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900">Seleccionar variante</h3>
                <p className="text-xs text-slate-400 mt-0.5">{variantPicker.name}</p>
              </div>
              <button onClick={() => setVariantPicker(null)} className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">✕</button>
            </div>
            <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
              {(variantPicker.product_variants || []).map(v => {
                const outOfStock = v.stock <= 0;
                return (
                  <button
                    key={v.id}
                    onClick={() => addVariantDirectly(variantPicker, v)}
                    disabled={outOfStock}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all ${outOfStock ? "bg-slate-50 border-slate-100 opacity-40 cursor-not-allowed" : "bg-white border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 active:scale-[0.99]"}`}
                  >
                    {v.image_url ? (
                      <img src={v.image_url} alt={v.name} className="w-10 h-10 rounded-xl object-cover shrink-0 border border-slate-200" />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-slate-100 shrink-0 flex items-center justify-center text-lg opacity-30">📦</div>
                    )}
                    <span className="font-bold text-slate-900 flex-1 text-left">{v.name}</span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`text-xs font-bold ${outOfStock ? "text-red-400" : "text-slate-400"}`}>
                        {outOfStock ? "Sin stock" : `${v.stock} disp.`}
                      </span>
                      <span className="font-black text-emerald-600 text-base">${v.price}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
