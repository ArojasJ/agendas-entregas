"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// PREPARACIÓN DE PAQUETES
//
// Se prepara un paquete a la vez, como si fuera una ruta: cuántos faltan, iniciar, y
// de ahí en adelante el sistema va preguntando. Lo que resuelve es que las entregas
// no traían ligados los productos (casi ninguna), así que marcar entregado no movía
// nada; y que la caja se liberaba hasta la entrega cuando en realidad queda libre
// desde que se arma el paquete.

const TIPOS = [
  { v: "domicilio", t: "Domicilio", icono: "🛵" },
  { v: "paqueteria", t: "Paquetería", icono: "📮" },
  { v: "bodega", t: "Bodega", icono: "🏬" },
];

const token = () => (typeof window !== "undefined" ? localStorage.getItem("panelToken") || "" : "");

const pesos = (n) =>
  "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function hoyLocal() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function dondeEsta(p) {
  if (p.ubicacion === "paquete") return { txt: "Ya en este paquete", cls: "bg-indigo-50 text-indigo-600 border-indigo-200" };
  if (p.ubicacion === "caja" && p.caja != null) return { txt: `📦 Caja ${p.caja}`, cls: "bg-amber-50 text-amber-700 border-amber-200" };
  if (p.ubicacion === "estante") return { txt: "🏷️ Estante", cls: "bg-rose-50 text-rose-600 border-rose-200" };
  return { txt: "Sin lugar anotado", cls: "bg-slate-50 text-slate-500 border-slate-200" };
}

