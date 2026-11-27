"use client";
import { useEffect, useRef, useState } from "react";
import { cargarGoogleMaps } from "@/lib/ruta/googleMaps";

// El mapa de la ruta del repartidor.
//
// Antes esto era una FOTO: una etiqueta <img> con una URL de maps/api/staticmap. Nunca
// se pudo acercar ni mover, y encima la foto se armaba con el TEXTO de cada dirección,
// así que Google adivinaba dónde ponerla. El 26 de noviembre la ruta salió a escala de
// todo el país, de Los Ángeles a Cuba, con dos pines encimados sobre Torreón.
//
// Ahora es un mapa de verdad, con las coordenadas ya resueltas y guardadas. Se encuadra
// solo sobre las paradas del día y se puede acercar, mover y tocar.

const COLORES = {
  entregado: "#10b981",
  no_entregado: "#64748b",
  pendiente: "#ef4444",
};

function colorDe(bk) {
  return COLORES[bk.delivery_status] || COLORES.pendiente;
}

// Un pin redondo con el número de la parada adentro. Se dibuja aquí y no se pide a
// Google: en la calle, cada imagen que el mapa tiene que bajar es tiempo de espera.
function pinDe(color) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="34" height="46" viewBox="0 0 34 46">` +
    `<path d="M17 45C17 45 33 27.5 33 17A16 16 0 1 0 1 17C1 27.5 17 45 17 45Z" ` +
    `fill="${color}" stroke="#0f172a" stroke-width="2"/>` +
    `<circle cx="17" cy="17" r="11" fill="rgba(15,23,42,0.22)"/></svg>`;
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

export default function MapaDeLaRuta({
  paradas,          // [{ id, lat, lng, delivery_status, instagram, fullName, address }]
  etiquetaDe,       // (idx) => "1" | "A"
  origen,           // { lat, lng } — la bodega
  destino,          // { lat, lng }
  apiKey,
  alTocarParada,    // (booking) => void
  respaldoUrl,      // la foto de siempre, por si Google no carga
}) {
  const divRef = useRef(null);
  const mapaRef = useRef(null);
  const marcasRef = useRef([]);
  const [estado, setEstado] = useState("cargando"); // cargando | listo | falla
  // `alTocarParada` cambia de identidad en cada render de la pantalla. Guardarlo en una
  // caja evita volver a dibujar todos los marcadores —y perder el zoom que el repartidor
  // acaba de hacer— nada más porque el padre se repintó.
  const tocarRef = useRef(alTocarParada);
  useEffect(() => { tocarRef.current = alTocarParada; }, [alTocarParada]);

  const ubicadas = paradas.filter((p) => p.lat != null && p.lng != null);
  // Solo redibujar cuando cambie algo que el mapa pinta de verdad.
  const firma = ubicadas.map((p) => `${p.id}:${p.lat},${p.lng}:${p.delivery_status}`).join("|");

  useEffect(() => {
    let vivo = true;
    cargarGoogleMaps(apiKey)
      .then((maps) => {
        if (!vivo || !divRef.current) return;
        if (!mapaRef.current) {
          mapaRef.current = new maps.Map(divRef.current, {
            center: origen,
            zoom: 12,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
            zoomControl: true,
            // En un celular el mapa va dentro de una página que se desplaza: con el
            // ajuste de siempre, arrastrar para ver el mapa arrastra la página entera.
            gestureHandling: "greedy",
            clickableIcons: false,
          });
          // Queda a la mano para poder comprobar desde fuera que el mapa responde
          // —acercarlo, moverlo, leer su encuadre—, que es exactamente lo que el
          // repartidor dijo que no se podía. Ver scripts/e2e-mapa-de-la-ruta.mjs.
          window.__mapaRuta = mapaRef.current;
        }
        setEstado("listo");
      })
      .catch(() => { if (vivo) setEstado("falla"); });
    return () => { vivo = false; };
  }, [apiKey, origen]);

  useEffect(() => {
    const maps = window.google?.maps;
    const mapa = mapaRef.current;
    if (estado !== "listo" || !maps || !mapa) return;

    for (const m of marcasRef.current) m.setMap(null);
    marcasRef.current = [];

    const caja = new maps.LatLngBounds();
    const pon = (pos, opciones) => {
      const m = new maps.Marker({ map: mapa, position: pos, ...opciones });
      marcasRef.current.push(m);
      caja.extend(pos);
      return m;
    };

    pon(origen, {
      title: "Bodega — salida",
      zIndex: 1,
      icon: { url: pinDe("#22c55e"), scaledSize: new maps.Size(30, 40), labelOrigin: new maps.Point(15, 15) },
      label: { text: "B", color: "#fff", fontWeight: "900", fontSize: "13px" },
    });
    if (destino && (destino.lat !== origen.lat || destino.lng !== origen.lng)) {
      pon(destino, {
        title: "Regreso",
        zIndex: 1,
        icon: { url: pinDe("#3b82f6"), scaledSize: new maps.Size(30, 40), labelOrigin: new maps.Point(15, 15) },
        label: { text: "F", color: "#fff", fontWeight: "900", fontSize: "13px" },
      });
    }

    ubicadas.forEach((bk) => {
      const idx = paradas.findIndex((p) => p.id === bk.id);
      const quien = bk.instagram ? `@${String(bk.instagram).replace(/^@/, "")}` : bk.fullName;
      const m = pon({ lat: Number(bk.lat), lng: Number(bk.lng) }, {
        title: `${etiquetaDe(idx)} · ${quien}`,
        zIndex: 10 + idx,
        icon: { url: pinDe(colorDe(bk)), scaledSize: new maps.Size(34, 46), labelOrigin: new maps.Point(17, 17) },
        label: { text: etiquetaDe(idx), color: "#fff", fontWeight: "900", fontSize: "14px" },
      });
      m.addListener("click", () => tocarRef.current?.(bk));
    });

    // Encuadrar sobre las paradas del día. Con una sola, fitBounds acerca hasta la
    // acera y no se entiende nada, así que ahí se fija un acercamiento de barrio.
    if (!caja.isEmpty()) {
      mapa.fitBounds(caja, { top: 40, right: 30, bottom: 30, left: 30 });
      if (marcasRef.current.length <= 2) {
        const unaVez = maps.event.addListenerOnce(mapa, "idle", () => {
          if (mapa.getZoom() > 15) mapa.setZoom(15);
        });
        marcasRef.current.push({ setMap: () => maps.event.removeListener(unaVez) });
      }
    }
  }, [estado, firma, origen, destino, etiquetaDe, paradas, ubicadas]);

  const sinUbicar = paradas.length - ubicadas.length;

  if (estado === "falla") {
    // Sin Google no hay mapa que mover, pero la foto de siempre es mejor que nada:
    // el repartidor ya está en la calle y lo que necesita es ver por dónde va.
    return respaldoUrl ? (
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800">
          <span className="text-sm font-black text-slate-200">Vista de la Ruta</span>
          <span className="text-xs text-amber-400 font-medium block mt-0.5">
            Sin señal para el mapa — esta es una imagen fija
          </span>
        </div>
        <img src={respaldoUrl} alt="Mapa de ruta" className="w-full object-cover" style={{ maxHeight: 320 }} />
      </div>
    ) : null;
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center gap-2 flex-wrap">
        <span className="text-sm font-black text-slate-200">Vista de la Ruta</span>
        <span className="text-xs text-slate-500 font-medium">
          — verde = salida · azul = regreso · rojo = paradas
        </span>
      </div>
      <div className="relative">
        <div ref={divRef} className="w-full" style={{ height: 320 }} />
        {estado === "cargando" && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-900">
            <span className="text-xs text-slate-500 font-bold">Cargando el mapa…</span>
          </div>
        )}
      </div>
      {sinUbicar > 0 && (
        <p className="px-4 py-2 text-xs text-amber-400 font-medium border-t border-slate-800">
          {sinUbicar === 1 ? "1 parada no se pudo ubicar" : `${sinUbicar} paradas no se pudieron ubicar`} —
          siguen en la lista de abajo, pero no salen en el mapa.
        </p>
      )}
    </div>
  );
}
