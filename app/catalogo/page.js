"use client";
import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function CatalogoPage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profile, setProfile] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("Todas");
  
  // Carrito: { id: { ...product, quantity } }
  const [cart, setCart] = useState({});
  const [showCart, setShowCart] = useState(false);
  const [activeImgIdx, setActiveImgIdx] = useState({});
  
  // Checkout form
  const [clientData, setClientData] = useState({ name: "", phone: "", instagram: "" });
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    fetchProducts();
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session);
      if (session) {
        fetch("/api/clients/me", { cache: "no-store" })
          .then(res => res.json())
          .then(data => {
            if (data.client) setProfile(data.client);
          });
      }
    });
  }, []);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/public/catalog");
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

  const categories = useMemo(() => {
    const cats = products.map(p => p.category).filter(Boolean);
    return ["Todas", ...Array.from(new Set(cats)).sort()];
  }, [products]);

  const filteredProducts = useMemo(() => {
    if (activeCategory === "Todas") return products;
    return products.filter(p => p.category === activeCategory);
  }, [products, activeCategory]);

  const addToCart = (product) => {
    setCart(prev => {
      const current = prev[product.id] || { ...product, quantity: 0 };
      if (current.quantity >= product.stock) return prev; // No exceder stock
      return { ...prev, [product.id]: { ...current, quantity: current.quantity + 1 } };
    });
  };

  const removeFromCart = (productId) => {
    setCart(prev => {
      const newCart = { ...prev };
      if (newCart[productId]) {
        newCart[productId].quantity -= 1;
        if (newCart[productId].quantity <= 0) delete newCart[productId];
      }
      return newCart;
    });
  };

  const cartItems = Object.values(cart);
  const cartTotal = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  const handleCheckout = async (e) => {
    e.preventDefault();
    if (cartItems.length === 0) return;
    setProcessing(true);
    setErrorMsg("");

    try {
      const payload = {
        cart: cartItems.map(i => ({ id: i.id, quantity: i.quantity })),
        clientData: profile ? {
          name: profile.name,
          phone: profile.phone,
          instagram: profile.instagram
        } : clientData
      };

      const res = await fetch("/api/public/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        setSuccess(true);
        setCart({});
      } else {
        const data = await res.json();
        setErrorMsg(data.message || "Ocurrió un error al procesar el pedido.");
      }
    } catch (e) {
      setErrorMsg("Error de conexión. Intenta de nuevo.");
    } finally {
      setProcessing(false);
    }
  };

  if (success) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 md:p-12 rounded-3xl shadow-xl max-w-md w-full text-center border border-slate-100 animate-in fade-in zoom-in">
          <div className="w-20 h-20 bg-sky-100 text-sky-500 rounded-full flex items-center justify-center text-4xl mx-auto mb-6">
            ✓
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-4">¡Pedido Recibido!</h1>
          <p className="text-slate-600 mb-8 leading-relaxed">
            Gracias por tu compra. Te estaremos contactando para completar tu pago y coordinar la entrega.
          </p>
          <Link href="/" className="inline-block bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-6 py-3 rounded-xl transition-colors">
            Volver al Inicio
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-24">
      {/* HEADER */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="font-black text-xl text-slate-900 tracking-tight flex items-center gap-2">
            <span className="text-sm">←</span> AGÉNDALO
          </Link>
          <div className="flex items-center gap-3">
            <Link href={isLoggedIn ? "/perfil" : "/login"} className="hidden sm:flex items-center gap-2 bg-slate-100 text-slate-700 hover:bg-slate-200 px-4 py-2 rounded-full font-bold text-sm transition-all">
              <span>👤</span> {profile ? profile.instagram : (isLoggedIn ? "Mi Cuenta" : "Iniciar Sesión")}
            </Link>
            
            {cartCount > 0 && (
              <button 
                onClick={() => setShowCart(true)}
                className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-full font-bold text-sm hover:bg-slate-800 transition-all shadow-lg active:scale-95"
              >
                <span>🛒</span>
                <span>{cartCount}</span>
              </button>
            )}
          </div>
        </div>
        
      {/* CATEGORÍAS TIPO PILL MODERNAS */}
      <div className="bg-white border-b border-slate-100 sticky top-16 z-20 shadow-sm overflow-x-auto whitespace-nowrap hide-scrollbar px-4 py-3 flex gap-2">
        {categories.map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-6 py-2 rounded-2xl text-xs font-black transition-all border-2 ${
              activeCategory === cat 
                ? 'bg-sky-500 border-sky-500 text-white shadow-lg shadow-sky-500/20 scale-105'
                : 'bg-slate-50 border-transparent text-slate-500 hover:bg-slate-100'
            }`}
          >
            {cat.toUpperCase()}
          </button>
        ))}
      </div>
    </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-12 h-12 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Cargando tesoros...</p>
          </div>
        ) : filteredProducts.length === 0 ? (
          <div className="text-center py-20">
            <span className="text-5xl block mb-4">🔍</span>
            <p className="text-sm font-bold text-slate-400 uppercase tracking-widest">Sin resultados en esta sección</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {filteredProducts.map(product => {
              const inCart = cart[product.id]?.quantity || 0;
              return (
                <div key={product.id} className="group bg-white rounded-[2.5rem] p-3 border-2 border-slate-100 hover:border-sky-500/30 transition-all duration-300 flex flex-col relative">
                  {(() => {
                    const allImgs = [product.image_url, ...(product.images || [])].filter(Boolean);
                    const idx = activeImgIdx[product.id] || 0;
                    return (
                      <div
                        className="aspect-[4/5] rounded-[2rem] overflow-hidden bg-slate-50 relative mb-4 cursor-pointer"
                        onClick={() => allImgs.length > 1 && setActiveImgIdx(prev => ({ ...prev, [product.id]: (idx + 1) % allImgs.length }))}
                      >
                        {allImgs.length > 0 ? (
                          <img src={allImgs[idx]} alt={product.name} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-4xl opacity-10">🛍️</div>
                        )}
                        {product.stock <= 5 && (
                          <div className="absolute top-3 left-3 bg-red-500 text-white text-[9px] font-black px-2 py-1 rounded-lg shadow-lg animate-pulse">
                            ¡ÚLTIMOS {product.stock}!
                          </div>
                        )}
                        {allImgs.length > 1 && (
                          <div className="absolute bottom-2.5 left-0 right-0 flex justify-center gap-1.5">
                            {allImgs.map((_, i) => (
                              <div key={i} className={`w-1.5 h-1.5 rounded-full transition-all ${i === idx ? "bg-white scale-125" : "bg-white/50"}`} />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  
                  <div className="px-2 flex flex-col flex-1">
                    <p className="text-[9px] font-black text-sky-500 uppercase tracking-widest mb-1">{product.category || 'Varios'}</p>
                    <h3 className="font-bold text-sm text-slate-900 leading-tight mb-2 line-clamp-2 min-h-[2.5rem]">{product.name}</h3>
                    
                    <div className="flex items-center justify-between mt-auto pt-2">
                      <p className="font-black text-slate-900 text-lg">${product.price}</p>
                      
                      {inCart > 0 ? (
                        <div className="flex items-center bg-slate-900 rounded-2xl p-1 gap-2 shadow-lg">
                          <button onClick={() => removeFromCart(product.id)} className="w-8 h-8 rounded-xl bg-white/10 text-white font-black hover:bg-white/20 transition-colors">-</button>
                          <span className="font-black text-white text-sm px-1">{inCart}</span>
                          <button onClick={() => addToCart(product)} disabled={inCart >= product.stock} className="w-8 h-8 rounded-xl bg-white/10 text-white font-black hover:bg-white/20 transition-colors disabled:opacity-30">+</button>
                        </div>
                      ) : (
                        <button 
                          onClick={() => addToCart(product)}
                          className="w-10 h-10 rounded-2xl bg-sky-500 text-white flex items-center justify-center shadow-lg shadow-sky-500/20 hover:scale-110 active:scale-90 transition-all"
                        >
                          <span className="text-xl font-bold">+</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL DEL CARRITO Y CHECKOUT */}
      {showCart && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex justify-end">
          <div className="bg-white w-full max-w-md h-full flex flex-col animate-in slide-in-from-right duration-300">
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-white">
              <h2 className="text-xl font-black text-slate-900">Tu Pedido</h2>
              <button onClick={() => setShowCart(false)} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-5">
              {cartItems.length === 0 ? (
                <div className="text-center py-20 opacity-50">El carrito está vacío</div>
              ) : (
                <div className="space-y-4 mb-8">
                  {cartItems.map(item => (
                    <div key={item.id} className="flex gap-4">
                      {item.image_url ? (
                        <img src={item.image_url} alt={item.name} className="w-16 h-16 rounded-xl object-cover border border-slate-200" />
                      ) : (
                        <div className="w-16 h-16 rounded-xl bg-slate-100 border border-slate-200" />
                      )}
                      <div className="flex-1">
                        <h4 className="font-bold text-sm text-slate-900 line-clamp-1">{item.name}</h4>
                        <p className="text-sky-500 font-bold text-sm mb-2">${item.price}</p>
                        <div className="flex items-center gap-3">
                          <button onClick={() => removeFromCart(item.id)} className="w-6 h-6 rounded-md bg-slate-100 text-slate-600 font-bold flex items-center justify-center">-</button>
                          <span className="text-sm font-bold">{item.quantity}</span>
                          <button onClick={() => addToCart(item)} disabled={item.quantity >= item.stock} className="w-6 h-6 rounded-md bg-slate-100 text-slate-600 font-bold flex items-center justify-center disabled:opacity-50">+</button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="pt-4 border-t border-slate-200 flex justify-between items-center mt-6">
                    <span className="font-bold text-slate-500 uppercase tracking-widest text-xs">Total</span>
                    <span className="font-black text-2xl text-slate-900">${cartTotal.toFixed(2)}</span>
                  </div>
                </div>
              )}

              {cartItems.length > 0 && (
                <form onSubmit={handleCheckout} className="space-y-4 bg-slate-50 p-5 rounded-2xl border border-slate-200">
                  <h3 className="font-bold text-sm text-slate-900 uppercase tracking-widest mb-4">Tus Datos</h3>
                  
                  {errorMsg && (
                    <div className="p-3 rounded-lg bg-red-50 text-red-500 text-xs font-bold border border-red-200">
                      {errorMsg}
                    </div>
                  )}

                  {!profile ? (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">Nombre Completo *</label>
                        <input required type="text" value={clientData.name} onChange={e => setClientData({...clientData, name: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500" placeholder="Ej. Ana Pérez" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">Teléfono (WhatsApp) *</label>
                        <input required type="tel" value={clientData.phone} onChange={e => setClientData({...clientData, phone: e.target.value})} className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500" placeholder="Ej. 8710000000" />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">Usuario de Instagram *</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium">@</span>
                          <input required type="text" value={clientData.instagram.replace(/^@/, '')} onChange={e => setClientData({...clientData, instagram: e.target.value.replace(/^@/, '')})} className="w-full pl-8 pr-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500" placeholder="usuario_ig" />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
                      <p className="text-xs text-slate-500 font-bold uppercase tracking-widest">Confirmando como:</p>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-sky-500/10 flex items-center justify-center text-sky-600 font-bold uppercase">
                          {profile.name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900">{profile.name}</p>
                          <p className="text-xs text-sky-600 font-medium">{profile.instagram}</p>
                        </div>
                      </div>
                      <p className="text-[10px] text-slate-400 pt-1">Tus datos se guardarán automáticamente con este pedido.</p>
                    </div>
                  )}

                  <button 
                    type="submit" 
                    disabled={processing}
                    className="w-full py-3.5 mt-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-900 font-black shadow-lg shadow-sky-500/30 transition-all disabled:opacity-50 active:scale-95"
                  >
                    {processing ? "Procesando..." : "Confirmar Pedido"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}

      {/* BOTÓN FLOTANTE MÓVIL SI HAY ITEMS */}
      {cartCount > 0 && !showCart && (
        <div className="fixed bottom-6 left-0 right-0 px-4 md:hidden z-40">
          <button 
            onClick={() => setShowCart(true)}
            className="w-full bg-slate-900 text-white p-4 rounded-2xl font-black shadow-2xl flex items-center justify-between active:scale-95 transition-transform"
          >
            <span className="flex items-center gap-2">
              <span className="bg-white/20 px-2 py-0.5 rounded-md text-sm">{cartCount}</span>
              Ver Pedido
            </span>
            <span>${cartTotal.toFixed(2)}</span>
          </button>
        </div>
      )}

      {/* ESTILOS EXTRA PARA OCULTAR SCROLLBAR */}
      <style dangerouslySetInnerHTML={{__html: `
        .hide-scrollbar::-webkit-scrollbar { display: none; }
        .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}} />
    </main>
  );
}
