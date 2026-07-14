"use client";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useCart } from "./CartProvider";

function getDisplayPrice(p) {
  if (p.product_variants && p.product_variants.length > 0) {
    const prices = p.product_variants
      .filter(v => v.stock > 0)
      .map(v => Number(v.price))
      .filter(x => x > 0);
    if (prices.length === 0) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    return min === max ? `$${min}` : `$${min} – $${max}`;
  }
  return p.price > 0 ? `$${p.price}` : null;
}

const GRADIENTS = [
  "from-rose-300 to-pink-500",
  "from-violet-300 to-purple-500",
  "from-amber-300 to-orange-500",
  "from-emerald-300 to-teal-500",
  "from-sky-300 to-blue-500",
  "from-red-300 to-rose-500",
  "from-lime-300 to-green-500",
  "from-fuchsia-300 to-purple-500",
];

const BANNER_BG = {
  emerald: "bg-emerald-500",
  rose:    "bg-rose-500",
  amber:   "bg-amber-400",
  sky:     "bg-sky-500",
  violet:  "bg-violet-500",
};

export default function CatalogoPage() {
  const { cartCount, setShowCart } = useCart();

  const [settings,    setSettings]    = useState(null);
  const [categories,  setCategories]  = useState([]);
  const [featured,    setFeatured]    = useState([]);
  const [loading,     setLoading]     = useState(true);

  const [search,       setSearch]       = useState("");
  const [allProducts,  setAllProducts]  = useState([]);
  const [prodsLoaded,  setProdsLoaded]  = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/public/catalog-settings").then(r => r.json()),
      fetch("/api/public/categories").then(r => r.json()),
    ]).then(async ([sd, cd]) => {
      const s = sd.settings || {};
      setSettings(s);
      setCategories(cd.categories || []);

      // Load featured products if any
      const ids = (() => { try { return JSON.parse(s.featured_product_ids || "[]"); } catch { return []; } })();
      if (ids.length > 0) {
        const pd = await fetch("/api/public/catalog").then(r => r.json());
        const allP = pd.products || [];
        setAllProducts(allP);
        setProdsLoaded(true);
        setFeatured(ids.map(id => allP.find(p => p.id === id)).filter(Boolean));
      }
    }).finally(() => setLoading(false));
  }, []);

  // Lazy-load products when user starts searching
  useEffect(() => {
    if (search.trim().length >= 2 && !prodsLoaded) {
      setProdsLoaded(true);
      fetch("/api/public/catalog").then(r => r.json()).then(d => setAllProducts(d.products || []));
    }
  }, [search, prodsLoaded]);

  const searchResults = search.trim().length >= 2
    ? allProducts.filter(p => {
        const q = search.toLowerCase();
        return (
          p.name.toLowerCase().includes(q) ||
          (p.description || "").toLowerCase().includes(q) ||
          (p.category || "").toLowerCase().includes(q)
        );
      })
    : [];

  const isSearching = search.trim().length >= 2;

  if (loading) {
    return (
      <main className="min-h-screen bg-white flex flex-col">
        <div className="bg-white border-b border-slate-100" style={{ height: "calc(3.5rem + env(safe-area-inset-top))", paddingTop: "env(safe-area-inset-top)" }} />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 opacity-30">
          <div className="w-24 h-24 rounded-full bg-slate-200 animate-pulse" />
          <div className="h-4 w-40 bg-slate-200 animate-pulse rounded-full" />
        </div>
      </main>
    );
  }

  // ── Catalog disabled ──────────────────────────────────
  if (settings?.catalog_enabled !== "true") {
    return (
      <main className="min-h-screen bg-white flex flex-col items-center justify-center text-center px-6 gap-6">
        <img src="/logo.png" alt="Noreste" className="w-28 h-28 rounded-full shadow-xl object-cover ring-4 ring-white" />
        <div>
          <h1 className="font-black text-2xl text-slate-900 mb-2">Noreste Clothes & More</h1>
          <p className="text-slate-400 text-base">Catálogo en preparación</p>
          <p className="text-slate-400 text-sm mt-1">Pronto podrás ver todos nuestros productos aquí ✨</p>
        </div>
        <Link href="/" className="text-sm text-slate-400 underline underline-offset-2 hover:text-slate-600">
          ← Volver al inicio
        </Link>
      </main>
    );
  }

  const welcomeText    = settings.welcome_text     || "Ropa y accesorios originales de las mejores marcas 🇺🇸";
  const bannerActive   = settings.banner_active    === "true";
  const bannerText     = settings.banner_text      || "";
  const bannerColor    = settings.banner_color     || "emerald";
  const igHandle       = settings.instagram_handle || "";

  return (
    <main className="min-h-screen bg-white">
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-slate-100" style={{ paddingTop: "env(safe-area-inset-top)" }}>
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-4">
          <Link href="/" className="font-black text-slate-900 text-base tracking-tight shrink-0">← NORESTE</Link>
          {cartCount > 0 && (
            <button
              onClick={() => setShowCart(true)}
              className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-full font-bold text-sm hover:bg-slate-800 transition-colors active:scale-95 shrink-0"
            >
              🛒 {cartCount}
            </button>
          )}
        </div>
      </header>

      {/* ── Banner ── */}
      {bannerActive && bannerText && (
        <div className={`${BANNER_BG[bannerColor] || "bg-emerald-500"} text-white text-sm font-bold text-center px-4 py-2.5`}>
          {bannerText}
        </div>
      )}

      {/* ── Hero ── */}
      <section className="bg-white pt-10 pb-8 px-4 text-center">
        <div className="relative inline-block mb-5">
          <img
            src="/logo.png"
            alt="Noreste"
            className="w-28 h-28 rounded-full shadow-xl object-cover ring-4 ring-white"
          />
        </div>
        <h1 className="font-black text-2xl text-slate-900 mb-1 tracking-tight">Noreste Clothes & More</h1>
        <p className="text-slate-400 text-sm mb-4 max-w-xs mx-auto">{welcomeText}</p>

        {/* Instagram link */}
        {igHandle && (
          <a
            href={`https://instagram.com/${igHandle}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 mb-6 text-sm font-bold text-slate-500 hover:text-fuchsia-600 transition-colors"
          >
            <span>📸</span> @{igHandle}
          </a>
        )}
        {!igHandle && <div className="mb-6" />}

        {/* Search */}
        <div className="max-w-md mx-auto relative">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">🔍</span>
          <input
            type="text"
            placeholder="Buscar productos..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-11 pr-10 py-3.5 rounded-2xl bg-slate-100 text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300 transition-all placeholder:text-slate-400"
          />
          {search && (
            <button onClick={() => setSearch("")} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">✕</button>
          )}
        </div>
      </section>

      {/* ── Search Results ── */}
      {isSearching && (
        <section className="max-w-2xl mx-auto px-4 pb-16">
          {!prodsLoaded ? (
            <div className="grid grid-cols-2 gap-3">
              {[1,2,3,4].map(i => <div key={i} className="rounded-2xl bg-slate-100 animate-pulse aspect-square" />)}
            </div>
          ) : searchResults.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <p className="text-4xl mb-3">🔍</p>
              <p className="font-bold">Sin resultados para &ldquo;{search}&rdquo;</p>
            </div>
          ) : (
            <>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-4">
                {searchResults.length} resultado{searchResults.length !== 1 ? "s" : ""}
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-6">
                {searchResults.map(p => (
                  <Link key={p.id} href={`/catalogo/producto/${p.id}`} className="group">
                    <div className="aspect-square rounded-2xl overflow-hidden bg-slate-50 mb-2 shadow-sm">
                      {p.image_url
                        ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        : <div className="w-full h-full flex items-center justify-center text-4xl opacity-15">📦</div>
                      }
                    </div>
                    <p className="font-bold text-sm text-slate-900 leading-tight px-1 line-clamp-2">{p.name}</p>
                    {getDisplayPrice(p) && <p className="text-emerald-600 font-black text-base px-1 mt-1">{getDisplayPrice(p)}</p>}
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>
      )}

      {!isSearching && (
        <section className="max-w-2xl mx-auto px-4 pb-20 space-y-8">

          {/* ── Featured Products ── */}
          {featured.length > 0 && (
            <div>
              <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">⭐ Destacados</p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-6">
                {featured.map(p => (
                  <Link key={p.id} href={`/catalogo/producto/${p.id}`} className="group">
                    <div className="aspect-square rounded-2xl overflow-hidden bg-slate-50 mb-2.5 shadow-sm">
                      {p.image_url
                        ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                        : <div className="w-full h-full flex items-center justify-center text-5xl opacity-15">📦</div>
                      }
                    </div>
                    <p className="font-bold text-sm text-slate-900 leading-tight px-1 line-clamp-2">{p.name}</p>
                    {getDisplayPrice(p) && <p className="text-emerald-600 font-black text-base px-1 mt-1">{getDisplayPrice(p)}</p>}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* ── Categories ── */}
          <div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Categorías</p>
            {categories.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <p className="text-4xl mb-3">📦</p>
                <p className="font-bold">Catálogo en preparación</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {categories.map((cat, idx) => (
                  <Link
                    key={cat.name}
                    href={`/catalogo/${encodeURIComponent(cat.name)}`}
                    className="relative aspect-square rounded-2xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 active:scale-95 group"
                  >
                    {cat.image_url ? (
                      <img
                        src={cat.image_url}
                        alt={cat.name}
                        className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                      />
                    ) : (
                      <div className={`w-full h-full bg-gradient-to-br ${GRADIENTS[idx % GRADIENTS.length]}`} />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
                    <div className="absolute bottom-0 left-0 right-0 p-4">
                      <p className="text-white font-black text-sm uppercase tracking-widest leading-tight drop-shadow-lg">
                        {cat.name}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Floating Cart ── */}
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