export default function PreparacionPage() {
  const router = useRouter();
  const [tipo, setTipo] = useState("domicilio");
  const [fecha, setFecha] = useState(hoyLocal());
  const [paquetes, setPaquetes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [recarga, setRecarga] = useState(0);

  // El paquete que se está preparando ahora
  const [abierto, setAbierto] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [clienta, setClienta] = useState(null);
  const [elegidos, setElegidos] = useState([]);
  const [buscando, setBuscando] = useState("");
  const [resultados, setResultados] = useState(null);
  const [cajas, setCajas] = useState(null);
  const [juntarEn, setJuntarEn] = useState(null);
  // El envío no sale de ninguna venta: lo pone quien prepara el paquete.
  const [envio, setEnvio] = useState("");
  const [trabajando, setTrabajando] = useState(false);
  const [aviso, setAviso] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem("panelAuth") !== "true") { router.push("/panel"); return; }
    // El tipo viene en la liga desde Entregas, para caer en la pestaña que se estaba
    // viendo. Se lee de la dirección y no con useSearchParams para no tener que
    // envolver la pantalla en un Suspense por un solo parámetro.
    const q = new URLSearchParams(window.location.search);
    const t = q.get("tipo");
    if (t && TIPOS.some((x) => x.v === t)) setTipo(t);
    const f = q.get("fecha");
    if (f && /^\d{4}-\d{2}-\d{2}$/.test(f)) setFecha(f);
  }, [router]);

  // Cada carga desecha su resultado si mientras tanto cambió la fecha o la pestaña.
  // Sin esto, la respuesta de la consulta anterior llegaba después y pisaba a la
  // nueva: la pantalla decía una fecha y enseñaba las entregas de otra.
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    (async () => {
      try {
        const r = await fetch(`/api/panel/paquetes?fecha=${fecha}&tipo=${tipo}`, {
          headers: { "x-panel-token": token() },
        });
        const d = await r.json();
        if (vivo) setPaquetes(d.paquetes || []);
      } catch {
        if (vivo) setPaquetes([]);
      }
      if (vivo) setCargando(false);
    })();
    return () => { vivo = false; };
  }, [fecha, tipo, recarga]);

  const cargar = useCallback(() => setRecarga((n) => n + 1), []);

  const abrir = async (bk) => {
    setAbierto(bk);
    setDetalle(null); setClienta(null); setElegidos([]); setCajas(null);
    setJuntarEn(null); setResultados(null); setBuscando(""); setAviso("");
    // Si ya traía algo anotado a cobrar, se respeta como punto de partida del envío.
    setEnvio(Number(bk.amount_due) > 0 ? String(bk.amount_due) : "");
    const r = await fetch(`/api/panel/paquetes?bookingId=${bk.id}`, { headers: { "x-panel-token": token() } });
    const d = await r.json();
    setDetalle(d);
    if (d.ligadaA) {
      const yaEs = (d.candidatas || []).find((c) => c.id === d.ligadaA);
      setClienta(yaEs || { id: d.ligadaA, name: "Clienta ligada" });
      setElegidos(d.yaEnElPaquete || []);
    }
  };

  const cerrar = () => { setAbierto(null); setDetalle(null); cargar(); };

  const ligar = async (c) => {
    setClienta(c);
    setAviso("");
    const r = await fetch(`/api/panel/paquetes?clientId=${c.id}`, { headers: { "x-panel-token": token() } });
    const d = await r.json();
    setDetalle((prev) => ({ ...prev, productos: d.productos || [] }));
    setElegidos((d.productos || []).filter((p) => p.ubicacion === "paquete").map((p) => p.itemId));
  };

  const buscar = async () => {
    if (buscando.trim().length < 3) return;
    const r = await fetch(`/api/panel/paquetes?bookingId=${abierto.id}`, { headers: { "x-panel-token": token() } });
    const d = await r.json();
    const q = buscando.trim().toLowerCase();
    setResultados((d.candidatas || []).filter(
      (c) => (c.name || "").toLowerCase().includes(q) ||
             (c.instagram || "").toLowerCase().includes(q) ||
             (c.phone || "").includes(q)
    ));
  };

  // Cada vez que cambia lo que se lleva, se recalcula cómo quedan las cajas.
  useEffect(() => {
    if (!clienta) { setCajas(null); return; }
    let vivo = true;
    (async () => {
      const r = await fetch("/api/panel/paquetes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token() },
        body: JSON.stringify({ accion: "simular", clientId: clienta.id, itemIds: elegidos, envio }),
      });
      const d = await r.json();
      if (vivo) { setCajas(d); if (!d.hayQueJuntar) setJuntarEn(null); }
    })();
    return () => { vivo = false; };
  }, [clienta, elegidos, envio]);

  const palomear = (itemId) =>
    setElegidos((prev) => prev.includes(itemId) ? prev.filter((i) => i !== itemId) : [...prev, itemId]);

  const armar = async () => {
    if (trabajando) return;
    if (elegidos.length === 0) { setAviso("Palomea al menos un producto."); return; }
    if (cajas?.hayQueJuntar && !juntarEn) { setAviso("Dime en qué caja dejas lo que sobra."); return; }
    setTrabajando(true); setAviso("");
    try {
      const r = await fetch("/api/panel/paquetes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token() },
        body: JSON.stringify({
          accion: "armar", bookingId: abierto.id, clientId: clienta.id,
          itemIds: elegidos, juntarRestosEn: juntarEn, envio,
        }),
      });
      const d = await r.json();
      if (!r.ok) { setAviso(d.message || "No se pudo armar."); return; }
      cerrar();
    } finally { setTrabajando(false); }
  };

  const malAgendada = async () => {
    if (!confirm("¿Borrar esta entrega? No corresponde a ninguna clienta y desaparecerá de la lista.")) return;
    setTrabajando(true);
    try {
      const r = await fetch("/api/panel/paquetes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token() },
        body: JSON.stringify({ accion: "mal_agendada", bookingId: abierto.id }),
      });
      const d = await r.json();
      if (!r.ok) { setAviso(d.message || "No se pudo borrar."); return; }
      cerrar();
    } finally { setTrabajando(false); }
  };

  const deshacer = async () => {
    setTrabajando(true);
    try {
      await fetch("/api/panel/paquetes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token() },
        body: JSON.stringify({ accion: "deshacer", bookingId: abierto.id, clientId: clienta?.id }),
      });
      cerrar();
    } finally { setTrabajando(false); }
  };

  const faltan = paquetes.filter((p) => !p.listo);
  const listos = paquetes.filter((p) => p.listo);
  const productos = detalle?.productos || [];
  const indice = abierto ? paquetes.findIndex((p) => p.id === abierto.id) + 1 : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto px-4 py-6">
        <div className="flex items-center gap-3 mb-5">
          <Link href="/panel/entregas" className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-50">←</Link>
          <div>
            <h1 className="text-2xl font-black text-slate-900">Preparación de paquetes</h1>
            <p className="text-xs text-slate-400">Arma el paquete y la caja se libera sola</p>
          </div>
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
          {TIPOS.map((t) => (
            <button key={t.v} onClick={() => setTipo(t.v)}
              className={`px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
                tipo === t.v ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
              {t.icono} {t.t}
            </button>
          ))}
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)}
            className="ml-auto px-3 py-2 rounded-xl bg-white border border-slate-200 text-sm text-slate-700" />
        </div>

        {cargando ? (
          <p className="text-sm text-slate-400 py-10 text-center">Cargando…</p>
        ) : paquetes.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
            <p className="text-4xl mb-2">📦</p>
            <p className="font-bold text-slate-700">Nada que preparar</p>
            <p className="text-sm text-slate-400 mt-1">No hay entregas de este tipo para ese día.</p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4 mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Paquetes por preparar</p>
                <p className="text-3xl font-black text-slate-900 tabular-nums">{faltan.length}</p>
              </div>
              {listos.length > 0 && (
                <p className="text-xs text-emerald-600 font-bold">{listos.length} ya listo{listos.length === 1 ? "" : "s"}</p>
              )}
              {faltan.length > 0 && (
                <button onClick={() => abrir(faltan[0])}
                  className="px-5 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white font-black shadow-lg shadow-emerald-500/20 active:scale-95 transition-all">
                  Iniciar preparación
                </button>
              )}
            </div>

            <div className="space-y-2">
              {paquetes.map((p, i) => (
                <button key={p.id} onClick={() => abrir(p)}
                  className="w-full text-left bg-white rounded-2xl border border-slate-200 px-5 py-3.5 hover:border-slate-300 transition-colors flex items-center gap-3">
                  <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 text-xs font-black flex items-center justify-center shrink-0">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-slate-800 truncate">
                      {p.fullName || p.instagram || "Sin nombre"}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {p.instagram ? `@${String(p.instagram).replace(/^@/, "")}` : "sin usuario"}
                      {p.products ? ` · ${String(p.products).split("\n")[0]}` : " · sin productos anotados"}
                    </p>
                  </div>
                  {p.listo ? (
                    <span className="shrink-0 px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200 text-[10px] font-black uppercase">
                      ✓ Armado ({p.productosEnPaquete})
                    </span>
                  ) : (
                    <span className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-50 text-amber-600 border border-amber-200 text-[10px] font-black uppercase">
                      Por armar
                    </span>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Preparando un paquete ── */}
      {abierto && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-white w-full sm:max-w-2xl sm:rounded-3xl rounded-t-3xl shadow-2xl flex flex-col max-h-[92vh]">
            <div className="px-6 pt-5 pb-3 border-b border-slate-100 shrink-0 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Paquete {indice} de {paquetes.length}
                </p>
                <h2 className="text-lg font-black text-slate-900 truncate">
                  {abierto.fullName || abierto.instagram || "Sin nombre"}
                </h2>
                <p className="text-xs text-slate-400 truncate">
                  {abierto.instagram ? `@${String(abierto.instagram).replace(/^@/, "")}` : "sin usuario"}
                  {abierto.phone ? ` · ${abierto.phone}` : ""}
                </p>
              </div>
              <button onClick={cerrar} className="text-slate-400 hover:text-slate-600 text-xl shrink-0">✕</button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
              {abierto.products && (
                <div className="rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Lo que escribió la clienta</p>
                  <p className="text-sm text-slate-700 whitespace-pre-line">{abierto.products}</p>
                  {Number(abierto.amount_due) > 0 && (
                    <p className="text-xs text-amber-700 font-bold mt-1.5">
                      Anotado a cobrar: {pesos(abierto.amount_due)}
                    </p>
                  )}
                </div>
              )}

              {!detalle ? (
                <p className="text-sm text-slate-400 text-center py-6">Buscando a la clienta…</p>
              ) : !clienta ? (
                <>
                  <div>
                    <p className="text-sm font-bold text-slate-800 mb-1">¿De quién es este paquete?</p>
                    <p className="text-xs text-slate-400 mb-3">
                      La entrega trae {abierto.instagram ? <b>@{String(abierto.instagram).replace(/^@/, "")}</b> : "un usuario vacío"}.
                      Estas son las clientas que coinciden en tu sistema.
                    </p>
                  </div>

                  {(resultados ?? detalle.candidatas ?? []).length === 0 ? (
                    <p className="text-sm text-slate-400 py-3">No coincide con ninguna clienta.</p>
                  ) : (
                    <div className="space-y-2">
                      {(resultados ?? detalle.candidatas).map((c) => (
                        <button key={c.id} onClick={() => ligar(c)}
                          className={`w-full text-left rounded-2xl border px-4 py-3 transition-colors ${
                            c.seguro ? "bg-emerald-50 border-emerald-200 hover:border-emerald-400"
                                     : "bg-white border-slate-200 hover:border-slate-400"}`}>
                          <p className="font-bold text-slate-800">{c.name || "Sin nombre"}</p>
                          <p className="text-xs text-slate-500">
                            {c.instagram ? `@${String(c.instagram).replace(/^@/, "")}` : "sin usuario"} · {c.razon}
                          </p>
                          <p className="text-xs mt-1">
                            {c.pendientes > 0 ? (
                              <span className="font-bold text-emerald-700">
                                {c.pendientes} producto{c.pendientes === 1 ? "" : "s"} esperando
                                {c.cajas?.length > 0 && ` · caja ${c.cajas.join(", ")}`}
                              </span>
                            ) : (
                              <span className="text-slate-400">sin productos pendientes</span>
                            )}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="pt-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1.5">¿No es ninguna? Búscala</p>
                    <div className="flex gap-2">
                      <input value={buscando} onChange={(e) => setBuscando(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); buscar(); } }}
                        placeholder="Nombre, usuario o teléfono…"
                        className="flex-1 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:border-slate-400" />
                      <button onClick={buscar} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold">Buscar</button>
                    </div>
                  </div>

                  <button onClick={malAgendada} disabled={trabajando}
                    className="w-full py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-600 text-sm font-bold hover:bg-red-100 transition-colors disabled:opacity-50">
                    Esta entrega está mal agendada — borrarla
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm">
                      <span className="text-slate-400">Paquete de</span>{" "}
                      <b className="text-slate-800">{clienta.name}</b>
                    </p>
                    <button onClick={() => { setClienta(null); setElegidos([]); }}
                      className="text-xs text-slate-400 hover:text-slate-600 underline">cambiar</button>
                  </div>

                  {productos.length === 0 ? (
                    <p className="text-sm text-slate-400 py-4">Esta clienta no tiene productos esperando.</p>
                  ) : (
                    <div>
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">
                        ¿Qué se lleva? ({elegidos.length} de {productos.length})
                      </p>
                      <div className="space-y-2">
                        {productos.map((p) => {
                          const d = dondeEsta(p);
                          const puesto = elegidos.includes(p.itemId);
                          return (
                            <button key={p.itemId} onClick={() => palomear(p.itemId)}
                              className={`w-full text-left rounded-2xl border px-4 py-3 flex items-start gap-3 transition-colors ${
                                puesto ? "bg-emerald-50 border-emerald-300" : "bg-white border-slate-200 hover:border-slate-300"}`}>
                              <span className={`mt-0.5 w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center text-[11px] font-black ${
                                puesto ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 text-transparent"}`}>✓</span>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold text-slate-800 leading-snug">
                                  {p.cantidad > 1 && <span className="text-slate-400">{p.cantidad}× </span>}{p.nombre}
                                </p>
                                <div className="flex items-center gap-2 flex-wrap mt-1">
                                  <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${d.cls}`}>{d.txt}</span>
                                  {p.deLaCompra.liquidada ? (
                                    <span className="px-2 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-600 text-[10px] font-bold">Liquidado</span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-md border border-amber-200 bg-amber-50 text-amber-700 text-[10px] font-bold">
                                      Debe {pesos(p.deLaCompra.debe)} de esta compra
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Qué se le cobra al entregar. Esto es lo que se escribe solo en la
                      tarjeta de la entrega, para que nadie lo teclee a mano. */}
                  {cajas?.cobro && elegidos.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 space-y-2">
                      <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">A cobrar en la entrega</p>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-500">
                          Debe de {cajas.cobro.compras === 1 ? "su compra" : `sus ${cajas.cobro.compras} compras`}
                        </span>
                        <span className={`font-black tabular-nums ${cajas.cobro.debeMercancia > 0 ? "text-amber-700" : "text-emerald-600"}`}>
                          {cajas.cobro.debeMercancia > 0 ? pesos(cajas.cobro.debeMercancia) : "Nada, todo liquidado"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-500">Envío</span>
                        <div className="relative w-32">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                          <input type="text" inputMode="decimal" value={envio} placeholder="0"
                            onChange={(e) => setEnvio(e.target.value)}
                            className="w-full pl-6 pr-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-sm text-right font-bold text-slate-800 focus:outline-none focus:border-slate-400" />
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                        <span className="text-xs font-black uppercase tracking-wider text-slate-500">Total</span>
                        <span className="text-xl font-black text-slate-900 tabular-nums">{pesos(cajas.cobro.aCobrar)}</span>
                      </div>
                    </div>
                  )}

                  {/* Cómo quedan las cajas */}
                  {cajas && elegidos.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-2">
                      {cajas.seLiberan.length > 0 && (
                        <p className="text-sm text-emerald-700 font-bold">
                          ✓ Se libera{cajas.seLiberan.length === 1 ? "" : "n"} la caja {cajas.seLiberan.join(", ")}
                        </p>
                      )}
                      {cajas.cajasConRestos.length > 0 && !cajas.hayQueJuntar && (
                        <p className="text-sm text-amber-700">
                          Le queda{cajas.quedaGuardado.length === 1 ? "" : "n"}{" "}
                          <b>{cajas.quedaGuardado.length} producto{cajas.quedaGuardado.length === 1 ? "" : "s"}</b>{" "}
                          en la caja {cajas.cajasConRestos.join(", ")}, así que esa no se libera.
                        </p>
                      )}
                      {cajas.hayQueJuntar && (
                        <div>
                          <p className="text-sm text-amber-800 font-bold mb-2">
                            Le queda mercancía repartida en las cajas {cajas.cajasConRestos.join(" y ")}.
                            ¿En cuál la dejas?
                          </p>
                          <div className="flex gap-2 flex-wrap">
                            {cajas.cajasConRestos.map((n) => (
                              <button key={n} onClick={() => setJuntarEn(n)}
                                className={`px-3 py-1.5 rounded-lg text-sm font-bold border transition-colors ${
                                  juntarEn === n ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`}>
                                Caja {n}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {cajas.seLiberan.length === 0 && cajas.cajasConRestos.length === 0 && (
                        <p className="text-sm text-slate-500">No había nada guardado en cajas.</p>
                      )}
                    </div>
                  )}

                  {aviso && (
                    <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{aviso}</p>
                  )}
                </>
              )}
            </div>

            {clienta && (
              <div className="shrink-0 px-6 py-4 border-t border-slate-100 flex gap-2">
                {detalle?.yaEnElPaquete?.length > 0 && (
                  <button onClick={deshacer} disabled={trabajando}
                    className="px-4 py-3 rounded-2xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50 disabled:opacity-50">
                    Deshacer
                  </button>
                )}
                <button onClick={armar} disabled={trabajando || elegidos.length === 0}
                  className="flex-1 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-white font-black shadow-lg shadow-emerald-500/20 disabled:opacity-50 active:scale-95 transition-all">
                  {trabajando ? "Guardando…" : `Armar paquete (${elegidos.length})`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
