"use client";
import { useEffect, useState } from "react";

function getPanelToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem("panelToken") || "";
}

function fmt(n) {
  return "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sumaItems(items) {
  return items.reduce((s, i) => s + (Number(i.cantidad) || 0), 0);
}

let _seq = 0;
function newItem() { return { id: ++_seq, concepto: "", cantidad: "" }; }

function SeccionGasto({ titulo, icono, acento, items, onChange, onAdd, onRemove }) {
  const total = sumaItems(items);
  return (
    <div className={`bg-white rounded-2xl border ${acento.border} shadow-sm overflow-hidden`}>
      <div className={`px-4 py-3 ${acento.bg} border-b ${acento.border} flex items-center justify-between gap-2`}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="shrink-0">{icono}</span>
          <span className={`font-black text-[11px] uppercase tracking-wider ${acento.text} leading-tight truncate`}>{titulo}</span>
        </div>
        <span className={`font-black text-sm shrink-0 ${acento.text}`}>{fmt(total)}</span>
      </div>
      <div className="p-3 space-y-2">
        {items.map((item) => (
          <div key={item.id} className="flex gap-1.5 items-center group">
            <input
              type="text"
              placeholder="Concepto"
              value={item.concepto}
              onChange={(e) => onChange(item.id, "concepto", e.target.value)}
              className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-slate-400 transition-colors placeholder-slate-300"
            />
            <input
              type="text"
              inputMode="decimal"
              placeholder="0"
              value={item.cantidad}
              onChange={(e) => onChange(item.id, "cantidad", e.target.value)}
              style={{ color: "#1e293b" }}
              className="w-20 shrink-0 px-2 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold focus:outline-none focus:border-slate-400 transition-colors text-right"
            />
            <button
              onClick={() => onRemove(item.id)}
              className="w-7 h-7 shrink-0 rounded-lg opacity-0 group-hover:opacity-100 bg-red-50 hover:bg-red-100 text-red-400 text-xs flex items-center justify-center transition-all"
            >✕</button>
          </div>
        ))}
        <button
          onClick={onAdd}
          className={`w-full py-2 mt-1 rounded-xl border-2 border-dashed ${acento.dashed} text-sm font-bold ${acento.textLight} transition-colors hover:opacity-80`}
        >
          + Agregar concepto
        </button>
      </div>
    </div>
  );
}

