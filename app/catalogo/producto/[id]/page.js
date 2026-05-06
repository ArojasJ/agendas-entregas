"use client";
import { useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useCart } from "../../CartProvider";

export default function ProductoPage() {
  const { id } = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { addToCart, cartCount, setShowCart } = useCart();

  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeImg, setActiveImg] = useState(0);
  const [selectedVariant, setSelectedVariant] = useState(null);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    fetch("/api/public/catalog")
      .then(r => r.json())
      .then(d => {
        const p = (d.products || []).find(x => String(x.id) === String(id));
        if (p) {
          setProduct(p);
          const vId = searchParams.get("v");
          if (vId) {
            const v = (p.product_variants || []).find(x => String(x.id) === vId);
            if (v) setSelectedVariant(v);
          }
        }
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Reset active image when variant changes
  useEffect(() => { setActiveImg(0); }, [selectedVariant]);

  if (loading) {
    return (
      <main className="min-h-screen bg-white">
        <div className="h-14 bg-white border-b border-slate-100 sticky top-0 z-20" />
        <div className="aspect-square bg-slate-100 animate-pulse" />
        <div className="p-5 space-y-4">
          <div className="h-6 bg-slate-100 animate-pulse rounded-xl w-3/4" />
          <div className="h-8 bg-slate-100 animate-pulse rounded-xl w-1/3" />
          <div className="h-20 bg-slate-100 animate-pulse rounded-xl" />
        </div>
      </main>
    );
  }

  if (!product) {
    return (
      <main className="min-h-screen bg-white flex flex-col items-center justify-center text-slate-400 gap-4 p-8">
        <span className="text-6xl">🔍</span>
        <p className="font-bold text-lg">Producto no encontrado</p>
        <button onClick={() => router.back()} className="text-sm underline underline-offset-2">Volver</button>
      </main>
    );
  }

  const pvs = product.product_variants || [];
  const hasVariants = pvs.length > 0;

  // Build image gallery
  const varImgs = selectedVariant
    ? [selectedVariant.image_url, ...(selectedVariant.images || [])].filter(Boolean)
    : [];
  const prodImgs = [product.image_url, ...(product.images || [])].filter(Boolean);
  const allImages = varImgs.length > 0
    ? [...varImgs, ...prodImgs.filter(i => !varImgs.includes(i))]
    : prodImgs;

  const displayPrice = selectedVariant ? selectedVariant.price : product.price;
  const displayStock = selectedVariant ? selectedVariant.stock : product.stock;
  const outOfStock = displayStock <= 0;
  const needsVariant = hasVariants && !selectedVariant;

  const handleAdd = () => {
    if (outOfStock || needsVariant) return;
    addToCart({
      _cartKey: selectedVariant ? `${product.id}_${selectedVariant.id}` : String(product.id),
      id: product.id,
      variant_id: selectedVariant?.id || null,
      name: selectedVariant ? `${product.name} — ${selectedVariant.name}` : product.name,
      price: displayPrice,
      stock: displayStock,
      image_url: allImages[0] || null,
    });
    setAdded(true);
    setTimeout(() => setAdded(false), 2000);
  };

  return (
    <main className="min-h-screen bg-white pb-28">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 hover:bg-slate-200 transition-colors shrink-0 text-lg"
          >
            ←
          </button>
          <p className="font-bold text-slate-900 text-sm flex-1 truncate">{product.name}</p>
          {cartCount > 0 && (
            <button
              onClick={() => setShowCart(true)}
              className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-full font-bold text-sm shrink-0 hover:bg-slate-800 transition-colors"
            >
              🛒 {cartCount}
            </button>
          )}
        </div>
      </header>

      {/* Main Image */}
      <div className="aspect-square bg-slate-50 relative overflow-hidden max-w-2xl mx-auto">
        {allImages.length > 0 ? (
          <img
            src={allImages[activeImg] || allImages[0]}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-8xl opacity-10">📦</div>
        )}
        {outOfStock && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <span className="bg-red-500 text-white font-black px-5 py-2.5 rounded-2xl text-base">Agotado</span>
          </div>
        )}
      </div>

      {/* Thumbnails */}
      {allImages.length > 1 && (
        <div className="flex gap-2 px-4 py-3 max-w-2xl mx-auto overflow-x-auto hide-scrollbar">
          {allImages.map((img, i) => (
            <button
              key={i}
              onClick={() => setActiveImg(i)}
              className={`w-16 h-16 rounded-xl overflow-hidden shrink-0 border-2 transition-all ${
                activeImg === i
                  ? "border-slate-900 opacity-100 shadow-md"
                  : "border-transparent opacity-50 hover:opacity-80"
              }`}
            >
              <img src={img} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Product Info */}
      <div className="max-w-2xl mx-auto px-5 py-4 space-y-6">
        {/* Name & Price */}
        <div>
          <h1 className="font-black text-2xl text-slate-900 leading-tight">{product.name}</h1>
          {!hasVariants || selectedVariant ? (
            <p className="text-3xl font-black text-emerald-500 mt-2">${displayPrice}</p>
          ) : (
            <p className="text-slate-400 font-bold mt-2 text-base">Selecciona una variante para ver el precio</p>
          )}
        </div>

        {/* Variants */}
        {hasVariants && (
          <div>
            <p className="font-bold text-xs text-slate-500 uppercase tracking-widest mb-3">
              {pvs[0]?.option_type || "Variante"} — {selectedVariant ? selectedVariant.name : "Elige una opción"}
            </p>
            <div className="flex flex-wrap gap-2">
              {pvs.map(v => {
                const isSelected = selectedVariant?.id === v.id;
                const noStock = v.stock <= 0;
                return (
                  <button
                    key={v.id}
                    onClick={() => !noStock && setSelectedVariant(v)}
                    disabled={noStock}
                    className={`px-4 py-2.5 rounded-xl border-2 font-bold text-sm transition-all active:scale-95 ${
                      isSelected
                        ? "border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-900/20"
                        : noStock
                        ? "border-slate-100 text-slate-300 cursor-not-allowed line-through"
                        : "border-slate-200 text-slate-700 hover:border-slate-400 hover:bg-slate-50"
                    }`}
                  >
                    {v.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Description */}
        {product.description && (
          <div>
            <p className="font-bold text-xs text-slate-500 uppercase tracking-widest mb-2">Descripción</p>
            <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-line">{product.description}</p>
          </div>
        )}

        {/* Category badge */}
        {product.category && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-semibold">Categoría</span>
            <a
              href={`/catalogo/${encodeURIComponent(product.category)}`}
              className="text-xs font-bold text-slate-600 bg-slate-100 px-3 py-1 rounded-full hover:bg-slate-200 transition-colors"
            >
              {product.category}
            </a>
          </div>
        )}
      </div>

      {/* ── Bottom CTA ── */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white/90 backdrop-blur-md border-t border-slate-100 z-30">
        <div className="max-w-2xl mx-auto flex gap-3">
          {needsVariant ? (
            <div className="flex-1 py-4 rounded-2xl bg-slate-100 text-slate-400 font-bold text-center text-sm">
              Selecciona una opción
            </div>
          ) : (
            <button
              onClick={handleAdd}
              disabled={outOfStock}
              className={`flex-1 py-4 rounded-2xl font-black text-base transition-all active:scale-95 ${
                added
                  ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                  : outOfStock
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                  : "bg-slate-900 text-white hover:bg-slate-800 shadow-lg shadow-slate-900/20"
              }`}
            >
              {added ? "✓ Agregado al carrito" : outOfStock ? "Sin stock" : "Agregar al carrito"}
            </button>
          )}
          {cartCount > 0 && (
            <button
              onClick={() => setShowCart(true)}
              className="px-5 py-4 rounded-2xl bg-emerald-500 text-white font-black text-sm hover:bg-emerald-400 transition-all active:scale-95 shadow-lg shadow-emerald-500/20"
            >
              🛒 {cartCount}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
