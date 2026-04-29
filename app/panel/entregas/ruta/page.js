"use client";
import { useEffect, useState, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const ORIGIN = "25.5464865,-103.4497847";
const ORIGIN_LABEL = "B";

function getPanelToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("panelToken") || "";
}

function getTodayInputDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function stopLabel(idx) {
  if (idx < 9) return String(idx + 1);
  return String.fromCharCode(65 + (idx - 9)); // A, B, C...
}


function isValidUrl(url) {
  return url && (url.startsWith("http://") || url.startsWith("https://"));
}

function buildNavUrl(booking) {
  if (isValidUrl(booking.location_url)) return booking.location_url;
  const parts = [booking.address, booking.city, booking.state].filter(Boolean).join(", ");
  if (parts) return parts;
  return null;
}

function openNavigation(booking) {
  if (isValidUrl(booking.location_url)) {
    window.open(booking.location_url, "_blank");
    return;
  }
  const parts = [booking.address, booking.city, booking.state].filter(Boolean).join(", ");
  if (!parts) return;
  const encoded = encodeURIComponent(parts);
  const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${encoded}&travelmode=driving`;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIOS) {
    // comgooglemaps:// forces Google Maps app; fallback to web if not installed
    window.location.href = `comgooglemaps://?daddr=${encoded}&directionsmode=driving`;
    setTimeout(() => window.open(webUrl, "_blank"), 1200);
  } else {
    window.open(webUrl, "_blank");
  }
}

function formatPhoneForWhatsApp(phone) {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return "52" + digits;
  if (digits.startsWith("52")) return digits;
  return "52" + digits;
}

function buildStaticMapUrl(sorted, apiKey) {
  if (!apiKey || sorted.length === 0) return null;
  const originMarker = `markers=color:green|label:${ORIGIN_LABEL}|${ORIGIN}`;
  const stopMarkers = sorted.map((bk, idx) => {
    const addr = [bk.address, bk.city, bk.state].filter(Boolean).join(", ");
    if (!addr) return null;
    return `markers=color:red|label:${stopLabel(idx)}|${encodeURIComponent(addr)}`;
  }).filter(Boolean);
  if (stopMarkers.length === 0) return null;
  return `https://maps.googleapis.com/maps/api/staticmap?size=640x320&scale=2&${originMarker}&${stopMarkers.join("&")}&key=${apiKey}`;
}

