"use client";
import { useEffect, useState, useMemo, useCallback } from "react";

// Isolated so its search state never re-renders the parent
function FeaturedPicker({ allProducts, featuredProducts, featuredIds, onAdd, onRemove }) {
  const [q, setQ] = useState("");

  const results = useMemo(() => {
    if (q.trim().length < 1) return [];
    const lower = q.toLowerCase();
    return allProducts
      .filter(p => !featuredIds.includes(p.id) && p.name.toLowerCase().includes(lower))
      .slice(0, 6);
  }, [q, allProducts, featuredIds]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">Hasta 4 productos que aparecen antes de las categorías. Ideal para novedades o más vendidos.</p>

      {featuredProducts.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {featuredProducts.map(p => (
            <div key={p.id} className="relative bg-slate-50 border border-slate-200 rounded-xl overflow-hidden">
              <div className="aspect-square">
                {p.image_url
                  ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-3xl opacity-20">📦</div>
                }
              </div>
              <div className="p-2">
                <p className="text-xs font-bold text-slate-900 leading-tight line-clamp-2">{p.name}</p>
                <p className="text-xs text-emerald-600 font-black mt-0.5">${p.price}</p>
              </div>
              <button
                onClick={() => onRemove(p.id)}
                className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-500 text-white flex items-center justify-center text-xs font-black shadow hover:bg-red-400 transition-colors"
              >
                ✕
              </button>
            </div>
          ))}
          {featuredIds.length < 4 && (
            <div className="aspect-square rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-300 text-3xl">+</div>
          )}
        </div>
      )}

      {featuredIds.length < 4 && (
        <div className="space-y-2">
          <input
            type="text"
            placeholder="Buscar producto para destacar..."
            value={q}
            onChange={e => setQ(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-slate-400 focus:outline-none"
          />
          {results.length > 0 && (
            <div className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
              {results.map(p => (
                <button
                  key={p.id}
                  onClick={() => { onAdd(p); setQ(""); }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 border-b border-slate-100 last:border-0 text-left transition-colors"
                >
                  <div className="w-10 h-10 rounded-lg bg-slate-100 shrink-0 overflow-hidden">
                    {p.image_url
                      ? <img src={p.image_url} alt={p.name} className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-lg opacity-30">📦</div>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm text-slate-900 truncate">{p.name}</p>
                    <p className="text-xs text-emerald-600 font-bold">${p.price}</p>
                  </div>
                  <span className="text-emerald-500 font-black text-lg shrink-0">+</span>
                </button>
              ))}
            </div>
          )}
          {q.trim().length >= 1 && results.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-2">Sin coincidencias</p>
          )}
          {q.trim().length === 0 && featuredIds.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-2">Escribe el nombre del producto para buscarlo</p>
          )}
        </div>
      )}
    </div>
  );
}

const BANNER_COLORS = [
  { key: "emerald", label: "Verde",  bg: "bg-emerald-500", preview: "#10b981" },
  { key: "rose",    label: "Rojo",   bg: "bg-rose-500",    preview: "#f43f5e" },
  { key: "amber",   label: "Ámbar",  bg: "bg-amber-400",   preview: "#fbbf24" },
  { key: "sky",     label: "Azul",   bg: "bg-sky-500",     preview: "#0ea5e9" },
  { key: "violet",  label: "Morado", bg: "bg-violet-500",  preview: "#8b5cf6" },
];

export default function CatalogoPanel() {
  const [settings, setSettings]     = useState({});
  const [categories, setCategories] = useState([]);
  const [products, setProducts]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [toast, setToast]           = useState(null);

  // Local editable fields
  const [welcomeText,     setWelcomeText]     = useState("");
  const [bannerText,      setBannerText]      = useState("");
  const [bannerColor,     setBannerColor]     = useState("emerald");
  const [instagramHandle, setInstagramHandle] = useState("");

  const token = () => localStorage.getItem("panelToken") || "";

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // ── Load everything ──────────────────────────────────
  useEffect(() => {
    const tk = token();
    Promise.all([
      fetch("/api/panel/catalog-settings", { headers: { "x-panel-token": tk } }).then(r => r.json()),
      fetch("/api/panel/categories",       { headers: { "x-panel-token": tk } }).then(r => r.json()),
      fetch("/api/products",               { headers: { "x-panel-token": tk } }).then(r => r.json()),
    ]).then(([sd, cd, pd]) => {
      const s = sd.settings || {};
      setSettings(s);
      setWelcomeText(s.welcome_text    || "");
      setBannerText(s.banner_text      || "");
      setBannerColor(s.banner_color    || "emerald");
      setInstagramHandle(s.instagram_handle || "");
      setCategories(cd.categories || []);
      setProducts(pd.products || []);
    }).finally(() => setLoading(false));
  }, []);

  // ── Save a setting immediately (toggles) ─────────────
  const saveSetting = async (key, value) => {
    setSettings(prev => ({ ...prev, [key]: String(value) }));
    const res = await fetch("/api/panel/catalog-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-panel-token": token() },
      body: JSON.stringify({ settings: { [key]: String(value) } }),
    });
    if (!res.ok) showToast("Error al guardar", "error");
  };

  // ── Save multiple settings ───────────────────────────
  const saveMultiple = async (obj) => {
    const res = await fetch("/api/panel/catalog-settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-panel-token": token() },
      body: JSON.stringify({ settings: obj }),
    });
    if (res.ok) showToast("Guardado");
    else showToast("Error al guardar", "error");
    return res.ok;
  };

  // ── Featured products ────────────────────────────────
  const featuredIds = useMemo(() => {
    try { return JSON.parse(settings.featured_product_ids || "[]"); } catch { return []; }
  }, [settings.featured_product_ids]);

  const featuredProducts = useMemo(
    () => products.filter(p => featuredIds.includes(p.id)),
    [products, featuredIds]
  );

  const addFeatured = useCallback((product) => {
    const currentIds = (() => {
      try { return JSON.parse(settings.featured_product_ids || "[]"); } catch { return []; }
    })();
    if (currentIds.length >= 4) { showToast("Máximo 4 productos destacados", "error"); return; }
    const newIds = [...currentIds, product.id];
    saveSetting("featured_product_ids", JSON.stringify(newIds));
  }, [settings.featured_product_ids]);

  const removeFeatured = useCallback((productId) => {
    const currentIds = (() => {
      try { return JSON.parse(settings.featured_product_ids || "[]"); } catch { return []; }
    })();
    const newIds = currentIds.filter(id => id !== productId);
    saveSetting("featured_product_ids", JSON.stringify(newIds));
  }, [settings.featured_product_ids]);

  // ── Category helpers ─────────────────────────────────
  const [editingCat,  setEditingCat]  = useState(null);
  const [catUrlInput, setCatUrlInput] = useState("");
  const [savingCat,   setSavingCat]   = useState(false);
  const [uploadingCat, setUploadingCat] = useState(false);

  const uploadCatImage = async (file) => {
    if (!file) return;
    setUploadingCat(true);
    const form = new FormData();
    form.append("file", file);
    const res = await fetch("/api/panel/upload", {
      method: "POST",
      headers: { "x-panel-token": token() },
      body: form,
    });
    const data = await res.json();
    if (res.ok) setCatUrlInput(data.url);
    else showToast(data.message || "Error al subir", "error");
    setUploadingCat(false);
  };

  const saveCatImage = async (name) => {
    setSavingCat(true);
    const res = await fetch("/api/panel/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "x-panel-token": token() },
      body: JSON.stringify({ name, image_url: catUrlInput }),
    });
    if (res.ok) {
      setCategories(prev => prev.map(c => c.name === name ? { ...c, image_url: catUrlInput } : c));
      setEditingCat(null);
      showToast("Imagen guardada");
    } else showToast("Error al guardar", "error");
    setSavingCat(false);
  };

  const moveCat = async (idx, dir) => {
    const newCats = [...categories];
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= newCats.length) return;
    [newCats[idx], newCats[newIdx]] = [newCats[newIdx], newCats[idx]];
    setCategories(newCats);
    const tk = token();
    await Promise.all([
      fetch("/api/panel/categories", { method: "PATCH", headers: { "Content-Type": "application/json", "x-panel-token": tk }, body: JSON.stringify({ name: newCats[idx].name, sort_order: idx, image_url: newCats[idx].image_url }) }),
      fetch("/api/panel/categories", { method: "PATCH", headers: { "Content-Type": "application/json", "x-panel-token": tk }, body: JSON.stringify({ name: newCats[newIdx].name, sort_order: newIdx, image_url: newCats[newIdx].image_url }) }),
    ]);
  };

  // ── Render helpers ───────────────────────────────────
  const Toggle = ({ value, onChange, label, description }) => (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="font-bold text-slate-900 text-sm">{label}</p>
        {description && <p className="text-xs text-slate-400 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${value ? "bg-emerald-500" : "bg-slate-200"}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${value ? "translate-x-6" : "translate-x-0"}`} />
      </button>
    </div>
  );

  const SectionCard = ({ title, icon, children }) => (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2 rounded-t-2xl">
        <span className="text-lg">{icon}</span>
        <h2 className="font-black text-slate-900 text-sm uppercase tracking-wide">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );

  if (loading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        {[1,2,3,4].map(i => <div key={i} className="h-32 bg-slate-100 animate-pulse rounded-2xl" />)}
      </div>
    );
  }

  const catalogEnabled = settings.catalog_enabled === "true";
  const bannerActive   = settings.banner_active   === "true";

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-5 pb-16">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-2xl shadow-xl font-semibold text-sm ${toast.type === "error" ? "bg-red-50 text-red-600 border border-red-100" : "bg-emerald-50 text-emerald-700 border border-emerald-100"}`}>
          {toast.msg}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-black text-slate-900">Personalizar Catálogo</h1>
        <p className="text-slate-500 text-sm mt-1">Controla todo lo que ven tus clientes en el catálogo público.</p>
      </div>

      {/* ── 1. Estado del catálogo ── */}
      <SectionCard title="Estado del catálogo" icon="🟢">
        <Toggle
          value={catalogEnabled}
          onChange={v => saveSetting("catalog_enabled", v)}
          label={catalogEnabled ? "Catálogo activo — visible para clientes" : "Catálogo desactivado — muestra «Próximamente»"}
          description="Controla si los clientes pueden ver y hacer pedidos."
        />
        {!catalogEnabled && (
          <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-100 text-xs text-amber-700 font-medium">
            ⚠️ El catálogo está oculto. Los clientes ven una página de «Próximamente».
          </div>
        )}
      </SectionCard>

      {/* ── 2. Banner de anuncio ── */}
      <SectionCard title="Banner de anuncio" icon="📢">
        <div className="space-y-4">
          <Toggle
            value={bannerActive}
            onChange={v => saveSetting("banner_active", v)}
            label="Mostrar banner"
            description="Aparece en la parte superior del catálogo."
          />

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Texto del banner</label>
            <input
              type="text"
              placeholder="ej. ¡Nuevo inventario disponible esta semana!"
              value={bannerText}
              onChange={e => setBannerText(e.target.value)}
              maxLength={120}
              className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-slate-400 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {BANNER_COLORS.map(c => (
                <button
                  key={c.key}
                  onClick={() => setBannerColor(c.key)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border-2 text-xs font-bold transition-all ${bannerColor === c.key ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:border-slate-300"}`}
                >
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: c.preview }} />
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {bannerText && (
            <div className={`p-3 rounded-xl text-white text-sm font-bold text-center ${BANNER_COLORS.find(c => c.key === bannerColor)?.bg || "bg-emerald-500"}`}>
              {bannerText}
            </div>
          )}

          <button
            onClick={() => saveMultiple({ banner_text: bannerText, banner_color: bannerColor })}
            className="w-full py-2.5 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-colors active:scale-95"
          >
            Guardar banner
          </button>
        </div>
      </SectionCard>

      {/* ── 3. Texto de bienvenida ── */}
      <SectionCard title="Texto de bienvenida" icon="✏️">
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Aparece debajo del logo en la página principal del catálogo.</p>
          <textarea
            rows={2}
            placeholder="ej. Ropa y accesorios originales de las mejores marcas 🇺🇸"
            value={welcomeText}
            onChange={e => setWelcomeText(e.target.value)}
            maxLength={200}
            className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-slate-400 focus:outline-none resize-none"
          />
          <button
            onClick={() => saveMultiple({ welcome_text: welcomeText })}
            className="w-full py-2.5 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-colors active:scale-95"
          >
            Guardar texto
          </button>
        </div>
      </SectionCard>

      {/* ── 4. Instagram ── */}
      <SectionCard title="Instagram" icon="📸">
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Muestra un botón en el catálogo que lleva a tu Instagram.</p>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-bold">@</span>
            <input
              type="text"
              placeholder="tu_usuario"
              value={instagramHandle}
              onChange={e => setInstagramHandle(e.target.value.replace(/^@/, ""))}
              className="w-full pl-8 pr-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:border-slate-400 focus:outline-none"
            />
          </div>
          <button
            onClick={() => saveMultiple({ instagram_handle: instagramHandle })}
            className="w-full py-2.5 rounded-xl bg-slate-900 text-white font-bold text-sm hover:bg-slate-800 transition-colors active:scale-95"
          >
            Guardar Instagram
          </button>
        </div>
      </SectionCard>

      {/* ── 5. Productos destacados ── */}
      <SectionCard title="Productos destacados" icon="⭐">
        <FeaturedPicker
          allProducts={products}
          featuredProducts={featuredProducts}
          featuredIds={featuredIds}
          onAdd={addFeatured}
          onRemove={removeFeatured}
        />
      </SectionCard>

      {/* ── 6. Categorías ── */}
      <SectionCard title="Imágenes de categorías" icon="🏷️">
        <div className="space-y-3">
          <p className="text-xs text-slate-400 mb-3">Pega la URL de una imagen pública (Instagram, Google, Supabase Storage, etc.).</p>
          {categories.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">No hay categorías registradas</p>
          ) : categories.map((cat, idx) => (
            <div key={cat.name} className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 p-3">
                <div className="w-12 h-12 rounded-lg overflow-hidden bg-slate-100 shrink-0 border border-slate-100">
                  {cat.image_url
                    ? <img src={cat.image_url} alt={cat.name} className="w-full h-full object-cover" onError={e => { e.target.style.display = "none"; }} />
                    : <div className="w-full h-full flex items-center justify-center text-xl opacity-30">📷</div>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-slate-900">{cat.name}</p>
                  <p className="text-[10px] text-slate-400">{cat.image_url ? "✓ Con imagen" : "Sin imagen"}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => moveCat(idx, -1)} disabled={idx === 0} className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs flex items-center justify-center disabled:opacity-25">↑</button>
                    <button onClick={() => moveCat(idx, 1)} disabled={idx === categories.length - 1} className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-500 text-xs flex items-center justify-center disabled:opacity-25">↓</button>
                  </div>
                  <button
                    onClick={() => editingCat === cat.name ? setEditingCat(null) : (setEditingCat(cat.name), setCatUrlInput(cat.image_url || ""))}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${editingCat === cat.name ? "bg-slate-200 text-slate-600" : "bg-indigo-500 text-white hover:bg-indigo-400"}`}
                  >
                    {editingCat === cat.name ? "×" : cat.image_url ? "Editar" : "Imagen"}
                  </button>
                </div>
              </div>
              {editingCat === cat.name && (
                <div className="border-t border-slate-100 p-3 bg-slate-50 space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="url"
                      placeholder="https://... o sube una foto"
                      value={catUrlInput}
                      onChange={e => setCatUrlInput(e.target.value)}
                      autoFocus
                      className="flex-1 px-3 py-2.5 rounded-lg bg-white border border-slate-200 text-sm focus:border-indigo-500 focus:outline-none"
                    />
                    <label className={`shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-bold cursor-pointer transition-colors ${uploadingCat ? "bg-slate-200 text-slate-400" : "bg-indigo-100 text-indigo-700 hover:bg-indigo-200"}`}>
                      {uploadingCat ? "⏳" : "📁"} {uploadingCat ? "Subiendo…" : "Subir"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingCat}
                        onChange={e => uploadCatImage(e.target.files?.[0])}
                      />
                    </label>
                  </div>
                  {catUrlInput && (
                    <img src={catUrlInput} alt="preview" className="w-full h-32 object-cover rounded-lg" onError={e => { e.target.style.display = "none"; }} />
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => setEditingCat(null)} className="flex-1 py-2 rounded-lg border border-slate-200 text-slate-500 text-xs font-bold hover:bg-slate-100">Cancelar</button>
                    <button onClick={() => saveCatImage(cat.name)} disabled={savingCat || uploadingCat} className="flex-1 py-2 rounded-lg bg-indigo-500 text-white text-xs font-bold hover:bg-indigo-400 disabled:opacity-50">
                      {savingCat ? "…" : "Guardar"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Preview link */}
      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 text-center">
        <p className="text-sm text-slate-500 mb-2">Ver resultado</p>
        <a
          href="/catalogo"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block bg-slate-900 text-white font-bold px-5 py-2.5 rounded-xl text-sm hover:bg-slate-800 transition-colors active:scale-95"
        >
          Abrir Catálogo →
        </a>
      </div>
    </div>
  );
}
