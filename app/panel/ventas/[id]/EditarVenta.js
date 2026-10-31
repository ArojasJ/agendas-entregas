"use client";
import { useEffect, useMemo, useState } from "react";

const pesos = (n) => Math.round(Number(n || 0) * 100) / 100;
const money = (n) => "$" + pesos(n).toFixed(2);

// Corregir una venta sin tener que borrarla y rehacerla.
export default function EditarVenta({ sale, onClose, onSaved, showToast }) {
  const [items, setItems] = useState([]);
  const [discount, setDiscount] = useState(pesos(sale.discount));
  const [catalogo, setCatalogo] = useState([]);
  const [cargandoCatalogo, setCargandoCatalogo] = useState(true);
  const [busca, setBusca] = useState("");
  const [resolucion, setResolucion] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    setItems(
      (sale.sale_items || []).map((it, i) => ({
        clave: it.id || "nuevo" + i,
        id: it.id,
        product_id: it.product_id,
        variant_id: it.variant_id || null,
        nombre: it.products?.name || "Producto borrado",
        variante: it.product_variants?.name || null,
        quantity: it.quantity,
        unit_price: pesos(it.unit_price),
        entregado: it.delivery_status === "delivered",
      }))
    );
  }, [sale]);

  useEffect(() => {
    const token = localStorage.getItem("panelToken") || "";
    fetch("/api/products", { headers: { "x-panel-token": token } })
      .then((r) => (r.ok ? r.json() : { products: [] }))
      .then((d) => setCatalogo(d.products || []))
      .catch(() => setCatalogo([]))
      .finally(() => setCargandoCatalogo(false));
  }, []);

  // El precio de catálogo de hoy, para avisar cuando el renglón no coincide
  const precioDeCatalogo = useMemo(() => {
    const m = new Map();
    for (const p of catalogo) {
      m.set(p.id + "|", Number(p.price));
      for (const v of p.product_variants || []) m.set(p.id + "|" + v.id, Number(v.price));
    }
    return m;
  }, [catalogo]);

  const subtotal = pesos(items.reduce((s, i) => s + Number(i.unit_price || 0) * Number(i.quantity || 0), 0));
  const descuento = pesos(Math.max(0, Number(discount) || 0));
  const nuevoTotal = pesos(Math.max(0, subtotal - descuento));
  const abonos = pesos((sale.payments || []).reduce((s, p) => s + Number(p.amount), 0));

  // Una venta pagada con saldo a favor guarda el total completo pero en el enganche
  // solo el efectivo: ese hueco es el saldo que se le descontó, y cuenta como pagado.
  // Sin esto la pantalla diría "faltan" en una venta que ya está cubierta.
  const saldoCubierto =
    sale.status === "paid"
      ? Math.max(0, pesos(Number(sale.total) - Number(sale.down_payment || 0) - abonos))
      : 0;

  const pagado = pesos(Number(sale.down_payment || 0) + abonos + saldoCubierto);
  const diferencia = pesos(pagado - nuevoTotal);

  // En una venta a crédito, deber dinero es lo normal, no un faltante que cobrar.
  // Si aquí se diera por buena la opción de "ya me pagó", bastaría con guardar para
  // dar por liquidada una venta que la clienta todavía no termina de pagar.
  const eraCredito = sale.status === "credit";

  // Al cambiar el sentido de la diferencia, la opción marcada deja de tener sentido
  useEffect(() => {
    if (diferencia > 0) setResolucion((r) => (r === "devolver" || r === "saldo" ? r : "devolver"));
    else if (diferencia < 0)
      setResolucion((r) => (r === "cobrar" || r === "credito" ? r : eraCredito ? "credito" : "cobrar"));
    else setResolucion(null);
  }, [diferencia, eraCredito]);

  const resultados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (q.length < 2) return [];
    const salida = [];
    for (const p of catalogo) {
      const coincide = p.name?.toLowerCase().includes(q) || (p.barcode && p.barcode.includes(busca.trim()));
      const variantes = p.product_variants || [];
      if (variantes.length > 0) {
        for (const v of variantes) {
          if (!coincide && !v.name?.toLowerCase().includes(q) && !(v.barcode && v.barcode.includes(busca.trim()))) continue;
          salida.push({
            product_id: p.id, variant_id: v.id, nombre: p.name, variante: v.name,
            precio: Number(v.price), stock: Number(v.stock || 0),
          });
        }
      } else if (coincide) {
        salida.push({
          product_id: p.id, variant_id: null, nombre: p.name, variante: null,
          precio: Number(p.price), stock: Number(p.stock || 0),
        });
      }
      if (salida.length >= 20) break;
    }
    return salida;
  }, [busca, catalogo]);

  const cambiarCantidad = (clave, delta) =>
    setItems((prev) =>
      prev.map((i) => {
        if (i.clave !== clave) return i;
        const nueva = Number(i.quantity) + delta;
        if (nueva < 1) return i;
        if (i.entregado && nueva < i.quantity) return i;
        return { ...i, quantity: nueva };
      })
    );

  const cambiarPrecio = (clave, valor) =>
    setItems((prev) => prev.map((i) => (i.clave === clave ? { ...i, unit_price: valor } : i)));

  const quitar = (clave) => setItems((prev) => prev.filter((i) => i.clave !== clave));

  const agregar = (r) => {
    setItems((prev) => {
      const yaEsta = prev.find((i) => i.product_id === r.product_id && (i.variant_id || null) === r.variant_id);
      if (yaEsta) return prev.map((i) => (i === yaEsta ? { ...i, quantity: i.quantity + 1 } : i));
      return [...prev, {
        clave: "nuevo-" + r.product_id + "-" + (r.variant_id || "") + "-" + Date.now(),
        id: null, product_id: r.product_id, variant_id: r.variant_id,
        nombre: r.nombre, variante: r.variante, quantity: 1, unit_price: r.precio, entregado: false,
      }];
    });
    setBusca("");
  };

  const guardar = async () => {
    if (items.length === 0) return showToast("La venta no puede quedarse sin productos", "error");
    for (const i of items) {
      if (!(Number(i.unit_price) >= 0)) return showToast(`Revisa el precio de "${i.nombre}"`, "error");
    }
    setGuardando(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/sales/${sale.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({
          action: "edit",
          discount: descuento,
          resolucion: resolucion ? { tipo: resolucion } : {},
          items: items.map((i) => ({
            id: i.id || undefined,
            product_id: i.product_id,
            variant_id: i.variant_id,
            quantity: Number(i.quantity),
            unit_price: pesos(i.unit_price),
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) return showToast(data.message || "No se pudo guardar", "error");

      if (data.devuelto > 0) showToast(`Listo. Devuélvele ${money(data.devuelto)} a la clienta`, "success");
      else if (data.saldoAcreditado > 0) showToast(`Listo. Le quedaron ${money(data.saldoAcreditado)} a favor`, "success");
      else if (data.cobrado > 0) showToast(`Listo. Cóbrale ${money(data.cobrado)}`, "success");
      else showToast("Venta corregida", "success");

      onSaved();
    } catch {
      showToast("Error de conexión", "error");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-3xl rounded-t-3xl shadow-2xl flex flex-col max-h-[92vh] sm:max-h-[88vh]">
        <div className="shrink-0 p-5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-lg font-black text-slate-900">Editar venta</h2>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-500">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div className="space-y-3">
            {items.map((i) => {
              const catalogoPrecio = precioDeCatalogo.get(i.product_id + "|" + (i.variant_id || ""));
              const distinto = catalogoPrecio != null && pesos(catalogoPrecio) !== pesos(i.unit_price);
              return (
                <div key={i.clave} className="border border-slate-200 rounded-2xl p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-sm text-slate-900 leading-tight">{i.nombre}</p>
                      {i.variante && <p className="text-xs text-indigo-600 font-semibold">{i.variante}</p>}
                      {i.entregado && (
                        <span className="inline-block mt-1 px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase rounded-md border border-emerald-100">
                          ✓ Entregado · no se puede quitar
                        </span>
                      )}
                    </div>
                    {!i.entregado && (
                      <button
                        onClick={() => quitar(i.clave)}
                        className="shrink-0 w-8 h-8 rounded-lg bg-slate-50 hover:bg-red-50 hover:text-red-500 text-slate-400 text-sm"
                        title="Quitar de la venta"
                      >🗑</button>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-3 mt-3">
                    <div className="flex items-center gap-2 bg-slate-50 rounded-xl p-1">
                      <button onClick={() => cambiarCantidad(i.clave, -1)} className="w-8 h-8 rounded-lg bg-white border border-slate-200 font-bold text-lg leading-none">-</button>
                      <span className="font-black w-6 text-center text-slate-900">{i.quantity}</span>
                      <button onClick={() => cambiarCantidad(i.clave, 1)} className="w-8 h-8 rounded-lg bg-white border border-slate-200 font-bold text-lg leading-none">+</button>
                    </div>
                    <div className="text-right">
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
                        <input
                          type="number" min="0" step="0.01" inputMode="decimal"
                          value={i.unit_price}
                          onChange={(e) => cambiarPrecio(i.clave, e.target.value)}
                          className={`w-28 pl-5 pr-2 py-1.5 rounded-lg border text-right font-bold text-sm focus:outline-none ${
                            distinto ? "border-amber-300 bg-amber-50 text-amber-800" : "border-slate-200 bg-slate-50 text-slate-900"
                          }`}
                        />
                      </div>
                      {catalogoPrecio != null && (
                        <p className={`text-[10px] mt-0.5 font-semibold ${distinto ? "text-amber-600" : "text-slate-400"}`}>
                          Catálogo {money(catalogoPrecio)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="relative">
            <input
              type="text"
              placeholder={cargandoCatalogo ? "Cargando catálogo…" : "Agregar producto: nombre o código…"}
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              disabled={cargandoCatalogo}
              className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-60"
            />
            {resultados.length > 0 && (
              <div className="absolute z-10 bottom-full mb-2 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-2xl">
                {resultados.map((r) => (
                  <button
                    key={r.product_id + (r.variant_id || "")}
                    onClick={() => agregar(r)}
                    disabled={r.stock <= 0}
                    className="w-full text-left px-4 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50 disabled:opacity-40 flex items-center justify-between gap-2"
                  >
                    <span className="text-sm font-semibold text-slate-800 truncate">
                      {r.nombre}{r.variante ? " · " + r.variante : ""}
                    </span>
                    <span className="text-xs shrink-0">
                      <span className="font-bold text-emerald-600">{money(r.precio)}</span>
                      <span className="text-slate-400"> · {r.stock}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-500">Descuento de la venta</span>
            <div className="relative">
              <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">$</span>
              <input
                type="number" min="0" step="0.01" inputMode="decimal"
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                className="w-28 pl-5 pr-2 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-right font-bold text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="bg-slate-50 rounded-2xl p-4 space-y-1.5 text-sm">
            <div className="flex justify-between text-slate-500"><span>Suma de productos</span><span>{money(subtotal)}</span></div>
            {descuento > 0 && (
              <div className="flex justify-between text-emerald-600 font-semibold"><span>Descuento</span><span>−{money(descuento)}</span></div>
            )}
            <div className="flex justify-between font-black text-slate-900 text-base pt-1.5 border-t border-slate-200">
              <span>Total nuevo</span><span>{money(nuevoTotal)}</span>
            </div>
            <div className="flex justify-between text-slate-500"><span>Ya pagado</span><span>{money(pagado)}</span></div>
          </div>

        </div>

        {/* El dinero que sobra o falta no se esconde debajo del doblez: es la
            decisión que de verdad importa, así que vive pegada al botón. */}
        <div className="shrink-0 border-t border-slate-200">
          {diferencia > 0 && (
            <div className="m-4 mb-0 bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <p className="font-black text-amber-900">Sobran {money(diferencia)}</p>
              <p className="text-xs text-amber-700 mt-0.5 mb-3">La clienta pagó de más. ¿Qué se hace con ese dinero?</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setResolucion("devolver")}
                  className={`py-2.5 rounded-xl text-xs font-black border-2 transition-all ${resolucion === "devolver" ? "border-emerald-500 bg-emerald-500/10 text-emerald-700" : "border-slate-200 bg-white text-slate-500"}`}
                >Devolver en efectivo</button>
                <button
                  onClick={() => setResolucion("saldo")}
                  className={`py-2.5 rounded-xl text-xs font-bold border-2 transition-all ${resolucion === "saldo" ? "border-emerald-500 bg-emerald-500/10 text-emerald-700" : "border-slate-200 bg-white text-slate-500"}`}
                >Dejar a su favor</button>
              </div>
            </div>
          )}

          {diferencia < 0 && (
            <div className="m-4 mb-0 bg-amber-50 border border-amber-200 rounded-2xl p-4">
              <p className="font-black text-amber-900">
                {eraCredito ? "Queda debiendo " : "Faltan "}{money(-diferencia)}
              </p>
              <p className="text-xs text-amber-700 mt-0.5 mb-3">
                {eraCredito
                  ? `De esta venta ya te había entregado ${money(pagado)}.`
                  : "La venta subió de precio. ¿Ya te los pagó?"}
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(eraCredito
                  ? [{ tipo: "credito", texto: "Sigue debiendo" }, { tipo: "cobrar", texto: "Me pagó todo" }]
                  : [{ tipo: "cobrar", texto: "Sí, me los pagó" }, { tipo: "credito", texto: "No, queda debiendo" }]
                ).map((o, i) => (
                  <button
                    key={o.tipo}
                    onClick={() => setResolucion(o.tipo)}
                    className={`py-2.5 rounded-xl text-xs border-2 transition-all ${i === 0 ? "font-black" : "font-bold"} ${
                      resolucion === o.tipo
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-700"
                        : "border-slate-200 bg-white text-slate-500"
                    }`}
                  >{o.texto}</button>
                ))}
              </div>
            </div>
          )}

          <div className="p-4 flex gap-3">
            <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-600 font-bold">Cancelar</button>
            <button
              onClick={guardar}
              disabled={guardando || items.length === 0}
              className="flex-1 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-black disabled:opacity-50 transition-all active:scale-95"
            >{guardando ? "Guardando…" : "Guardar cambios"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