export default function RutaPage() {
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const [bookings, setBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(true);

  const [order, setOrder] = useState([]); // IDs en orden
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [mapUrl, setMapUrl] = useState(null);
  const [statusMsg, setStatusMsg] = useState(null);

  const [mode, setMode] = useState("review"); // 'review' | 'driving'
  const [currentIdx, setCurrentIdx] = useState(0);
  const [updatingId, setUpdatingId] = useState(null);
  const [pendingDelivery, setPendingDelivery] = useState(null); // { booking } — awaiting payment method
  const [pendingNoEntregado, setPendingNoEntregado] = useState(null); // { booking } — awaiting confirmation

  // Address editing state (review mode)
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({ calle: "", numero: "", colonia: "", cp: "", city: "" });
  const [savingAddress, setSavingAddress] = useState(false);
  const acContainerRef = useRef(null);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const today = getTodayInputDate();

  // ── Auth ──────────────────────────────────────────────
  useEffect(() => {
    const token = getPanelToken();
    if (!token) { router.push("/panel"); return; }
    try {
      const decoded = atob(token);
      const [json] = decoded.split("|");
      JSON.parse(json);
      setAuthChecked(true);
    } catch {
      router.push("/panel");
    }
  }, []);

  // ── Load today's domicilio bookings ───────────────────
  useEffect(() => {
    if (!authChecked) return;
    fetchBookings();
  }, [authChecked]);

  const fetchBookings = async () => {
    setLoadingBookings(true);
    try {
      const token = getPanelToken();
      const res = await fetch("/api/bookings", { headers: { "x-panel-token": token } });
      if (!res.ok) return;
      const data = await res.json();
      const todayDom = (data.bookings || []).filter(
        (bk) =>
          bk.type === "domicilio" &&
          bk.date === today &&
          bk.delivery_status !== "entregado"
      );
      setBookings(todayDom);
      // Restore saved order if it matches today's set
      const saved = localStorage.getItem("rutaOrder");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          const ids = todayDom.map((b) => b.id);
          const valid = parsed.filter((id) => ids.includes(id));
          if (valid.length === ids.length) {
            setOrder(valid);
            regenerateMap(todayDom, valid);
            return;
          }
        } catch {}
      }
      setOrder(todayDom.map((b) => b.id));
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingBookings(false);
    }
  };

  const regenerateMap = (bks, ord) => {
    const sorted = ord.map((id) => bks.find((b) => b.id === id)).filter(Boolean);
    const url = buildStaticMapUrl(sorted, apiKey);
    setMapUrl(url);
  };

  // Persist order
  useEffect(() => {
    if (order.length > 0) localStorage.setItem("rutaOrder", JSON.stringify(order));
  }, [order]);

  // ── Sorted bookings ───────────────────────────────────
  const sorted = useMemo(() => {
    if (order.length === 0) return bookings;
    return order.map((id) => bookings.find((b) => b.id === id)).filter(Boolean);
  }, [order, bookings]);

  const currentStop = sorted[currentIdx] || null;

  // ── Optimize ──────────────────────────────────────────
  const handleOptimize = async () => {
    if (bookings.length < 2) {
      setStatusMsg({ text: "Se necesitan al menos 2 entregas para optimizar.", type: "error" });
      return;
    }
    setIsOptimizing(true);
    setStatusMsg({ text: "Calculando ruta óptima…", type: "info" });
    try {
      const locations = bookings.map((bk) => ({
        id: bk.id,
        url: bk.location_url || null,
        addressText: [bk.address, bk.city, bk.state].filter(Boolean).join(", "),
      }));
      const token = getPanelToken();
      const res = await fetch("/api/optimize-route", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({ locations, origin: ORIGIN }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg({ text: data.message || "Error al optimizar", type: "error" });
      } else {
        const newOrder = data.order || bookings.map((b) => b.id);
        setOrder(newOrder);
        regenerateMap(bookings, newOrder);
        setStatusMsg({ text: `Ruta optimizada — ${newOrder.length} paradas`, type: "success" });
      }
    } catch {
      setStatusMsg({ text: "Error de conexión", type: "error" });
    } finally {
      setIsOptimizing(false);
    }
  };

  // ── Reorder arrows ────────────────────────────────────
  const moveStop = (idx, dir) => {
    const newOrder = [...order];
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= newOrder.length) return;
    [newOrder[idx], newOrder[newIdx]] = [newOrder[newIdx], newOrder[idx]];
    setOrder(newOrder);
    regenerateMap(bookings, newOrder);
  };

  // ── Mark delivery status ──────────────────────────────
  const markStop = async (booking, status, paymentMethod = "efectivo") => {
    setUpdatingId(booking.id);
    setPendingDelivery(null);
    try {
      const token = getPanelToken();
      await fetch("/api/bookings/update-delivery", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({
          id: booking.id,
          deliveryStatus: status,
          paymentMethod,
          products: booking.products || "",
          amountDue: booking.amount_due || 0,
        }),
      });
      const newBookings = bookings.filter((b) => b.id !== booking.id);
      const newOrder = order.filter((id) => id !== booking.id);
      setBookings(newBookings);
      setOrder(newOrder);
      regenerateMap(newBookings, newOrder);
      if (currentIdx >= newBookings.length && currentIdx > 0) {
        setCurrentIdx(currentIdx - 1);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setUpdatingId(null);
    }
  };

  // ── Google Autocomplete (classic — más confiable en iOS) ─
  // Se carga SOLO cuando el repartidor abre el editor de dirección
  useEffect(() => {
    if (!editingId) {
      if (acContainerRef.current) acContainerRef.current.innerHTML = "";
      return;
    }
    if (!apiKey) return;

    const mountAC = () => {
      if (!acContainerRef.current) return;
      if (!window.google?.maps?.places?.Autocomplete) return;
      acContainerRef.current.innerHTML = "";

      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Buscar dirección en La Laguna...";
      input.style.cssText = [
        "width:100%", "box-sizing:border-box", "padding:12px 16px",
        "background:#1e293b", "color:white", "border:1px solid #334155",
        "border-radius:12px", "outline:none", "font-size:14px",
        "font-family:inherit",
      ].join(";");
      acContainerRef.current.appendChild(input);

      const laBounds = new window.google.maps.LatLngBounds(
        { lat: 25.45, lng: -103.62 },
        { lat: 25.65, lng: -103.30 }
      );

      const ac = new window.google.maps.places.Autocomplete(input, {
        componentRestrictions: { country: "mx" },
        bounds: laBounds,
        strictBounds: true,
        fields: ["address_components", "formatted_address"],
      });

      ac.addListener("place_changed", () => {
        const place = ac.getPlace();
        let calle = "", numero = "", colonia = "", cp = "", city = "";
        for (const comp of place.address_components || []) {
          if (comp.types.includes("route")) calle = comp.long_name;
          else if (comp.types.includes("street_number")) numero = comp.long_name;
          else if (comp.types.includes("sublocality_level_1") || comp.types.includes("sublocality") || comp.types.includes("neighborhood")) colonia = comp.long_name;
          else if (comp.types.includes("postal_code")) cp = comp.long_name;
          else if (comp.types.includes("locality")) city = comp.long_name;
        }
        // Si no encontró calle en los componentes, usa la dirección formateada completa
        if (!calle) calle = place.formatted_address || input.value;
        setEditForm(f => ({ ...f, calle, numero, colonia: colonia || f.colonia, cp: cp || f.cp, city: city || f.city }));
      });
    };

    // Si ya está cargado, montar directamente
    if (window.google?.maps?.places?.Autocomplete) {
      mountAC();
      return () => { if (acContainerRef.current) acContainerRef.current.innerHTML = ""; };
    }

    // Cargar el script solo la primera vez que se abre el editor
    const cbName = "__rutaGMapsReady";
    window[cbName] = mountAC;

    if (!document.getElementById("gm-ruta-script")) {
      const s = document.createElement("script");
      s.id = "gm-ruta-script";
      s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=es&callback=${cbName}`;
      s.async = true;
      document.head.appendChild(s);
    }

    return () => {
      if (acContainerRef.current) acContainerRef.current.innerHTML = "";
      delete window[cbName];
    };
  }, [editingId, apiKey]);

  // ── Save address edit ─────────────────────────────────
  const saveAddress = async (bookingId) => {
    setSavingAddress(true);
    try {
      const token = getPanelToken();
      const addressStr = [
        editForm.calle,
        editForm.numero ? `Num: ${editForm.numero}` : null,
        editForm.colonia ? `Col: ${editForm.colonia}` : null,
      ].filter(Boolean).join(", ");
      const res = await fetch("/api/bookings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({
          action: "update-address",
          id: bookingId,
          address: addressStr,
          city: editForm.city,
          postalCode: editForm.cp,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setBookings((prev) =>
          prev.map((b) => (b.id === bookingId ? { ...b, ...updated.booking } : b))
        );
        regenerateMap(
          bookings.map((b) => (b.id === bookingId ? { ...b, ...updated.booking } : b)),
          order
        );
        setEditingId(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingAddress(false);
    }
  };

  // ── UI helpers ────────────────────────────────────────
  const statusClasses = {
    success: "bg-emerald-50 border border-emerald-200 text-emerald-700",
    error: "bg-red-50 border border-red-200 text-red-700",
    info: "bg-sky-50 border border-sky-200 text-sky-700",
  };

  if (!authChecked || loadingBookings) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // MODO CONDUCCIÓN — una parada a la vez
  // ═══════════════════════════════════════════════════════
  if (mode === "driving") {
    const progress = sorted.length > 0 ? ((currentIdx) / sorted.length) * 100 : 0;
    const totalToCobrar = sorted.reduce((sum, bk) => sum + (Number(bk.amount_due) || 0), 0);
    const cobradoHasta = sorted.slice(0, currentIdx).reduce((sum, bk) => sum + (Number(bk.amount_due) || 0), 0);

    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col">
        {/* Header */}
        <div className="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
          <button onClick={() => setMode("review")} className="text-slate-400 hover:text-white text-sm font-bold flex items-center gap-2">
            ← Revisión
          </button>
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
            Parada {currentIdx + 1} de {sorted.length}
          </span>
          <span className="text-sky-400 font-black text-sm">{sorted.length - currentIdx - 1} restantes</span>
        </div>

        {/* Barra de progreso */}
        <div className="h-1 bg-slate-800">
          <div className="h-full bg-sky-500 transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>

        {/* Total a cobrar en ruta */}
        {totalToCobrar > 0 && (
          <div className="bg-rose-500/10 border-b border-rose-500/20 px-4 py-2 flex items-center justify-between">
            <span className="text-xs text-rose-400 font-bold uppercase tracking-widest">Total a cobrar en ruta</span>
            <div className="flex items-center gap-3">
              {cobradoHasta > 0 && (
                <span className="text-xs text-emerald-400 font-bold">✓ ${cobradoHasta.toFixed(2)} cobrado</span>
              )}
              <span className="text-rose-400 font-black text-base">${totalToCobrar.toFixed(2)}</span>
            </div>
          </div>
        )}

        {sorted.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center">
            <div className="text-6xl">🎉</div>
            <h2 className="text-2xl font-black">¡Ruta completada!</h2>
            <p className="text-slate-400">Todas las paradas del día han sido procesadas.</p>
            <div className="flex flex-col gap-3 mt-4 w-full max-w-xs">
              <button onClick={() => setMode("review")} className="bg-sky-500 text-white px-6 py-3 rounded-2xl font-black">
                Ver resumen
              </button>
              <button onClick={() => router.push("/panel/entregas")} className="bg-slate-800 border border-slate-700 text-slate-300 px-6 py-3 rounded-2xl font-black hover:bg-slate-700 transition-colors">
                ← Volver a Entregas
              </button>
            </div>
          </div>
        ) : !currentStop ? null : (
          <div className="flex-1 flex flex-col p-4 gap-4 max-w-lg mx-auto w-full">
            {/* Número de parada */}
            <div className="flex items-center gap-3 pt-2">
              <div className="w-12 h-12 rounded-2xl bg-sky-500 flex items-center justify-center text-xl font-black text-white shadow-lg shadow-sky-500/30">
                {stopLabel(currentIdx)}
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Parada actual</p>
                <p className="font-black text-lg leading-tight">{currentStop.instagram ? `@${currentStop.instagram.replace(/^@/, "")}` : currentStop.fullName}</p>
                {currentStop.instagram && <p className="text-xs text-slate-400 leading-tight">{currentStop.fullName}</p>}
              </div>
            </div>

            {/* Dirección */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Dirección</p>
              <p className="text-white font-semibold leading-relaxed">
                {currentStop.address || "—"}<br />
                <span className="text-slate-300">{currentStop.city}{currentStop.state ? `, ${currentStop.state}` : ""}</span>
              </p>
              {currentStop.notes && (
                <p className="text-xs text-amber-400 font-medium pt-1">📝 {currentStop.notes}</p>
              )}
            </div>

            {/* Productos y adeudo */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-widest font-bold mb-1">Productos</p>
                <p className="text-slate-200 text-sm whitespace-pre-line leading-relaxed">
                  {currentStop.products || "— sin detalle"}
                </p>
              </div>
              {currentStop.amount_due > 0 && (
                <div className="border-t border-slate-800 pt-3 flex items-center justify-between">
                  <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Adeudo</p>
                  <p className="text-rose-400 font-black text-lg">${Number(currentStop.amount_due).toFixed(2)}</p>
                </div>
              )}
              {currentStop.phone && (
                <div className="border-t border-slate-800 pt-3 space-y-2">
                  <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Contacto rápido</p>
                  <div className="grid grid-cols-2 gap-2">
                    <a
                      href={`tel:${currentStop.phone}`}
                      className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-sky-500/10 border border-sky-500/30 text-sky-400 font-black text-sm active:scale-95 transition-all"
                    >
                      <span>📞</span> Llamar
                    </a>
                    <a
                      href={`https://wa.me/${formatPhoneForWhatsApp(currentStop.phone)}?text=${encodeURIComponent("Hola! Soy tu repartidor de Noreste:")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-black text-sm active:scale-95 transition-all"
                    >
                      <span>💬</span> WhatsApp
                    </a>
                  </div>
                  {currentStop.instagram && (
                    <a
                      href={`https://instagram.com/${currentStop.instagram.replace(/^@/, "")}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-2 py-3.5 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/30 text-fuchsia-400 font-black text-sm active:scale-95 transition-all w-full"
                    >
                      <span>📸</span> Ver Instagram
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Botón navegar */}
            {buildNavUrl(currentStop) && (
              <button
                onClick={() => openNavigation(currentStop)}
                className="flex items-center justify-center gap-3 bg-slate-900 border-2 border-sky-500/40 hover:border-sky-500 text-sky-400 font-black py-4 rounded-2xl transition-all hover:bg-sky-500/10 active:scale-95 w-full"
              >
                <span className="text-xl">📍</span>
                {currentStop.location_url ? "Navegar al pin exacto" : "Navegar a esta dirección"}
              </button>
            )}

            {/* Acciones */}
            <div className="grid grid-cols-2 gap-3 mt-auto">
              <button
                disabled={!!updatingId || !!pendingDelivery || !!pendingNoEntregado}
                onClick={() => setPendingNoEntregado({ booking: currentStop })}
                className="py-4 rounded-2xl bg-slate-800 border border-slate-700 text-slate-300 font-black hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-400 transition-all active:scale-95 disabled:opacity-50"
              >
                ✗ No estaba
              </button>
              <button
                disabled={!!updatingId || !!pendingDelivery}
                onClick={() => {
                  if (Number(currentStop.amount_due) > 0) {
                    setPendingDelivery({ booking: currentStop });
                  } else {
                    markStop(currentStop, "entregado", "efectivo");
                  }
                }}
                className="py-4 rounded-2xl bg-sky-500 text-white font-black shadow-lg shadow-sky-500/30 hover:bg-sky-400 transition-all active:scale-95 disabled:opacity-50"
              >
                {updatingId === currentStop.id ? "..." : "✓ Entregado"}
              </button>
            </div>

            {/* Selector de método de pago */}
            {pendingDelivery && pendingDelivery.booking.id === currentStop.id && (
              <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm">
                <div className="bg-slate-900 border-t border-slate-700 rounded-t-3xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">Forma de pago</p>
                      <p className="font-black text-white text-base mt-0.5">{currentStop.instagram ? `@${currentStop.instagram.replace(/^@/, "")}` : currentStop.fullName}</p>
                      {currentStop.instagram && <p className="text-xs text-slate-400">{currentStop.fullName}</p>}
                    </div>
                    <button
                      onClick={() => setPendingDelivery(null)}
                      className="w-9 h-9 rounded-xl bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-lg font-bold"
                    >
                      ✕
                    </button>
                  </div>
                  {currentStop.amount_due > 0 && (
                    <p className="text-sm text-slate-400">
                      Adeudo cobrado: <span className="text-rose-400 font-black">${Number(currentStop.amount_due).toFixed(2)}</span>
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <button
                      disabled={!!updatingId}
                      onClick={() => markStop(pendingDelivery.booking, "entregado", "efectivo")}
                      className="flex flex-col items-center justify-center gap-2 py-5 rounded-2xl bg-emerald-500/10 border-2 border-emerald-500/40 hover:border-emerald-500 hover:bg-emerald-500/20 text-emerald-400 font-black transition-all active:scale-95 disabled:opacity-50"
                    >
                      <span className="text-3xl">💵</span>
                      <span className="text-sm uppercase tracking-wide">Efectivo</span>
                    </button>
                    <button
                      disabled={!!updatingId}
                      onClick={() => markStop(pendingDelivery.booking, "entregado", "transferencia")}
                      className="flex flex-col items-center justify-center gap-2 py-5 rounded-2xl bg-sky-500/10 border-2 border-sky-500/40 hover:border-sky-500 hover:bg-sky-500/20 text-sky-400 font-black transition-all active:scale-95 disabled:opacity-50"
                    >
                      <span className="text-3xl">📲</span>
                      <span className="text-sm uppercase tracking-wide">Transferencia</span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Confirmación No entregado */}
            {pendingNoEntregado && pendingNoEntregado.booking.id === currentStop.id && (
              <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-sm">
                <div className="bg-slate-900 border-t border-slate-700 rounded-t-3xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-widest font-bold">¿Confirmar intento fallido?</p>
                      <p className="font-black text-white text-base mt-0.5">{currentStop.instagram ? `@${currentStop.instagram.replace(/^@/, "")}` : currentStop.fullName}</p>
                      {currentStop.instagram && <p className="text-xs text-slate-400">{currentStop.fullName}</p>}
                    </div>
                    <button
                      onClick={() => setPendingNoEntregado(null)}
                      className="w-9 h-9 rounded-xl bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-lg font-bold"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-sm text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
                    ⚠ El siguiente envío de este cliente tendrá costo doble ($90).
                  </p>
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <button
                      onClick={() => setPendingNoEntregado(null)}
                      className="py-4 rounded-2xl bg-slate-800 border border-slate-700 text-slate-300 font-black hover:bg-slate-700 transition-all active:scale-95"
                    >
                      Cancelar
                    </button>
                    <button
                      disabled={!!updatingId}
                      onClick={() => markStop(pendingNoEntregado.booking, "no_entregado", "efectivo")}
                      className="py-4 rounded-2xl bg-red-500/20 border-2 border-red-500/40 hover:border-red-500 hover:bg-red-500/30 text-red-400 font-black transition-all active:scale-95 disabled:opacity-50"
                    >
                      {updatingId ? "..." : "✗ Confirmar"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Anterior / Siguiente manual */}
            <div className="flex gap-3 pb-4">
              <button
                disabled={currentIdx === 0}
                onClick={() => setCurrentIdx((i) => i - 1)}
                className="flex-1 py-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 font-bold text-sm disabled:opacity-30 hover:bg-slate-800 transition-colors"
              >
                ← Anterior
              </button>
              <button
                disabled={currentIdx >= sorted.length - 1}
                onClick={() => setCurrentIdx((i) => i + 1)}
                className="flex-1 py-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 font-bold text-sm disabled:opacity-30 hover:bg-slate-800 transition-colors"
              >
                Siguiente →
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // MODO REVISIÓN — lista completa con mapa
  // ═══════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-slate-950 text-white pb-10">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/panel/entregas" className="text-slate-400 hover:text-white text-sm font-bold flex items-center gap-2">
            ← Entregas
          </Link>
          <h1 className="font-black text-sm uppercase tracking-widest text-slate-200">Ruta del Día</h1>
          <span className="text-xs font-bold text-slate-500">{sorted.length} paradas</span>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 pt-5 space-y-4">

        {/* Mensaje de estado */}
        {statusMsg && (
          <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${statusClasses[statusMsg.type]}`}>
            {statusMsg.text}
          </div>
        )}

        {/* Sin entregas */}
        {bookings.length === 0 && (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 text-center space-y-3">
            <p className="text-3xl">📭</p>
            <p className="text-slate-300 font-bold">Sin entregas a domicilio pendientes para hoy</p>
            <Link href="/panel/entregas" className="inline-block mt-2 text-sky-400 font-bold text-sm">
              ← Volver a Entregas
            </Link>
          </div>
        )}

        {bookings.length > 0 && (
          <>
            {/* Acciones */}
            <div className="flex gap-3">
              <button
                onClick={handleOptimize}
                disabled={isOptimizing || bookings.length < 2}
                className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-black py-3 rounded-2xl transition-all disabled:opacity-50 active:scale-95 shadow-lg shadow-indigo-500/20"
              >
                {isOptimizing ? (
                  <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Optimizando…</>
                ) : (
                  <><span>🗺️</span> Optimizar Ruta</>
                )}
              </button>
              <button
                onClick={() => { setMode("driving"); setCurrentIdx(0); }}
                disabled={sorted.length === 0}
                className="flex-1 flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-400 text-white font-black py-3 rounded-2xl transition-all disabled:opacity-50 active:scale-95 shadow-lg shadow-sky-500/20"
              >
                <span>🚛</span> Iniciar Ruta
              </button>
            </div>

            {/* Mapa estático */}
            {mapUrl && (
              <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2">
                  <span className="text-sm font-black text-slate-200">Vista de la Ruta</span>
                  <span className="text-xs text-slate-500 font-medium">— verde = bodega (salida y regreso)</span>
                </div>
                <img
                  src={mapUrl}
                  alt="Mapa de ruta"
                  className="w-full object-cover"
                  style={{ maxHeight: 320 }}
                  onError={() => setMapUrl(null)}
                />
              </div>
            )}

            {/* Lista de paradas */}
            <div className="space-y-2">
              <p className="text-xs text-slate-500 uppercase tracking-widest font-bold px-1">
                Paradas en orden — usa las flechas para ajustar
              </p>
              {sorted.map((bk, idx) => (
                <div key={bk.id} className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
                  <div className="p-4 flex items-start gap-3">
                    {/* Número */}
                    <div className="w-9 h-9 rounded-xl bg-slate-800 flex items-center justify-center font-black text-sm text-sky-400 shrink-0 mt-0.5">
                      {stopLabel(idx)}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-white text-sm leading-tight truncate">{bk.instagram ? `@${bk.instagram.replace(/^@/, "")}` : bk.fullName}</p>
                      {bk.instagram && <p className="text-xs text-slate-400 leading-tight truncate">{bk.fullName}</p>}
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                        {bk.address || "—"}{bk.city ? `, ${bk.city}` : ""}
                      </p>
                      {bk.products && (
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">{bk.products}</p>
                      )}
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        {bk.amount_due > 0 && (
                          <span className="text-[10px] font-black text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-md">
                            Adeudo: ${Number(bk.amount_due).toFixed(2)}
                          </span>
                        )}
                        {buildNavUrl(bk) && (
                          <button
                            onClick={() => openNavigation(bk)}
                            className="text-[10px] font-black text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-md hover:bg-sky-500/20 transition-colors"
                          >
                            📍 Ver en Maps
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setEditForm({ calle: "", numero: "", colonia: "", cp: "", city: "" });
                            setEditingId(bk.id);
                          }}
                          className="text-[10px] font-black text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-md hover:bg-amber-500/20 transition-colors"
                        >
                          ✏️ Editar dirección
                        </button>
                      </div>
                    </div>

                    {/* Flechas */}
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        disabled={idx === 0}
                        onClick={() => moveStop(idx, -1)}
                        className="w-8 h-8 rounded-xl bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-20 flex items-center justify-center font-bold text-sm transition-colors"
                      >
                        ↑
                      </button>
                      <button
                        disabled={idx === sorted.length - 1}
                        onClick={() => moveStop(idx, 1)}
                        className="w-8 h-8 rounded-xl bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white disabled:opacity-20 flex items-center justify-center font-bold text-sm transition-colors"
                      >
                        ↓
                      </button>
                    </div>
                  </div>

                  {/* Inline address editor — Circuit style */}
                  {editingId === bk.id && (
                    <div className="border-t border-slate-800 p-4 space-y-3 bg-slate-950">
                      <p className="text-xs text-amber-400 font-black uppercase tracking-widest">Corregir dirección</p>

                      {/* Google Places search — única entrada */}
                      {apiKey && (
                        <div ref={acContainerRef} className="rounded-xl overflow-hidden min-h-[44px]" />
                      )}

                      {/* Vista previa de la dirección seleccionada */}
                      {editForm.calle && (
                        <div className="bg-slate-800 border border-amber-500/30 rounded-xl px-3 py-2.5">
                          <p className="text-[10px] text-amber-400 font-bold uppercase tracking-wide mb-1">Dirección seleccionada</p>
                          <p className="text-white text-sm leading-relaxed">
                            {[editForm.calle, editForm.numero, editForm.colonia && `Col. ${editForm.colonia}`, editForm.cp, editForm.city].filter(Boolean).join(", ")}
                          </p>
                        </div>
                      )}

                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => setEditingId(null)}
                          className="flex-1 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-bold text-sm hover:bg-slate-700 transition-colors"
                        >
                          Cancelar
                        </button>
                        <button
                          disabled={savingAddress || !editForm.calle}
                          onClick={() => saveAddress(bk.id)}
                          className="flex-1 py-2.5 rounded-xl bg-amber-500 text-slate-900 font-black text-sm hover:bg-amber-400 transition-colors disabled:opacity-40 active:scale-95"
                        >
                          {savingAddress ? "Guardando…" : "Guardar"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
