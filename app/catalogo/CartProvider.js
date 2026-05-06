"use client";
import { createContext, useContext, useState, useEffect } from "react";

const CartContext = createContext(null);
const CART_KEY = "noreste_cart_v2";

export function CartProvider({ children }) {
  const [cart, setCart] = useState({});
  const [showCart, setShowCart] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [clientData, setClientData] = useState({ name: "", phone: "", instagram: "" });
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(CART_KEY);
      if (saved) setCart(JSON.parse(saved));
    } catch {}

    import("@/lib/supabase/client").then(({ createClient }) => {
      const supabase = createClient();
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          fetch("/api/clients/me", { cache: "no-store" })
            .then(r => r.json())
            .then(d => { if (d.client) setProfile(d.client); });
        }
      });
    });
  }, []);

  const persist = (newCart) => {
    try { localStorage.setItem(CART_KEY, JSON.stringify(newCart)); } catch {}
  };

  const addToCart = (item) => {
    setCart(prev => {
      const key = item._cartKey;
      const current = prev[key] || { ...item, quantity: 0 };
      if (current.quantity >= item.stock) return prev;
      const updated = { ...prev, [key]: { ...current, quantity: current.quantity + 1 } };
      persist(updated);
      return updated;
    });
  };

  const removeOne = (cartKey) => {
    setCart(prev => {
      const next = { ...prev };
      if (!next[cartKey]) return prev;
      next[cartKey] = { ...next[cartKey], quantity: next[cartKey].quantity - 1 };
      if (next[cartKey].quantity <= 0) delete next[cartKey];
      persist(next);
      return next;
    });
  };

  const clearCart = () => {
    setCart({});
    try { localStorage.removeItem(CART_KEY); } catch {}
  };

  const cartItems = Object.values(cart);
  const cartCount = cartItems.reduce((sum, i) => sum + i.quantity, 0);
  const cartTotal = cartItems.reduce((sum, i) => sum + (i.price * i.quantity), 0);

  const handleCheckout = async (e) => {
    e.preventDefault();
    if (cartItems.length === 0) return;
    setProcessing(true);
    setErrorMsg("");
    try {
      const payload = {
        cart: cartItems.map(i => ({ id: i.id, variant_id: i.variant_id || null, quantity: i.quantity })),
        clientData: profile
          ? { name: profile.name, phone: profile.phone, instagram: profile.instagram }
          : clientData,
      };
      const res = await fetch("/api/public/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setSuccess(true);
        clearCart();
      } else {
        const data = await res.json();
        setErrorMsg(data.message || "Error al procesar el pedido.");
      }
    } catch {
      setErrorMsg("Error de conexión. Intenta de nuevo.");
    } finally {
      setProcessing(false);
    }
  };

  const closeCart = () => {
    setShowCart(false);
    setSuccess(false);
    setErrorMsg("");
  };

  return (
    <CartContext.Provider value={{ cart, cartItems, cartCount, cartTotal, addToCart, removeOne, clearCart, showCart, setShowCart }}>
      {children}

      {/* ── Cart Sidebar ── */}
      {showCart && (
        <div className="fixed inset-0 z-[60] flex">
          <div className="flex-1 bg-black/40 backdrop-blur-sm" onClick={closeCart} />
          <div className="w-full max-w-sm bg-white flex flex-col shadow-2xl h-full animate-in slide-in-from-right duration-200">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h2 className="font-black text-lg text-slate-900">Tu pedido</h2>
              <button onClick={closeCart} className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors">✕</button>
            </div>

            {success ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-4">
                <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center text-4xl">✓</div>
                <h3 className="font-black text-xl text-slate-900">¡Pedido Recibido!</h3>
                <p className="text-slate-500 text-sm leading-relaxed max-w-xs">Gracias por tu compra. Te contactaremos para coordinar el pago y la entrega.</p>
                <button onClick={closeCart} className="mt-2 bg-slate-900 text-white font-bold px-6 py-3 rounded-2xl hover:bg-slate-800 transition-colors active:scale-95">
                  Seguir comprando
                </button>
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                  {cartItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-3">
                      <span className="text-5xl">🛒</span>
                      <p className="font-bold">Tu carrito está vacío</p>
                      <button onClick={closeCart} className="text-sm text-slate-500 underline underline-offset-2">Explorar productos</button>
                    </div>
                  ) : cartItems.map(item => (
                    <div key={item._cartKey} className="flex items-center gap-3 bg-slate-50 rounded-2xl p-3">
                      {item.image_url && (
                        <img src={item.image_url} alt={item.name} className="w-14 h-14 rounded-xl object-cover shrink-0 border border-slate-100" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm leading-tight text-slate-900 truncate">{item.name}</p>
                        <p className="text-slate-400 text-xs mt-0.5">${item.price} c/u</p>
                      </div>
                      <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200 p-1 shrink-0">
                        <button onClick={() => removeOne(item._cartKey)} className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center font-bold text-slate-600 hover:bg-slate-200 transition-colors">−</button>
                        <span className="font-black text-sm w-5 text-center text-slate-900">{item.quantity}</span>
                        <button onClick={() => addToCart(item)} className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center font-bold text-slate-600 hover:bg-slate-200 transition-colors">+</button>
                      </div>
                    </div>
                  ))}
                </div>

                {cartItems.length > 0 && (
                  <form onSubmit={handleCheckout} className="p-5 border-t border-slate-100 space-y-3 shrink-0">
                    <div className="flex justify-between items-center mb-1">
                      <span className="font-bold text-slate-600">Total estimado</span>
                      <span className="font-black text-2xl text-slate-900">${cartTotal.toFixed(2)}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 -mt-1 mb-2">El precio final se confirma al coordinar la entrega.</p>

                    {profile ? (
                      <div className="px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-2xl text-sm text-emerald-700 font-semibold">
                        Pedido como {profile.instagram ? `@${profile.instagram}` : profile.name}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <input
                          required
                          type="text"
                          placeholder="Tu nombre *"
                          value={clientData.name}
                          onChange={e => setClientData(p => ({ ...p, name: e.target.value }))}
                          className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-slate-400 focus:outline-none"
                        />
                        <input
                          type="tel"
                          placeholder="WhatsApp"
                          value={clientData.phone}
                          onChange={e => setClientData(p => ({ ...p, phone: e.target.value }))}
                          className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-slate-400 focus:outline-none"
                        />
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">@</span>
                          <input
                            type="text"
                            placeholder="instagram (opcional)"
                            value={clientData.instagram}
                            onChange={e => setClientData(p => ({ ...p, instagram: e.target.value.replace(/^@/, "") }))}
                            className="w-full pl-8 pr-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-slate-400 focus:outline-none"
                          />
                        </div>
                      </div>
                    )}

                    {errorMsg && <p className="text-red-500 text-xs font-medium">{errorMsg}</p>}

                    <button
                      type="submit"
                      disabled={processing}
                      className="w-full py-4 rounded-2xl bg-slate-900 text-white font-black text-base hover:bg-slate-800 disabled:opacity-60 transition-all active:scale-95 shadow-lg shadow-slate-900/20"
                    >
                      {processing ? "Enviando pedido..." : "Confirmar Pedido →"}
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart debe usarse dentro de CartProvider");
  return ctx;
}
