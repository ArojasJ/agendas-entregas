"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

const ORIGIN = { lat: 25.5464865, lng: -103.4497847 };
const DESTINATION = { lat: 25.572988616868752, lng: -103.51420759387985 };

function getTodayDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function secondsAgo(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
}

export default function LiveTrackingPage() {
  const router = useRouter();
  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const driverMarkerRef = useRef(null);
  const stopMarkersRef = useRef([]);
  const originMarkerRef = useRef(null);
  const destMarkerRef = useRef(null);
  const intervalRef = useRef(null);

  const [bookings, setBookings] = useState([]);
  const [driverLoc, setDriverLoc] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [lastSeen, setLastSeen] = useState(null);
  const [mapReady, setMapReady] = useState(false);
  const [tick, setTick] = useState(0);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  // ── Auth ──────────────────────────────────────────────
  useEffect(() => {
    const role = localStorage.getItem("panelRole");
    if (role !== "admin") { router.push("/panel/entregas"); return; }
    loadAll();
  }, []);

  // ── Tick de "hace X segundos" ─────────────────────────
  useEffect(() => {
    const t = setInterval(() => setTick(n => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const loadAll = async () => {
    const token = localStorage.getItem("panelToken") || "";
    const today = getTodayDate();

    const [resB, resL] = await Promise.all([
      fetch("/api/bookings", { headers: { "x-panel-token": token } }),
      fetch("/api/driver-location", { headers: { "x-panel-token": token } }),
    ]);

    if (resB.ok) {
      const data = await resB.json();
      const todayDom = (data.bookings || []).filter(
        b => b.type === "domicilio" && b.date === today
      );
      setBookings(todayDom);
    }

    if (resL.ok) {
      const data = await resL.json();
      if (data.location) {
        setDriverLoc(data.location);
        setIsActive(data.location.is_active);
        setLastSeen(data.location.updated_at);
      }
    }
  };

  // ── Polling driver location ───────────────────────────
  const pollLocation = useCallback(async () => {
    const token = localStorage.getItem("panelToken") || "";
    const res = await fetch("/api/driver-location", { headers: { "x-panel-token": token } });
    if (!res.ok) return;
    const data = await res.json();
    if (data.location) {
      setDriverLoc(data.location);
      setIsActive(data.location.is_active);
      setLastSeen(data.location.updated_at);
    }
  }, []);

  useEffect(() => {
    intervalRef.current = setInterval(pollLocation, 5000);
    return () => clearInterval(intervalRef.current);
  }, [pollLocation]);

  // ── Cargar Google Maps ────────────────────────────────
  useEffect(() => {
    if (!apiKey || mapReady) return;

    const cbName = "__liveMapReady";
    window[cbName] = () => {
      if (!mapRef.current) return;
      const map = new window.google.maps.Map(mapRef.current, {
        center: ORIGIN,
        zoom: 12,
        mapTypeId: "roadmap",
        styles: [
          { elementType: "geometry", stylers: [{ color: "#1e293b" }] },
          { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
          { elementType: "labels.text.stroke", stylers: [{ color: "#1e293b" }] },
          { featureType: "road", elementType: "geometry", stylers: [{ color: "#334155" }] },
          { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#475569" }] },
          { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#64748b" }] },
          { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f172a" }] },
          { featureType: "poi", stylers: [{ visibility: "off" }] },
          { featureType: "transit", stylers: [{ visibility: "off" }] },
        ],
        disableDefaultUI: true,
        zoomControl: true,
        gestureHandling: "greedy",
      });
      mapInstanceRef.current = map;

      // Marcador origen
      originMarkerRef.current = new window.google.maps.Marker({
        position: ORIGIN,
        map,
        title: "Punto de salida",
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#22c55e",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        zIndex: 10,
      });

      // Marcador destino
      destMarkerRef.current = new window.google.maps.Marker({
        position: DESTINATION,
        map,
        title: "Punto de llegada",
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: "#3b82f6",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
        },
        zIndex: 10,
      });

      setMapReady(true);
      delete window[cbName];
    };

    if (window.google?.maps) {
      window[cbName]();
      return;
    }

    if (!document.getElementById("gm-live-script")) {
      const s = document.createElement("script");
      s.id = "gm-live-script";
      s.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&language=es&callback=${cbName}`;
      s.async = true;
      document.head.appendChild(s);
    }
  }, [apiKey]);

  // ── Actualizar marcadores de paradas ──────────────────
  useEffect(() => {
    if (!mapReady || !window.google || bookings.length === 0) return;

    stopMarkersRef.current.forEach(m => m.setMap(null));
    stopMarkersRef.current = [];

    const pendingOnly = bookings.filter(b => b.delivery_status !== "entregado");
    const deliveredOnly = bookings.filter(b => b.delivery_status === "entregado");

    [...pendingOnly, ...deliveredOnly].forEach((bk, idx) => {
      const isDelivered = bk.delivery_status === "entregado";
      const addressParts = [bk.address, bk.city, bk.state].filter(Boolean).join(", ");
      if (!addressParts && !bk.location_url) return;

      const label = isDelivered ? "✓" : String(pendingOnly.indexOf(bk) + 1);
      const color = isDelivered ? "#22c55e" : "#ef4444";

      const geocoder = new window.google.maps.Geocoder();
      geocoder.geocode({ address: addressParts, region: "mx" }, (results, status) => {
        if (status !== "OK" || !results[0]) return;
        const pos = results[0].geometry.location;
        const marker = new window.google.maps.Marker({
          position: pos,
          map: mapInstanceRef.current,
          title: bk.fullName || bk.instagram || "",
          label: {
            text: label,
            color: "#fff",
            fontWeight: "bold",
            fontSize: "11px",
          },
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: "#fff",
            strokeWeight: 2,
          },
          zIndex: isDelivered ? 5 : 20,
        });

        const info = new window.google.maps.InfoWindow({
          content: `<div style="color:#000;font-size:13px;font-weight:bold;padding:4px 8px;max-width:200px">
            ${bk.instagram ? `@${bk.instagram.replace(/^@/, "")}` : bk.fullName}<br>
            <span style="font-weight:normal;font-size:11px">${bk.address || ""}</span>
            ${bk.products ? `<br><span style="color:#6b7280;font-size:10px">${bk.products}</span>` : ""}
            ${isDelivered ? '<br><span style="color:#16a34a;font-weight:bold">✓ Entregado</span>' : ""}
          </div>`,
        });
        marker.addListener("click", () => info.open(mapInstanceRef.current, marker));
        stopMarkersRef.current.push(marker);
      });
    });
  }, [mapReady, bookings]);

  // ── Actualizar marcador de la repartidora ─────────────
  useEffect(() => {
    if (!mapReady || !window.google || !driverLoc || !driverLoc.lat) return;
    const pos = { lat: Number(driverLoc.lat), lng: Number(driverLoc.lng) };

    if (driverMarkerRef.current) {
      driverMarkerRef.current.setPosition(pos);
    } else {
      driverMarkerRef.current = new window.google.maps.Marker({
        position: pos,
        map: mapInstanceRef.current,
        title: "Repartidora",
        icon: {
          path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 6,
          fillColor: "#38bdf8",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 2,
          rotation: 0,
        },
        zIndex: 100,
      });
    }

    if (isActive) {
      mapInstanceRef.current.panTo(pos);
    }
  }, [mapReady, driverLoc, isActive]);

  // ── Stats ─────────────────────────────────────────────
  const pending = bookings.filter(b => b.delivery_status !== "entregado");
  const delivered = bookings.filter(b => b.delivery_status === "entregado");
  const secs = secondsAgo(lastSeen);
  const freshLocation = secs !== null && secs < 30;

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => router.push("/panel/entregas")}
            className="text-slate-400 hover:text-white text-sm font-bold flex items-center gap-2"
          >
            ← Entregas
          </button>
          <h1 className="font-black text-sm uppercase tracking-widest text-slate-200">
            📍 Ruta en Vivo
          </h1>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isActive && freshLocation ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
            <span className="text-xs text-slate-400">
              {isActive && freshLocation
                ? `Activa · hace ${secs}s`
                : isActive
                ? `Sin señal · hace ${secs ?? "—"}s`
                : "Repartidora no compartiendo"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row flex-1 max-w-7xl mx-auto w-full gap-0 lg:gap-4 p-0 lg:p-4">

        {/* Mapa */}
        <div className="flex-1 relative">
          {!apiKey && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-900 text-slate-400 text-sm">
              API key de Google Maps no configurada
            </div>
          )}
          <div
            ref={mapRef}
            className="w-full"
            style={{ height: "calc(100vh - 57px)" }}
          />
          {!mapReady && apiKey && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
              <div className="w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {/* Leyenda */}
          {mapReady && (
            <div className="absolute bottom-4 left-4 bg-slate-900/90 border border-slate-700 rounded-2xl px-4 py-3 space-y-1.5 backdrop-blur-sm">
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span className="w-3 h-3 rounded-full bg-sky-400 inline-block" />
                Repartidora (en vivo)
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
                Pendiente de entrega
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" />
                Entregado
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span className="w-3 h-3 rounded-full bg-emerald-400 inline-block" />
                Salida
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />
                Llegada
              </div>
            </div>
          )}
        </div>

        {/* Panel lateral */}
        <div className="w-full lg:w-80 bg-slate-900 border-t lg:border-t-0 lg:border-l border-slate-800 flex flex-col overflow-y-auto" style={{ maxHeight: "calc(100vh - 57px)" }}>

          {/* Resumen */}
          <div className="p-4 border-b border-slate-800 grid grid-cols-2 gap-3">
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-center">
              <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-1">Pendientes</p>
              <p className="text-2xl font-black text-amber-400">{pending.length}</p>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 text-center">
              <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1">Entregados</p>
              <p className="text-2xl font-black text-emerald-400">{delivered.length}</p>
            </div>
          </div>

          {/* Estado repartidora */}
          <div className="px-4 py-3 border-b border-slate-800">
            <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Estado</p>
            <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border ${isActive && freshLocation ? "bg-emerald-500/10 border-emerald-500/20" : "bg-slate-800 border-slate-700"}`}>
              <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${isActive && freshLocation ? "bg-emerald-400 animate-pulse" : "bg-slate-600"}`} />
              <div>
                <p className={`text-sm font-bold ${isActive && freshLocation ? "text-emerald-300" : "text-slate-400"}`}>
                  {isActive && freshLocation ? "Compartiendo ubicación" : isActive ? "Sin señal reciente" : "GPS no activo"}
                </p>
                {lastSeen && (
                  <p className="text-[10px] text-slate-500">
                    Última señal: hace {secs ?? "—"}s
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Lista de paradas */}
          <div className="flex-1 overflow-y-auto">
            {bookings.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">Sin entregas a domicilio hoy</div>
            ) : (
              <div>
                {pending.length > 0 && (
                  <div>
                    <p className="px-4 py-2 text-[10px] font-black text-amber-400 uppercase tracking-widest bg-slate-950/50">
                      Pendientes — {pending.length}
                    </p>
                    {pending.map((bk, idx) => (
                      <div key={bk.id} className="px-4 py-3 border-b border-slate-800 flex items-start gap-3 hover:bg-slate-800/50 transition-colors">
                        <span className="w-6 h-6 rounded-lg bg-red-500 text-white text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">
                          {idx + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-white truncate">
                            {bk.instagram ? `@${bk.instagram.replace(/^@/, "")}` : bk.fullName}
                          </p>
                          {bk.instagram && <p className="text-[10px] text-slate-400 truncate">{bk.fullName}</p>}
                          <p className="text-[10px] text-slate-500 mt-0.5 truncate">{bk.address || "—"}{bk.city ? `, ${bk.city}` : ""}</p>
                          {bk.amount_due > 0 && (
                            <p className="text-[10px] font-black text-rose-400 mt-1">Adeudo: ${Number(bk.amount_due).toFixed(2)}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {delivered.length > 0 && (
                  <div>
                    <p className="px-4 py-2 text-[10px] font-black text-emerald-400 uppercase tracking-widest bg-slate-950/50">
                      Entregados — {delivered.length}
                    </p>
                    {delivered.map((bk) => (
                      <div key={bk.id} className="px-4 py-3 border-b border-slate-800 flex items-start gap-3 opacity-60">
                        <span className="w-6 h-6 rounded-lg bg-emerald-600 text-white text-[11px] font-black flex items-center justify-center shrink-0 mt-0.5">
                          ✓
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-300 truncate">
                            {bk.instagram ? `@${bk.instagram.replace(/^@/, "")}` : bk.fullName}
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5 truncate">{bk.address || "—"}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Botón refrescar */}
          <div className="p-4 border-t border-slate-800">
            <button
              onClick={loadAll}
              className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-sm font-bold transition-colors"
            >
              ↺ Actualizar lista de paradas
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
