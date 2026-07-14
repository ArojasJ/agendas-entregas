"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useCart } from "../CartProvider";

export default function CategoryPage() {
  const { categoria } = useParams();
  const router = useRouter();
  const { cartCount, setShowCart } = useCart();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const categoryName = decodeURIComponent(categoria);

  useEffect(() => {
    fetch("/api/public/catalog")
      .then(r => r.json())
      .then(d => {
        const filtered = (d.products || []).filter(p => p.category === categoryName);
        // Flatten: variants become individual cards
        const flat = filtered.flatMap(p => {
          const pvs = (p.product_variants || []).filter(v => v.stock > 0);
          if (pvs.length === 0) {
            if (p.stock <= 0) return [];
            return [{
              _cartKey: String(p.id),
              id: p.id, variant_id: null,
              name: p.name, price: p.price, stock: p.stock,
              image_url: p.image_url, images: p.images || [],
              description: p.description,
              href: `/catalogo/producto/${p.id}`,
            }];
          }
          return pvs.map(v => {
            const imgs = [v.image_url, ...(v.images || []), p.image_url, ...(p.images || [])].filter(Boolean);
            return {
              _cartKey: `${p.id}_${v.id}`,
              id: p.id, variant_id: v.id,
              name: p.name, variantName: v.name,
              price: v.price, stock: v.stock,
              image_url: imgs[0] || null,
              href: `/catalogo/producto/${p.id}?v=${v.id}`,
            };
          });
        });
        setItems(flat);
      })
      .finally(() => setLoading(false));
  }, [categoryName]);

  return (
    <main className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-slate-100" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200 transition-colors shrink-0 text-lg"
          >
            ←
          </button>
          <h1 className="font-black text-slate-900 flex-1 truncate text-base uppercase tracking-wide">
            {categoryName}
          </h1>
          {cartCount > 0 && (
            <button
              onClick={() => setShowCart(true)}
              className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-full font-bold text-sm shrink-0 hover:bg-slate-800 transition-colors active:scale-95"
            >
              🛒 {cartCount}
            </button>
          )}
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-5 pb-24">
        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1,2,3,4,5,6].map(i => (
              <div key={i} className="rounded-2xl overflow-hidden">
                <div className="aspect-square bg-slate-100 animate-pulse" />
                <div className="pt-2 space-y-1.5">
                  <div className="h-3 bg-slate-100 animate-pulse rounded w-3/4" />
                  <div className="h-4 bg-slate-100 animate-pulse rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-20 text-slate-400">
            <p className="text-5xl mb-4">📭</p>
            <p className="font-bold text-lg">Sin productos disponibles</p>
            <button onClick={() => router.back()} className="mt-4 text-sm underline underline-offset-2">
              Volver al catálogo
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-6">
            {items.map(item => (
              <Link
                key={item._cartKey}
                href={item.href}
                className="group"
              >
                {/* Image */}
                <div className="aspect-square rounded-2xl overflow-hidden bg-slate-50 mb-2.5 shadow-sm">
                  {item.image_url ? (
                    <img
                      src={item.image_url}
                      alt={item.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-5xl opacity-15">📦</div>
                  )}
                </div>
                {/* Info */}
                <div className="px-1">
                  <p className="font-bold text-sm text-slate-900 leading-tight line-clamp-2">{item.name}</p>
                  {item.variantName && (
                    <p className="text-xs text-slate-400 mt-0.5">{item.variantName}</p>
                  )}
                  <div className="flex items-center justify-between mt-1.5">
                    <p className="font-black text-base text-emerald-600">${item.price}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Floating cart */}
      {cartCount > 0 && (
        <div className="fixed bottom-6 left-0 right-0 flex justify-center z-30 pointer-events-none">
          <button
            onClick={() => setShowCart(true)}
            className="pointer-events-auto flex items-center gap-3 bg-slate-900 text-white px-6 py-4 rounded-full shadow-2xl shadow-slate-900/30 font-bold text-sm hover:bg-slate-800 active:scale-95 transition-all"
          >
            🛒 Ver carrito · <span className="font-black">{cartCount}</span>
          </button>
        </div>
      )}
    </main>
  );
}
