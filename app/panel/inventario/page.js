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

const OPTION_TYPES = ["Tamaño", "Color", "Material", "Estilo"];
let _varKey = 0;
let _imgKey = 0;
const newVarRow = (optionType, baseCost = "", basePrice = "") => ({
  _key: `new_${++_varKey}`,
  id: null,
  option_type: optionType,
  name: "",
  sku: "",
  barcode: "",
  cost: baseCost,
  price: basePrice,
  stock: 0,
  varImages: [], // galería de fotos de la variante [{ _key, src }]
});

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

  const emptyForm = { id: null, name: "", category: "", stock: 0, barcode: "", cost: "", price: "", image_url: "", description: "" };
  const [form, setForm] = useState(emptyForm);
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(false);
  const [productImages, setProductImages] = useState([]); // [{ _key, src }]
  const [isNewCategory, setIsNewCategory] = useState(false);
  const [barcodeError, setBarcodeError] = useState("");
  const [sortBy, setSortBy] = useState("az");

  // Variant state
  const [hasVariants, setHasVariants] = useState(false);
  const [variantOptionType, setVariantOptionType] = useState("Tamaño");
  const [variants, setVariants] = useState([]);
  const [deletedVariantIds, setDeletedVariantIds] = useState([]);

  useEffect(() => {
    if (showModal && form.id) fetchStats(form.id);
    else setStats(null);
  }, [showModal, form.id]);

  const fetchStats = async (id) => {
    setLoadingStats(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/products/stats?id=${id}`, { headers: { "x-panel-token": token } });
      if (res.ok) setStats(await res.json());
    } catch (e) { console.error(e); }
    finally { setLoadingStats(false); }
  };

  const uniqueCategories = useMemo(() => {
    const cats = products.map(p => p.category).filter(c => typeof c === "string" && c.trim() !== "");
    return Array.from(new Set(cats)).sort();
  }, [products]);

  useEffect(() => { fetchProducts(); }, []);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/products", { headers: { "x-panel-token": token } });
      if (res.ok) setProducts((await res.json()).products || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const resizeToBase64 = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 800;
        const scale = Math.min(1, MAX_WIDTH / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });

  const handleAddImages = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remaining = 6 - productImages.length;
    const toProcess = files.slice(0, remaining);
    const newImgs = await Promise.all(toProcess.map(async (f) => ({
      _key: `img_${++_imgKey}`,
      src: await resizeToBase64(f),
    })));
    setProductImages(prev => [...prev, ...newImgs]);
    e.target.value = "";
  };

  const removeImage = (key) => {
    setProductImages(prev => prev.filter(i => i._key !== key));
  };

  const handleVariantAddImages = async (e, key) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const variant = variants.find(v => v._key === key);
    const remaining = 4 - (variant?.varImages || []).length;
    const toProcess = files.slice(0, remaining);
    const newImgs = await Promise.all(toProcess.map(async f => ({ _key: `vi_${++_imgKey}`, src: await resizeToBase64(f) })));
    setVariants(prev => prev.map(v => v._key === key ? { ...v, varImages: [...(v.varImages || []), ...newImgs] } : v));
    e.target.value = "";
  };

  const removeVariantImage = (key, imgKey) => {
    setVariants(prev => prev.map(v => v._key === key ? { ...v, varImages: v.varImages.filter(i => i._key !== imgKey) } : v));
  };

  const checkBarcodeInUse = (barcode) => {
    if (!barcode || hasVariants) { setBarcodeError(""); return; }
    const dup = products.find(p =>
      p.barcode === barcode && p.id !== form.id
    ) || products.flatMap(p => p.product_variants || []).find(v =>
      v.barcode === barcode
    );
    setBarcodeError(dup ? `Ya en uso: ${dup.name || "variante"}` : "");
  };

  const calculateMargin = () => {
    const c = Number(form.cost) || 0;
    const p = Number(form.price) || 0;
    if (p === 0) return 0;
    return (((p - c) / p) * 100).toFixed(1);
  };

  // ── Variant handlers ──
  const addVariantRow = () => {
    setVariants(prev => [...prev, newVarRow(variantOptionType, form.cost, form.price)]);
  };

  const removeVariantRow = (key) => {
    const v = variants.find(v => v._key === key);
    if (v?.id) setDeletedVariantIds(prev => [...prev, v.id]);
    setVariants(prev => prev.filter(v => v._key !== key));
  };

  const updateVariantRow = (key, field, value) => {
    setVariants(prev => prev.map(v => v._key === key ? { ...v, [field]: value } : v));
  };

  // ── Save ──
  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name) { showToast("Falta el nombre del producto.", "error"); return; }
    if (!hasVariants && (form.cost === "" || form.price === "")) {
      showToast("Falta costo o precio.", "error"); return;
    }
    if (hasVariants && variants.length === 0) {
      showToast("Agrega al menos una variante.", "error"); return;
    }
    if (hasVariants && variants.some(v => !v.name.trim())) {
      showToast("Todas las variantes deben tener nombre.", "error"); return;
    }

    if (barcodeError) { showToast(barcodeError, "error"); return; }

    setSaving(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const isEdit = !!form.id;

      // Resolver imágenes: subir las base64 nuevas al API (que ya maneja el upload)
      const resolvedImages = productImages.map(i => i.src);
      const mainImage = resolvedImages[0] || null;
      const extraImgs = resolvedImages.slice(1);

      const productData = { ...form, image_url: mainImage, images: extraImgs };
      if (hasVariants) {
        productData.cost = 0;
        productData.price = 0;
        productData.stock = variants.reduce((s, v) => s + (Number(v.stock) || 0), 0);
        productData.barcode = "";
      }

      const res = await fetch("/api/products", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify(productData),
      });

      if (!res.ok) {
        const err = await res.json();
        showToast(err.message || "Error al guardar", "error");
        return;
      }

      const { product } = await res.json();
      const productId = product.id;

      if (hasVariants) {
        for (const vid of deletedVariantIds) {
          await fetch(`/api/products/variants?id=${vid}`, { method: "DELETE", headers: { "x-panel-token": token } });
        }
        for (const v of variants) {
          const vImgs = (v.varImages || []).map(i => i.src);
          const vData = { name: v.name, sku: v.sku, barcode: v.barcode, cost: Number(v.cost) || 0, price: Number(v.price) || 0, stock: Number(v.stock) || 0, image_url: vImgs[0] || null, images: vImgs.slice(1) };
          if (v.id) {
            await fetch("/api/products/variants", {
              method: "PATCH",
              headers: { "Content-Type": "application/json", "x-panel-token": token },
              body: JSON.stringify({ id: v.id, ...vData }),
            });
          } else {
            await fetch("/api/products/variants", {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-panel-token": token },
              body: JSON.stringify({ product_id: productId, option_type: variantOptionType, ...vData }),
            });
          }
        }
      }

      await fetchProducts();
      closeModal();
      showToast(isEdit ? "Producto actualizado" : "Producto agregado", "success");
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
      const res = await fetch(`/api/products?id=${id}`, { method: "DELETE", headers: { "x-panel-token": token } });
      if (res.ok) { fetchProducts(); showToast("Producto eliminado", "success"); }
      else showToast("Error al eliminar", "error");
    } catch { showToast("Error de conexión", "error"); }
  };

  const openModal = (product = null) => {
    if (product) {
      setForm(product);
      const imgs = [product.image_url, ...(product.images || [])].filter(Boolean);
      setProductImages(imgs.map((src, i) => ({ _key: `img_${++_imgKey}_${i}`, src })));
      setIsNewCategory(false);
      const pvs = product.product_variants || [];
      setHasVariants(pvs.length > 0);
      setVariants(pvs.map(v => ({
        ...v,
        _key: v.id,
        varImages: [v.image_url, ...(v.images || [])].filter(Boolean).map((src, i) => ({ _key: `vi_${v.id}_${i}`, src })),
      })));
      setVariantOptionType(pvs[0]?.option_type || "Tamaño");
    } else {
      setForm(emptyForm);
      setProductImages([]);
      setIsNewCategory(false);
      setHasVariants(false);
      setVariants([]);
      setVariantOptionType("Tamaño");
    }
    setBarcodeError("");
    setDeletedVariantIds([]);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setForm(emptyForm);
    setProductImages([]);
    setBarcodeError("");
    setHasVariants(false);
    setVariants([]);
    setDeletedVariantIds([]);
  };

  const filteredProducts = useMemo(() => {
    const getStock = p => (p.product_variants?.length > 0)
      ? p.product_variants.reduce((s, v) => s + (v.stock || 0), 0)
      : (p.stock || 0);

    return products
      .filter(p => {
        const q = search.toLowerCase();
        const matchVariant = p.product_variants?.some(v =>
          v.name?.toLowerCase().includes(q) || v.barcode?.includes(search)
        );
        return p.name.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(search)) || String(p.id).includes(search) || matchVariant;
      })
      .sort((a, b) => {
        if (sortBy === "az")    return a.name.localeCompare(b.name);
        if (sortBy === "za")    return b.name.localeCompare(a.name);
        if (sortBy === "nuevo") return new Date(b.created_at) - new Date(a.created_at);
        if (sortBy === "viejo") return new Date(a.created_at) - new Date(b.created_at);
        if (sortBy === "stock_desc")  return getStock(b) - getStock(a);
        if (sortBy === "stock_asc")   return getStock(a) - getStock(b);
        if (sortBy === "precio_desc") return (b.price || 0) - (a.price || 0);
        if (sortBy === "precio_asc")  return (a.price || 0) - (b.price || 0);
        return 0;
      });
  }, [products, search, sortBy]);

  const variantTotalStock = (p) => (p.product_variants || []).reduce((s, v) => s + (v.stock || 0), 0);

  return (
    <main className="max-w-7xl mx-auto px-4 md:px-8 py-8 relative">

      {/* Toast */}
      <div className={`fixed top-6 right-6 z-[60] transition-all duration-500 transform ${toast.show ? "translate-y-0 opacity-100" : "-translate-y-10 opacity-0 pointer-events-none"}`}>
        <div className={`flex items-center gap-3 px-5 py-3.5 rounded-2xl shadow-2xl border backdrop-blur-md ${toast.type === "error" ? "bg-red-500/10 border-red-500/20 text-red-400" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"}`}>
          <span className="text-xl">{toast.type === "error" ? "⚠️" : "✓"}</span>
          <span className="font-semibold text-sm">{toast.message}</span>
        </div>
      </div>

      {/* Confirm Delete */}
      {confirmDialog.show && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden">
            <div className="p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4"><span className="text-2xl">🗑</span></div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">¿Eliminar producto?</h3>
              <p className="text-sm text-slate-500">Esta acción no se puede deshacer.</p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-3">
              <button onClick={() => setConfirmDialog({ show: false, productId: null })} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors">Cancelar</button>
              <button onClick={executeDelete} className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-white font-bold transition-all">Sí, eliminar</button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Inventario</h1>
            <p className="text-sm mt-1 opacity-70">Gestiona tus productos, stock y precios.</p>
          </div>
          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50">🔍</span>
              <input type="text" placeholder="Buscar producto o código..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 rounded-xl border bg-slate-50 border-slate-200 text-sm focus:outline-none focus:border-emerald-500 transition-colors" />
            </div>
            <button onClick={() => openModal()} className="flex-shrink-0 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold px-5 py-2.5 rounded-xl transition-all shadow-lg active:scale-95">+ Nuevo</button>
          </div>
        </div>

        {/* Sort buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mr-1">Ordenar:</span>
          {[
            { key: "az",          label: "A → Z" },
            { key: "za",          label: "Z → A" },
            { key: "nuevo",       label: "Más nuevo" },
            { key: "viejo",       label: "Más viejo" },
            { key: "stock_desc",  label: "Mayor stock" },
            { key: "stock_asc",   label: "Menor stock" },
            { key: "precio_desc", label: "Mayor precio" },
            { key: "precio_asc",  label: "Menor precio" },
          ].map(opt => (
            <button key={opt.key} onClick={() => setSortBy(opt.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${sortBy === opt.key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Product List */}
      <div className="rounded-2xl border bg-slate-50 border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-10 text-center opacity-50">Cargando inventario...</div>
        ) : filteredProducts.length === 0 ? (
          <div className="p-10 text-center opacity-50">No hay productos que coincidan.</div>
        ) : (
          <div className="divide-y divide-slate-200">
            {filteredProducts.map(p => {
              const pvs = p.product_variants || [];
              const hasVars = pvs.length > 0;
              const totalStock = hasVars ? variantTotalStock(p) : p.stock;
              return (
                <div key={p.id} className="p-4 hover:bg-slate-100 transition-colors flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="w-14 h-14 object-cover rounded-lg border border-slate-200" />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-xl opacity-50">📦</div>
                    )}
                    <div>
                      <h3 className="font-bold text-base flex items-center gap-2">
                        {p.name}
                        {hasVars && <span className="text-[10px] font-black uppercase tracking-wider bg-violet-100 text-violet-600 px-2 py-0.5 rounded-full">{pvs.length} variantes</span>}
                      </h3>
                      <div className="flex flex-wrap items-center gap-3 text-xs opacity-60 mt-1">
                        {p.category && <span>🏷 {p.category}</span>}
                        {!hasVars && p.barcode && <span>⏸ {p.barcode}</span>}
                        <span className={totalStock <= 0 ? "text-red-400 font-bold" : "text-emerald-400 font-bold"}>
                          📦 Stock: {totalStock}
                        </span>
                        {hasVars && (
                          <span className="flex gap-1">
                            {pvs.slice(0, 4).map(v => (
                              <span key={v.id} className="bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded-md font-medium">{v.name}</span>
                            ))}
                            {pvs.length > 4 && <span className="text-slate-400">+{pvs.length - 4}</span>}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right hidden sm:block">
                      {hasVars ? (
                        <>
                          <p className="text-sm font-bold text-emerald-400">
                            ${Math.min(...pvs.map(v => v.price))}
                            {Math.min(...pvs.map(v => v.price)) !== Math.max(...pvs.map(v => v.price)) && `–$${Math.max(...pvs.map(v => v.price))}`}
                          </p>
                          <p className="text-[10px] opacity-50">Precio por variante</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-bold text-emerald-400">${p.price}</p>
                          <p className="text-[10px] opacity-50">Costo: ${p.cost}</p>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => openModal(p)} className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-50 hover:bg-slate-100 text-sm transition-colors border border-transparent hover:border-slate-200">✏️</button>
                      <button onClick={() => setConfirmDialog({ show: true, productId: p.id })} className="w-9 h-9 rounded-xl flex items-center justify-center bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm transition-colors">🗑</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-lg shadow-2xl flex flex-col my-4" style={{ maxHeight: "calc(100dvh - 2rem)" }}>
            <div className="p-5 border-b border-slate-200 flex justify-between items-center shrink-0">
              <h2 className="text-lg font-bold text-slate-900">{form.id ? "Editar Producto" : "Nuevo Producto"}</h2>
              <button onClick={closeModal} className="w-8 h-8 rounded-xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center transition-colors">✕</button>
            </div>

            <div className="overflow-y-auto flex-1">
            <form onSubmit={handleSave} className="p-6 space-y-5">
              {/* Nombre del producto */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Nombre del producto *</label>
                <input required type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-emerald-500 transition-all"
                  placeholder={hasVariants ? "Ej: Bolsa Guess (nombre general)" : "Ej: Bolsa Guess Negra"} />
                {hasVariants && (
                  <p className="text-[11px] text-sky-500 font-semibold mt-1.5">
                    💡 Este es el nombre del producto en general. El color, talla, etc. va en cada variante abajo.
                  </p>
                )}
              </div>

              {/* Galería de fotos */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">Fotos del producto <span className="normal-case font-normal text-slate-400">({productImages.length}/6)</span></label>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {productImages.map((img, idx) => (
                    <div key={img._key} className="relative shrink-0 w-20 h-20 rounded-xl border-2 border-slate-200 overflow-hidden group">
                      <img src={img.src} alt="" className="w-full h-full object-cover" />
                      {idx === 0 && (
                        <span className="absolute bottom-0 left-0 right-0 text-[8px] font-black text-center bg-black/50 text-white py-0.5 uppercase tracking-wider">Principal</span>
                      )}
                      <button type="button" onClick={() => removeImage(img._key)}
                        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/70 text-white text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity leading-none">✕</button>
                    </div>
                  ))}
                  {productImages.length < 6 && (
                    <label className="shrink-0 w-20 h-20 rounded-xl border-2 border-dashed border-slate-300 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-50 hover:border-emerald-400 transition-all gap-1 text-center">
                      <span className="text-xl opacity-40">📷</span>
                      <span className="text-[9px] text-slate-400 font-semibold">Agregar</span>
                      <input type="file" accept="image/*" multiple onChange={handleAddImages} className="hidden" />
                    </label>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5">La primera foto es la principal. Arrastra para reordenar (próximamente).</p>
              </div>

              {/* Categoría + SKU */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Categoría</label>
                  {!isNewCategory && uniqueCategories.length > 0 ? (
                    <div className="relative">
                      <select value={form.category} onChange={e => { if (e.target.value === "NEW") { setIsNewCategory(true); setForm({ ...form, category: "" }); } else { setForm({ ...form, category: e.target.value }); } }}
                        className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-emerald-500 transition-all appearance-none cursor-pointer">
                        <option value="">Selecciona...</option>
                        {uniqueCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        <option value="NEW">+ Crear nueva</option>
                      </select>
                      <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-50 text-xs">▼</div>
                    </div>
                  ) : (
                    <div className="relative">
                      <input type="text" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-emerald-500 transition-all pr-10" placeholder="Nueva categoría..." />
                      {uniqueCategories.length > 0 && (
                        <button type="button" onClick={() => { setIsNewCategory(false); setForm({ ...form, category: "" }); }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-500/20 hover:text-red-400 transition-colors">✕</button>
                      )}
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Código (SKU)</label>
                  <input type="text" value={form.barcode || ""}
                    onChange={e => { setForm({ ...form, barcode: e.target.value }); setBarcodeError(""); }}
                    onBlur={e => checkBarcodeInUse(e.target.value)}
                    disabled={hasVariants}
                    className={`w-full px-4 py-2.5 rounded-xl bg-slate-50 border text-sm text-slate-900 focus:outline-none transition-all disabled:opacity-40 disabled:cursor-not-allowed ${barcodeError ? "border-red-400 focus:border-red-400" : "border-slate-200 focus:border-emerald-500"}`}
                    placeholder={hasVariants ? "En cada variante" : "Escanea o escribe..."} />
                  {barcodeError && <p className="text-xs text-red-500 font-semibold mt-1">⚠ {barcodeError}</p>}
                </div>
              </div>

              {/* Costo / Precio / Stock (oculto si tiene variantes) */}
              {!hasVariants && (
                <div className="grid grid-cols-3 gap-4 border-t border-slate-200 pt-5">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Costo *</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-medium">$</span>
                      <input required type="number" step="0.01" value={form.cost} onChange={e => setForm({ ...form, cost: e.target.value })}
                        className="w-full pl-7 pr-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-emerald-500 transition-all" placeholder="0.00" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-emerald-400 mb-1.5 uppercase tracking-wider">Venta *</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400 font-bold">$</span>
                      <input required type="number" step="0.01" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })}
                        className="w-full pl-7 pr-3 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 font-bold text-sm focus:outline-none focus:border-emerald-500 transition-all" placeholder="0.00" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Stock</label>
                    <input type="number" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-emerald-500 transition-all" placeholder="0" />
                  </div>
                </div>
              )}

              {/* Descripción */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5 uppercase tracking-wider">Descripción (catálogo)</label>
                <textarea placeholder="Describe el producto..." value={form.description || ""} onChange={e => setForm({ ...form, description: e.target.value })}
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-emerald-500 transition-all min-h-[70px] resize-y" />
              </div>

              {/* Margen (solo sin variantes) */}
              {!hasVariants && (
                <div className="bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.15),transparent)] border border-emerald-500/20 rounded-2xl p-4 flex items-center justify-between">
                  <span className="text-xs font-medium text-emerald-400 uppercase tracking-widest">Margen estimado</span>
                  <span className="text-xl font-black text-emerald-400">{calculateMargin()}%</span>
                </div>
              )}

              {/* ── Variantes ── */}
              <div className="border-t border-slate-200 pt-5">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-bold text-slate-800 text-sm">Variantes del producto</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Ej: diferentes tallas o colores del mismo artículo</p>
                  </div>
                  <button type="button" onClick={() => { setHasVariants(!hasVariants); if (!hasVariants && variants.length === 0) addVariantRow(); }}
                    className={`relative w-11 h-6 rounded-full transition-colors ${hasVariants ? "bg-emerald-500" : "bg-slate-200"}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${hasVariants ? "translate-x-5" : ""}`} />
                  </button>
                </div>

                {hasVariants && (
                  <div className="space-y-3">
                    {/* Tipo de variante */}
                    <div>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Tipo de variante</p>
                      {variants.some(v => v.id) ? (
                        <div className="flex items-center gap-2">
                          <span className="px-3 py-1.5 rounded-lg text-xs font-bold bg-slate-900 text-white">{variantOptionType}</span>
                          <span className="text-xs text-slate-400">No se puede cambiar una vez guardado</span>
                        </div>
                      ) : (
                        <div className="flex gap-2 flex-wrap">
                          {OPTION_TYPES.map(opt => (
                            <button key={opt} type="button" onClick={() => setVariantOptionType(opt)}
                              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${variantOptionType === opt ? "bg-slate-900 text-white border-slate-900" : "bg-slate-50 text-slate-600 border-slate-200 hover:border-slate-400"}`}>
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Cards de variantes */}
                    {variants.length > 0 && (
                      <div className="space-y-2">
                        {variants.map(v => (
                          <div key={v._key} className="bg-slate-50 rounded-xl border border-slate-200 p-3 space-y-2.5">
                            {/* Nombre + eliminar */}
                            <div className="flex gap-2 items-center">
                              <input type="text" placeholder={`Nombre (ej: Chico, Azul…)`} value={v.name}
                                onChange={e => updateVariantRow(v._key, "name", e.target.value)}
                                className="flex-1 px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm font-semibold text-slate-900 focus:outline-none focus:border-emerald-500 transition-colors placeholder-slate-300" />
                              <button type="button" onClick={() => removeVariantRow(v._key)}
                                className="w-8 h-8 rounded-lg bg-white border border-slate-200 hover:bg-red-50 hover:border-red-200 hover:text-red-500 text-slate-400 text-xs flex items-center justify-center transition-colors shrink-0">✕</button>
                            </div>
                            {/* Galería de fotos de la variante */}
                            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                              {(v.varImages || []).map(img => (
                                <div key={img._key} className="relative shrink-0 w-14 h-14 rounded-lg border border-slate-200 overflow-hidden group/img">
                                  <img src={img.src} alt="" className="w-full h-full object-cover" />
                                  <button type="button" onClick={() => removeVariantImage(v._key, img._key)}
                                    className="absolute inset-0 bg-black/50 text-white text-[11px] flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity font-bold">✕</button>
                                </div>
                              ))}
                              {(v.varImages || []).length < 4 && (
                                <label className="shrink-0 w-14 h-14 rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 bg-white transition-colors gap-0.5">
                                  <span className="text-lg opacity-30">📷</span>
                                  <span className="text-[8px] text-slate-400 font-semibold">{(v.varImages || []).length}/4</span>
                                  <input type="file" accept="image/*" multiple className="hidden" onChange={e => handleVariantAddImages(e, v._key)} />
                                </label>
                              )}
                            </div>
                            {/* Precio / Stock / Costo */}
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <p className="text-[10px] font-black text-emerald-600 uppercase tracking-wider mb-1">Precio *</p>
                                <div className="relative">
                                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-500 text-xs font-bold">$</span>
                                  <input type="text" inputMode="decimal" placeholder="0" value={v.price}
                                    onChange={e => updateVariantRow(v._key, "price", e.target.value)}
                                    style={{ color: "#059669" }}
                                    className="w-full pl-6 pr-2 py-2 rounded-lg bg-white border border-emerald-200 text-sm font-bold focus:outline-none focus:border-emerald-400" />
                                </div>
                              </div>
                              <div>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Stock</p>
                                <input type="text" inputMode="numeric" placeholder="0" value={v.stock}
                                  onChange={e => updateVariantRow(v._key, "stock", e.target.value)}
                                  style={{ color: "#1e293b" }}
                                  className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-center focus:outline-none focus:border-slate-400" />
                              </div>
                              <div>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Costo</p>
                                <div className="relative">
                                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                                  <input type="text" inputMode="decimal" placeholder="0" value={v.cost}
                                    onChange={e => updateVariantRow(v._key, "cost", e.target.value)}
                                    style={{ color: "#1e293b" }}
                                    className="w-full pl-6 pr-2 py-2 rounded-lg bg-white border border-slate-200 text-sm focus:outline-none focus:border-slate-400" />
                                </div>
                              </div>
                            </div>
                            {/* Código de barras */}
                            <div>
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Código de barras (opcional)</p>
                              <input type="text" placeholder="Escanea o escribe el código…" value={v.barcode || ""}
                                onChange={e => updateVariantRow(v._key, "barcode", e.target.value)}
                                className="w-full px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-900 focus:outline-none focus:border-slate-400 transition-colors placeholder-slate-300" />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <button type="button" onClick={addVariantRow}
                      className="w-full py-2.5 rounded-xl border-2 border-dashed border-slate-300 text-sm font-bold text-slate-400 hover:border-emerald-400 hover:text-emerald-500 transition-colors">
                      + Agregar variante
                    </button>
                  </div>
                )}
              </div>

              <div className="pt-2 flex justify-end gap-3 border-b border-slate-100 pb-6 mb-4">
                <button type="button" onClick={closeModal} className="px-5 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors">Cancelar</button>
                <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold shadow-lg shadow-emerald-500/20 disabled:opacity-50 transition-all active:scale-95">
                  {saving ? "Guardando..." : "Guardar Producto"}
                </button>
              </div>
            </form>

            {/* Estadísticas */}
            {form.id && (
              <div className="px-6 pb-6 border-t border-slate-100">
                <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2"><span className="text-xl">📊</span> Trazabilidad del Producto</h3>
                {loadingStats ? (
                  <div className="text-center opacity-50 py-4 text-sm">Cargando estadísticas...</div>
                ) : stats ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <span className="text-[10px] uppercase font-bold text-slate-400">Creación</span>
                        <p className="text-sm font-bold text-slate-700">{new Date(stats.product?.created_at).toLocaleDateString("es-MX")}</p>
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
                    <div>
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">A quién se le vendió</h4>
                      <div className="bg-slate-50 border border-slate-200 rounded-xl max-h-48 overflow-y-auto">
                        {stats.sales_history?.length > 0 ? (
                          <div className="divide-y divide-slate-200">
                            {stats.sales_history.map((sale, idx) => (
                              <div key={idx} className="p-3 flex items-center justify-between hover:bg-white transition-colors">
                                <div>
                                  <p className="font-bold text-sm text-slate-900">{sale.client_instagram ? `@${sale.client_instagram.replace(/^@/, "")}` : sale.client_name}</p>
                                  <p className="text-[10px] text-slate-500">{new Date(sale.date).toLocaleString("es-MX", { day: "2-digit", month: "short", year: "numeric" })}</p>
                                </div>
                                <div className="flex items-center gap-3">
                                  <span className="text-xs font-bold text-slate-400">{sale.quantity}x</span>
                                  <button type="button" onClick={() => router.push(`/panel/ventas/${sale.sale_id}`)}
                                    className="px-2 py-1 bg-white border border-slate-200 rounded-md text-xs font-bold text-slate-600 hover:bg-slate-100 hover:text-emerald-600 transition-colors">
                                    Ver Venta ➔
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="p-4 text-center text-xs text-slate-500">Aún no hay ventas registradas.</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-red-500 py-4 text-sm">Error al cargar estadísticas.</div>
                )}
              </div>
            )}
            </div>{/* end scrollable container */}
          </div>
        </div>
      )}
    </main>
  );
}