export default function EstadoResultadosPage() {
  const [gastosAdmin,      setGastosAdmin]      = useState([newItem()]);
  const [gastosOp,         setGastosOp]         = useState([newItem()]);
  const [compras,          setCompras]          = useState([newItem()]);
  const [gastosPersonal,   setGastosPersonal]   = useState([newItem()]);
  const [gastosPersonales, setGastosPersonales] = useState([newItem()]);
  const [ventas,      setVentas]      = useState("");
  const [resultado,   setResultado]   = useState(null);
  const [nombreGuardar, setNombreGuardar] = useState("");
  const [guardando,   setGuardando]   = useState(false);
  const [historial,   setHistorial]   = useState([]);
  const [loadingHist, setLoadingHist] = useState(true);
  const [expandedId,  setExpandedId]  = useState(null);
  const [confirmDelId, setConfirmDelId] = useState(null);
  const [toast,       setToast]       = useState(null);

  useEffect(() => { fetchHistorial(); }, []);

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchHistorial = async () => {
    setLoadingHist(true);
    try {
      const res = await fetch("/api/estados-resultados", { headers: { "x-panel-token": getPanelToken() } });
      if (res.ok) { const d = await res.json(); setHistorial(d.estados || []); }
    } finally { setLoadingHist(false); }
  };

  function generarPDF({ nombre, ventas: v, totalEgresos, totalPersonales, totalGeneral, utilidad, reserva20, finAnio5, distribuible75, nosotros75, socio25, detalleAdmin, detalleOp, detalleCompras, detallePersonal, detallePersonales }) {
    const f = (n) => "$" + Number(n || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const filas = (items) => (items || []).filter(i => i.concepto || Number(i.cantidad) > 0).map(i =>
      `<tr><td style="padding:4px 8px;color:#475569">${i.concepto || "—"}</td><td style="padding:4px 8px;text-align:right;font-weight:600">${f(i.cantidad)}</td></tr>`
    ).join("") || `<tr><td colspan="2" style="padding:4px 8px;color:#94a3b8;font-style:italic">Sin conceptos</td></tr>`;

    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
    <title>Estado de Resultados – ${nombre}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Inter',sans-serif;background:#fff;color:#0f172a;padding:40px;max-width:780px;margin:0 auto}
      h1{font-size:26px;font-weight:900;color:#0f172a;margin-bottom:4px}
      .sub{font-size:13px;color:#64748b;margin-bottom:32px}
      .grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}
      .card{border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}
      .card-header{padding:10px 14px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;display:flex;justify-content:space-between;align-items:center}
      .card-body{padding:4px 0}
      table{width:100%;border-collapse:collapse;font-size:13px}
      .section{margin-bottom:24px}
      .row{display:flex;justify-content:space-between;padding:7px 14px;border-bottom:1px solid #f1f5f9;font-size:13px}
      .row:last-child{border-bottom:none}
      .row.bold{font-weight:800;font-size:14px;background:#f8fafc}
      .row.total{font-weight:900;font-size:15px;background:#0f172a;color:#fff;border-radius:8px;margin:8px 0}
      .row.deduct{color:#7c3aed;font-weight:600}
      .row.grand{font-weight:900;font-size:14px;background:#f1f5f9;border-radius:8px;margin:4px 0}
      .utilidad-box{background:linear-gradient(135deg,#ecfdf5,#d1fae5);border:1px solid #6ee7b7;border-radius:12px;padding:20px 24px;margin-bottom:24px}
      .utilidad-box .label{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:#059669;margin-bottom:6px}
      .utilidad-box .amount{font-size:36px;font-weight:900;color:#047857}
      .utilidad-box .detail{font-size:12px;color:#6b7280;margin-top:4px}
      .dist-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px}
      .dist-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e2e8f0;font-size:13px}
      .dist-row:last-child{border-bottom:none}
      .dist-row.green{color:#059669;font-weight:900;font-size:15px;background:#ecfdf5;border-radius:8px;padding:8px 12px;margin:4px -4px}
      .dist-row.indigo{color:#4f46e5;font-weight:900;font-size:15px;background:#eef2ff;border-radius:8px;padding:8px 12px;margin:4px -4px}
      .footer{margin-top:40px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px}
      @media print{body{padding:20px}button{display:none}}
    </style></head><body>
    <h1>Estado de Resultados</h1>
    <p class="sub">${nombre} &nbsp;·&nbsp; Generado el ${new Date().toLocaleDateString("es-MX",{day:"numeric",month:"long",year:"numeric"})}</p>

    <div class="utilidad-box">
      <div class="label">Utilidad del Período</div>
      <div class="amount">${f(utilidad)}</div>
      <div class="detail">${f(v)} ventas &minus; ${f(totalGeneral)} egresos netos</div>
    </div>

    <div class="grid">
      <div>
        <div class="section">
          <div class="card">
            <div class="card-header" style="background:#eef2ff;color:#4338ca">🏢 Gastos Administrativos <span>${f(sumaItems(detalleAdmin))}</span></div>
            <div class="card-body"><table>${filas(detalleAdmin)}</table></div>
          </div>
        </div>
        <div class="section">
          <div class="card">
            <div class="card-header" style="background:#fff1f2;color:#be123c">⚙️ Gastos Operativos <span>${f(sumaItems(detalleOp))}</span></div>
            <div class="card-body"><table>${filas(detalleOp)}</table></div>
          </div>
        </div>
        <div class="section">
          <div class="card">
            <div class="card-header" style="background:#fffbeb;color:#b45309">📦 Compras de Producto <span>${f(sumaItems(detalleCompras))}</span></div>
            <div class="card-body"><table>${filas(detalleCompras)}</table></div>
          </div>
        </div>
        <div class="section">
          <div class="card">
            <div class="card-header" style="background:#f0fdfa;color:#0f766e">👥 Gastos de Personal <span>${f(sumaItems(detallePersonal))}</span></div>
            <div class="card-body"><table>${filas(detallePersonal)}</table></div>
          </div>
        </div>
        <div class="row bold" style="border:1px solid #e2e8f0;border-radius:8px;margin-top:4px"><span>Total de Egresos</span><span>${f(totalEgresos)}</span></div>
        <div class="row deduct" style="padding:7px 14px"><span>− Gastos Personales</span><span>${f(totalPersonales)}</span></div>
        <div class="row grand"><span>Total General</span><span>${f(totalGeneral)}</span></div>
      </div>

      <div>
        <p style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:12px">Distribución</p>
        <div class="dist-box">
          <div class="dist-row"><span>Reserva (20%)</span><span>${f(reserva20)}</span></div>
          <div class="dist-row"><span>🎄 Fin de Año (5%)</span><span>${f(finAnio5)}</span></div>
          <div class="dist-row"><span>Para distribuir (75%)</span><span style="font-weight:700">${f(distribuible75)}</span></div>
          <div class="dist-row green"><span>🏠 Nosotros (75%)</span><span>${f(nosotros75)}</span></div>
          <div class="dist-row indigo"><span>🤝 Socio (25%)</span><span>${f(socio25)}</span></div>
        </div>

        <div style="margin-top:20px">
          <p style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:12px">Gastos Personales</p>
          <div class="card">
            <div class="card-header" style="background:#f5f3ff;color:#6d28d9">🧾 Gastos Personales <span>${f(totalPersonales)}</span></div>
            <div class="card-body"><table>${filas(detallePersonales)}</table></div>
          </div>
        </div>
      </div>
    </div>

    <div class="footer">Agenda Lo TRC &nbsp;·&nbsp; Estado de Resultados generado automáticamente</div>
    <script>window.onload=()=>window.print()</script>
    </body></html>`;

    const win = window.open("", "_blank");
    win.document.write(html);
    win.document.close();
  }

  function makeHandlers(setter) {
    return {
      onChange: (id, field, val) => setter(prev => prev.map(i => i.id === id ? { ...i, [field]: val } : i)),
      onAdd:    ()  => setter(prev => [...prev, newItem()]),
      onRemove: (id) => setter(prev => prev.length > 1 ? prev.filter(i => i.id !== id) : prev),
    };
  }

  const calcular = () => {
    const totalEgresos   = sumaItems(gastosAdmin) + sumaItems(gastosOp) + sumaItems(compras) + sumaItems(gastosPersonal);
    const totalPersonales = sumaItems(gastosPersonales);
    const totalGeneral   = totalEgresos - totalPersonales;
    const utilidad       = (Number(ventas) || 0) - totalGeneral;
    const reserva20      = utilidad * 0.20;
    const finAnio5       = utilidad * 0.05;
    const distribuible75 = utilidad * 0.75;
    const nosotros75     = distribuible75 * 0.75;
    const socio25        = distribuible75 * 0.25;
    setResultado({ totalEgresos, totalPersonales, totalGeneral, utilidad, reserva20, finAnio5, distribuible75, nosotros75, socio25 });
  };

  const guardar = async () => {
    if (!nombreGuardar.trim()) { showToast("Ponle un nombre al estado de resultados", "err"); return; }
    if (!resultado) { showToast("Primero realiza la operación", "err"); return; }
    setGuardando(true);
    try {
      const res = await fetch("/api/estados-resultados", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": getPanelToken() },
        body: JSON.stringify({
          nombre: nombreGuardar.trim(),
          ventas: Number(ventas) || 0,
          gastos_admin: gastosAdmin,
          gastos_operativos: gastosOp,
          compras,
          gastos_personal: gastosPersonal,
          gastos_personales: gastosPersonales,
          total_egresos:    resultado.totalGeneral,
          utilidad:         resultado.utilidad,
          reserva_10:       resultado.reserva20,
          fin_anio:         resultado.finAnio5,
          distribuible_90:  resultado.distribuible75,
          nosotros_75:      resultado.nosotros75,
          socio_25:         resultado.socio25,
        }),
      });
      if (res.ok) {
        showToast("Guardado correctamente");
        setNombreGuardar("");
        setVentas("");
        setGastosAdmin([newItem()]);
        setGastosOp([newItem()]);
        setCompras([newItem()]);
        setGastosPersonal([newItem()]);
        setGastosPersonales([newItem()]);
        setResultado(null);
        fetchHistorial();
      } else {
        const d = await res.json();
        showToast(d.message || "Error al guardar", "err");
      }
    } finally { setGuardando(false); }
  };

  const eliminar = async (id) => {
    const res = await fetch(`/api/estados-resultados?id=${id}`, { method: "DELETE", headers: { "x-panel-token": getPanelToken() } });
    if (!res.ok) { showToast("Error al eliminar", "err"); return; }
    setConfirmDelId(null);
    fetchHistorial();
  };

  const listo = (Number(ventas) || 0) > 0;
  const hAdmin     = makeHandlers(setGastosAdmin);
  const hOp        = makeHandlers(setGastosOp);
  const hCompra    = makeHandlers(setCompras);
  const hPersonal  = makeHandlers(setGastosPersonal);
  const hPersonales = makeHandlers(setGastosPersonales);

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-6 right-6 z-50 px-5 py-3 rounded-2xl shadow-xl font-semibold text-sm flex items-center gap-2 transition-all ${toast.type === "err" ? "bg-red-500 text-white" : "bg-emerald-500 text-white"}`}>
          {toast.type === "err" ? "⚠" : "✓"} {toast.msg}
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 md:px-6 pt-8 space-y-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Estado de Resultados</h1>
            <p className="text-sm text-slate-500 mt-1">Captura los datos y presiona <strong>Realizar Operación</strong> para ver la distribución.</p>
          </div>
          <span className="text-3xl">📑</span>
        </div>

        {/* ── Secciones de egresos ── */}
        <div className="grid md:grid-cols-3 gap-4">
          <SeccionGasto
            titulo="Gastos Administrativos" icono="🏢"
            acento={{ bg: "bg-indigo-50", border: "border-indigo-100", text: "text-indigo-600", textLight: "text-indigo-400", dashed: "border-indigo-200" }}
            items={gastosAdmin} {...hAdmin}
          />
          <SeccionGasto
            titulo="Gastos Operativos" icono="⚙️"
            acento={{ bg: "bg-rose-50", border: "border-rose-100", text: "text-rose-600", textLight: "text-rose-400", dashed: "border-rose-200" }}
            items={gastosOp} {...hOp}
          />
          <SeccionGasto
            titulo="Compras de Producto" icono="📦"
            acento={{ bg: "bg-amber-50", border: "border-amber-100", text: "text-amber-600", textLight: "text-amber-400", dashed: "border-amber-200" }}
            items={compras} {...hCompra}
          />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <SeccionGasto
            titulo="Gastos de Personal" icono="👥"
            acento={{ bg: "bg-teal-50", border: "border-teal-100", text: "text-teal-600", textLight: "text-teal-400", dashed: "border-teal-200" }}
            items={gastosPersonal} {...hPersonal}
          />
          <SeccionGasto
            titulo="Gastos Personales" icono="🧾"
            acento={{ bg: "bg-violet-50", border: "border-violet-100", text: "text-violet-600", textLight: "text-violet-400", dashed: "border-violet-200" }}
            items={gastosPersonales} {...hPersonales}
          />
        </div>

        {/* ── Ventas + Botón en misma fila ── */}
        <div className="flex flex-col sm:flex-row gap-4 items-stretch">
          <div className="bg-white border border-emerald-100 rounded-2xl shadow-sm flex-1">
            <div className="px-5 py-4 bg-emerald-50 border-b border-emerald-100 flex items-center gap-3">
              <span className="text-xl">💰</span>
              <span className="font-black text-sm uppercase tracking-wider text-emerald-600">Ventas Totales del Período</span>
            </div>
            <div className="p-4">
              <p className="text-xs text-slate-400 mb-3">Total acumulado de tus cortes de caja en este período.</p>
              <div className="relative max-w-xs">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-bold">$</span>
                <input
                  type="number"
                  placeholder="0.00"
                  value={ventas}
                  onChange={e => { setVentas(e.target.value); setResultado(null); }}
                  className="w-full pl-9 pr-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 font-bold text-lg focus:outline-none focus:border-emerald-400 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Botón */}
          <button
            onClick={calcular}
            disabled={!listo}
            className="sm:w-56 py-4 px-6 rounded-2xl bg-slate-900 hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-black text-base transition-all active:scale-[0.99] shadow-lg shadow-slate-900/10 flex items-center justify-center gap-3"
          >
            <span className="text-2xl">🧮</span>
            <span>Realizar<br/>Operación</span>
          </button>
        </div>

        {/* ── Resultado ── */}
        {resultado && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            {/* Banner de utilidad */}
            <div className={`px-6 py-5 ${resultado.utilidad >= 0 ? "bg-gradient-to-r from-emerald-50 to-teal-50 border-b border-emerald-100" : "bg-red-50 border-b border-red-100"}`}>
              <p className="text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Utilidad del Período</p>
              <p className={`text-4xl font-black ${resultado.utilidad >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                {fmt(resultado.utilidad)}
              </p>
              <p className="text-xs text-slate-400 mt-1">{fmt(Number(ventas))} ventas − {fmt(resultado.totalGeneral)} egresos netos</p>
            </div>

            {resultado.utilidad > 0 && (
              <div className="p-6 grid md:grid-cols-2 gap-6">
                {/* Desglose */}
                <div className="space-y-3">
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Desglose de Egresos</p>
                  {[
                    { label: "Gastos Administrativos", val: sumaItems(gastosAdmin),    color: "text-indigo-500" },
                    { label: "Gastos Operativos",       val: sumaItems(gastosOp),       color: "text-rose-500" },
                    { label: "Compras de Producto",     val: sumaItems(compras),        color: "text-amber-500" },
                    { label: "Gastos de Personal",      val: sumaItems(gastosPersonal), color: "text-teal-500" },
                  ].map(r => (
                    <div key={r.label} className="flex justify-between items-center py-2 border-b border-slate-100">
                      <span className="text-sm text-slate-600">{r.label}</span>
                      <span className={`font-bold text-sm ${r.color}`}>{fmt(r.val)}</span>
                    </div>
                  ))}
                  {/* Subtotal sin personales */}
                  <div className="flex justify-between items-center py-2 border-b-2 border-slate-300">
                    <span className="text-sm font-black text-slate-700">Total de Egresos</span>
                    <span className="font-black text-slate-800">{fmt(resultado.totalEgresos)}</span>
                  </div>
                  {/* Gastos Personales como deducción */}
                  <div className="flex justify-between items-center py-2 border-b border-slate-100">
                    <span className="text-sm text-violet-600">− Gastos Personales</span>
                    <span className="font-bold text-sm text-violet-500">{fmt(resultado.totalPersonales)}</span>
                  </div>
                  {/* Total general */}
                  <div className="flex justify-between items-center py-2 bg-slate-100 rounded-xl px-3 mt-1">
                    <span className="text-sm font-black text-slate-900">Total General</span>
                    <span className="font-black text-slate-900">{fmt(resultado.totalGeneral)}</span>
                  </div>
                </div>

                {/* Distribución */}
                <div>
                  <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Distribución</p>
                  <div className="bg-slate-50 rounded-2xl p-4 space-y-3 border border-slate-100">
                    <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                      <span className="text-sm text-slate-500">Reserva (20%)</span>
                      <span className="font-bold text-slate-600">{fmt(resultado.reserva20)}</span>
                    </div>
                    <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                      <span className="text-sm text-slate-500">🎄 Fin de Año (5%)</span>
                      <span className="font-bold text-slate-600">{fmt(resultado.finAnio5)}</span>
                    </div>
                    <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                      <span className="text-sm text-slate-500">Para distribuir (75%)</span>
                      <span className="font-bold text-slate-700">{fmt(resultado.distribuible75)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 bg-emerald-50 rounded-xl px-3">
                      <span className="text-sm font-bold text-emerald-700">🏠 Nosotros (75%)</span>
                      <span className="font-black text-emerald-600 text-lg">{fmt(resultado.nosotros75)}</span>
                    </div>
                    <div className="flex justify-between items-center py-2 bg-indigo-50 rounded-xl px-3">
                      <span className="text-sm font-bold text-indigo-700">🤝 Socio (25%)</span>
                      <span className="font-black text-indigo-600 text-lg">{fmt(resultado.socio25)}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Guardar */}
            <div className="px-6 pb-6 border-t border-slate-100 pt-5">
              <p className="text-sm font-bold text-slate-600 mb-3">Guardar este estado de resultados</p>
              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={() => generarPDF({
                    nombre: nombreGuardar.trim() || "Sin nombre",
                    ventas: Number(ventas) || 0,
                    totalEgresos: resultado.totalEgresos,
                    totalPersonales: resultado.totalPersonales,
                    totalGeneral: resultado.totalGeneral,
                    utilidad: resultado.utilidad,
                    reserva20: resultado.reserva20,
                    finAnio5: resultado.finAnio5,
                    distribuible75: resultado.distribuible75,
                    nosotros75: resultado.nosotros75,
                    socio25: resultado.socio25,
                    detalleAdmin: gastosAdmin,
                    detalleOp: gastosOp,
                    detalleCompras: compras,
                    detallePersonal: gastosPersonal,
                    detallePersonales: gastosPersonales,
                  })}
                  className="px-6 py-3 rounded-xl bg-violet-500 hover:bg-violet-400 text-white font-black text-sm transition-all active:scale-95 shadow-lg shadow-violet-500/20"
                >
                  📄 Descargar PDF
                </button>
                <input
                  type="text"
                  placeholder='Ej: "Abril 2026" o "Q1 2026"'
                  value={nombreGuardar}
                  onChange={e => setNombreGuardar(e.target.value)}
                  className="flex-1 px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-emerald-400 transition-colors"
                />
                <button
                  onClick={guardar}
                  disabled={guardando || !nombreGuardar.trim()}
                  className="px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white font-black text-sm transition-all active:scale-95 shadow-lg shadow-emerald-500/20"
                >
                  {guardando ? "Guardando…" : "💾 Guardar"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Historial ── */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
            <span className="text-xl">📂</span>
            <h2 className="font-black text-slate-800">Historial</h2>
            {historial.length > 0 && (
              <span className="ml-auto text-xs font-bold text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">{historial.length} guardados</span>
            )}
          </div>

          {loadingHist ? (
            <div className="p-10 flex justify-center">
              <div className="w-6 h-6 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : historial.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-3xl mb-3">📋</p>
              <p className="text-slate-400 text-sm">Aún no hay estados guardados.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {historial.map(e => (
                <div key={e.id} className="px-5 py-4 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="font-black text-slate-800 truncate">{e.nombre}</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {new Date(e.created_at).toLocaleDateString("es-MX", { day: "2-digit", month: "long", year: "numeric" })}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {confirmDelId === e.id ? (
                        <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-1.5">
                          <span className="text-xs text-red-600 font-bold">¿Eliminar?</span>
                          <button
                            onClick={() => eliminar(e.id)}
                            className="px-2.5 py-1 rounded-lg bg-red-500 hover:bg-red-600 text-white text-xs font-black transition-colors"
                          >Sí</button>
                          <button
                            onClick={() => setConfirmDelId(null)}
                            className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 text-slate-600 text-xs font-bold border border-slate-200 transition-colors"
                          >No</button>
                        </div>
                      ) : (
                        <>
                          <div className="text-right">
                            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Nosotros</p>
                            <p className="font-black text-emerald-600">{fmt(e.nosotros_75)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] text-slate-400 uppercase tracking-widest font-bold">Socio</p>
                            <p className="font-black text-indigo-500">{fmt(e.socio_25)}</p>
                          </div>
                          <button
                            onClick={() => generarPDF({
                              nombre: e.nombre,
                              ventas: e.ventas,
                              totalEgresos: (e.total_egresos || 0) + (e.gastos_personales || []).reduce((s,p) => s + Number(p.cantidad||0), 0),
                              totalPersonales: (e.gastos_personales || []).reduce((s,p) => s + Number(p.cantidad||0), 0),
                              totalGeneral: e.total_egresos,
                              utilidad: e.utilidad,
                              reserva20: e.reserva_10,
                              finAnio5: e.fin_anio,
                              distribuible75: e.distribuible_90,
                              nosotros75: e.nosotros_75,
                              socio25: e.socio_25,
                              detalleAdmin: e.gastos_admin,
                              detalleOp: e.gastos_operativos,
                              detalleCompras: e.compras,
                              detallePersonal: e.gastos_personal,
                              detallePersonales: e.gastos_personales,
                            })}
                            className="w-8 h-8 rounded-xl bg-violet-50 hover:bg-violet-100 text-violet-500 text-sm flex items-center justify-center transition-colors"
                            title="Descargar PDF"
                          >📄</button>
                          <button
                            onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}
                            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 text-sm flex items-center justify-center transition-colors"
                          >{expandedId === e.id ? "▲" : "▼"}</button>
                          <button
                            onClick={() => setConfirmDelId(e.id)}
                            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-red-50 hover:text-red-500 text-slate-400 text-sm flex items-center justify-center transition-colors"
                          >🗑</button>
                        </>
                      )}
                    </div>
                  </div>

                  {expandedId === e.id && (
                    <div className="mt-4 grid md:grid-cols-2 gap-3 text-sm">
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Resumen</p>
                        {[["Ventas", e.ventas], ["Total Egresos", e.total_egresos], ["Utilidad", e.utilidad]].map(([l, v]) => (
                          <div key={l} className="flex justify-between">
                            <span className="text-slate-500">{l}</span>
                            <span className="font-bold">{fmt(v)}</span>
                          </div>
                        ))}
                      </div>
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-2">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Distribución</p>
                        {[["Reserva 20%", e.reserva_10, ""], ["Fin de Año 5%", e.fin_anio, ""], ["Distribuible 75%", e.distribuible_90, ""], ["Nosotros 75%", e.nosotros_75, "text-emerald-600"], ["Socio 25%", e.socio_25, "text-indigo-500"]].map(([l, v, cls]) => (
                          <div key={l} className="flex justify-between">
                            <span className="text-slate-500">{l}</span>
                            <span className={`font-bold ${cls}`}>{fmt(v)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
