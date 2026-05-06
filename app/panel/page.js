"use client";
import { useEffect, useState, useMemo } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function saleLocalDate(sale) {
  return localDateStr(new Date(sale.created_at));
}

export default function DashboardPage() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeChart, setActiveChart] = useState(null);
  const [timeFilter, setTimeFilter] = useState("30d");

  useEffect(() => { fetchAnalytics(); }, []);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/analytics", { headers: { "x-panel-token": token } });
      if (res.ok) {
        const data = await res.json();
        setSales(data.sales || []);
      }
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const filteredSales = useMemo(() => {
    if (timeFilter === "historico") return sales;
    const now = new Date(); now.setHours(23, 59, 59, 999);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    if (timeFilter === "ayer") { start.setDate(start.getDate() - 1); now.setDate(now.getDate() - 1); }
    else if (timeFilter === "7d") start.setDate(start.getDate() - 7);
    else if (timeFilter === "30d") start.setDate(start.getDate() - 30);
    else if (timeFilter === "90d") start.setDate(start.getDate() - 90);
    return sales.filter(s => { const d = new Date(s.created_at); return d >= start && d <= now; });
  }, [sales, timeFilter]);

  const timeSeriesData = useMemo(() => {
    const map = new Map();
    filteredSales.forEach(s => {
      const dateKey = new Date(s.created_at).toLocaleDateString("es-MX", { month: "short", day: "numeric" });
      if (!map.has(dateKey)) map.set(dateKey, { name: dateKey, ventas: 0, facturacion: 0 });
      const d = map.get(dateKey);
      d.ventas += 1;
      d.facturacion += Number(s.down_payment || 0) + (s.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
    });
    return Array.from(map.values());
  }, [filteredSales]);

  const topProductsData = useMemo(() => {
    const map = new Map();
    filteredSales.forEach(s => {
      (s.sale_items || []).forEach(item => {
        const name = item.products?.name || "Producto Borrado";
        if (!map.has(name)) map.set(name, { name, cantidad: 0 });
        map.get(name).cantidad += Number(item.quantity);
      });
    });
    return Array.from(map.values()).sort((a, b) => b.cantidad - a.cantidad).slice(0, 10);
  }, [filteredSales]);

  const topClientsData = useMemo(() => {
    const map = new Map();
    filteredSales.forEach(s => {
      if (!s.clients) return;
      const ig = s.clients.instagram
        ? (s.clients.instagram.startsWith("@") ? s.clients.instagram : `@${s.clients.instagram}`)
        : s.clients.name || "General";
      if (!map.has(ig)) map.set(ig, { name: ig, gastado: 0 });
      map.get(ig).gastado += Number(s.down_payment || 0) + (s.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
    });
    return Array.from(map.values()).sort((a, b) => b.gastado - a.gastado).slice(0, 10);
  }, [filteredSales]);

  // Tabla 7 días — usa fecha LOCAL para evitar desfase de zona horaria
  const last7DaysTable = useMemo(() => {
    const rows = [];
    for (let i = 0; i <= 6; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const targetKey = localDateStr(d);
      const daySales = sales.filter(s => saleLocalDate(s) === targetKey && s.status !== "cancelled");
      const ventasTotales = daySales.reduce((sum, s) => sum + Number(s.total || 0), 0);
      const costo = daySales.reduce((sum, s) =>
        sum + (s.sale_items || []).reduce((si, item) =>
          si + Number(item.products?.cost || 0) * Number(item.quantity), 0), 0);
      rows.push({
        fecha: d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }),
        ventas: daySales.length,
        ventasTotales,
        ventasNetas: ventasTotales,
        costo,
        margen: ventasTotales - costo,
      });
    }
    const totals = rows.reduce((acc, r) => ({
      ventas: acc.ventas + r.ventas,
      ventasTotales: acc.ventasTotales + r.ventasTotales,
      ventasNetas: acc.ventasNetas + r.ventasNetas,
      costo: acc.costo + r.costo,
      margen: acc.margen + r.margen,
    }), { ventas: 0, ventasTotales: 0, ventasNetas: 0, costo: 0, margen: 0 });
    return { rows, totals };
  }, [sales]);

  const tooltipStyle = { backgroundColor: "#fff", borderColor: "#e2e8f0", borderRadius: "12px", fontSize: "13px" };

  const renderMiniChart = (type) => {
    if (loading) return <div className="h-full w-full flex items-center justify-center opacity-30 text-xs">Cargando...</div>;
    if (filteredSales.length === 0) return <div className="h-full w-full flex items-center justify-center opacity-30 text-xs">Sin datos</div>;
    switch (type) {
      case "ventas":
        return <ResponsiveContainer width="100%" height="100%"><LineChart data={timeSeriesData}><Line type="monotone" dataKey="ventas" stroke="#10b981" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>;
      case "productos":
        return <ResponsiveContainer width="100%" height="100%"><BarChart data={topProductsData}><Bar dataKey="cantidad" fill="#6366f1" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>;
      case "clientes":
        return <ResponsiveContainer width="100%" height="100%"><BarChart data={topClientsData}><Bar dataKey="gastado" fill="#8b5cf6" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>;
    }
  };

  const renderFullChart = () => {
    if (filteredSales.length === 0) return <div className="h-64 flex items-center justify-center opacity-50">No hay datos en este periodo</div>;
    switch (activeChart) {
      case "ventas":
        return (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={timeSeriesData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="name" stroke="#cbd5e1" fontSize={12} tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis stroke="#cbd5e1" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: "#10b981", fontWeight: "bold" }} />
              <Line type="monotone" dataKey="ventas" name="Ventas" stroke="#10b981" strokeWidth={3} dot={false} activeDot={{ r: 6, strokeWidth: 0 }} />
            </LineChart>
          </ResponsiveContainer>
        );
      case "productos":
        return (
          <ResponsiveContainer width="100%" height={Math.max(320, topProductsData.length * 44)}>
            <BarChart data={topProductsData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" stroke="#cbd5e1" fontSize={12} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="name" stroke="#cbd5e1" fontSize={11} width={180} tickLine={false} axisLine={false} tick={{ fill: "#475569" }} />
              <Tooltip contentStyle={tooltipStyle} formatter={v => [v, "Unidades vendidas"]} />
              <Bar dataKey="cantidad" fill="#6366f1" radius={[0, 6, 6, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        );
      case "clientes":
        return (
          <ResponsiveContainer width="100%" height={Math.max(320, topClientsData.length * 44)}>
            <BarChart data={topClientsData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
              <XAxis type="number" stroke="#cbd5e1" fontSize={12} tickLine={false} axisLine={false} tickFormatter={v => `$${v}`} />
              <YAxis type="category" dataKey="name" stroke="#cbd5e1" fontSize={11} width={140} tickLine={false} axisLine={false} tick={{ fill: "#475569" }} />
              <Tooltip contentStyle={tooltipStyle} formatter={v => [`$${Number(v).toFixed(2)}`, "Total gastado"]} />
              <Bar dataKey="gastado" fill="#8b5cf6" radius={[0, 6, 6, 0]} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        );
    }
  };

  const getChartTitle = (type) => ({
    ventas: "Flujo de Ventas",
    productos: "Top Productos Más Vendidos",
    clientes: "Top Clientes por Dinero Gastado",
  }[type] || "");

  return (
    <main className="max-w-7xl mx-auto px-4 md:px-8 py-8">
      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard Analítico</h1>
          <p className="text-sm mt-1 opacity-70">Vista general del rendimiento de tu negocio.</p>
        </div>
        <select value={timeFilter} onChange={e => setTimeFilter(e.target.value)} className="px-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:border-emerald-500 cursor-pointer">
          <option value="hoy">Hoy</option>
          <option value="ayer">Ayer</option>
          <option value="7d">Últimos 7 Días</option>
          <option value="30d">Últimos 30 Días</option>
          <option value="90d">Últimos 90 Días</option>
          <option value="historico">Histórico Completo</option>
        </select>
      </div>

      <div className="grid md:grid-cols-3 gap-5">
        {[
          { key: "ventas", label: "Ventas", color: "emerald", value: timeSeriesData.reduce((s, d) => s + d.ventas, 0).toString(), icon: "📈" },
          { key: "productos", label: "Más Vendido", color: "indigo", value: topProductsData[0]?.name || "—", icon: "📦" },
          { key: "clientes", label: "Mejor Cliente", color: "violet", value: topClientsData[0]?.name || "—", icon: "👑" },
        ].map(card => (
          <div key={card.key} onClick={() => setActiveChart(card.key)} className="bg-white border border-slate-200 rounded-2xl p-5 cursor-pointer hover:shadow-md transition-all group">
            <div className="flex justify-between items-start mb-3">
              <span className={`text-[10px] font-black uppercase tracking-widest text-${card.color}-500`}>{card.label}</span>
              <span className="text-base">{card.icon}</span>
            </div>
            <p className="font-black text-slate-900 text-xl leading-tight truncate mb-3">{card.value}</p>
            <div className="h-12 w-full opacity-60 group-hover:opacity-100 transition-opacity">
              {renderMiniChart(card.key)}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-5 text-center text-xs text-slate-400">Haz clic en cualquier tarjeta para ver el detalle.</p>

      {activeChart && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4 lg:p-8">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-5xl shadow-2xl flex flex-col overflow-hidden" style={{ maxHeight: "90vh" }}>
            <div className="p-6 border-b border-slate-100 flex items-center justify-between gap-4 shrink-0">
              <div>
                <h2 className="text-xl font-black text-slate-900">{getChartTitle(activeChart)}</h2>
                <p className="text-xs text-slate-400 mt-0.5">Análisis detallado interactivo</p>
              </div>
              <div className="flex items-center gap-3">
                <select value={timeFilter} onChange={e => setTimeFilter(e.target.value)} className="px-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm font-medium focus:outline-none cursor-pointer">
                  <option value="hoy">Hoy</option>
                  <option value="ayer">Ayer</option>
                  <option value="7d">Últimos 7 Días</option>
                  <option value="30d">Últimos 30 Días</option>
                  <option value="90d">Últimos 90 Días</option>
                  <option value="historico">Histórico Completo</option>
                </select>
                <button onClick={() => setActiveChart(null)} className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">✕</button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1">
              <div className="p-6">{renderFullChart()}</div>

              {activeChart === "ventas" && (
                <div className="px-6 pb-6">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Últimos 7 Días</p>
                  <div className="rounded-2xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="text-left px-4 py-3 font-bold text-slate-600">Fecha</th>
                          <th className="text-right px-4 py-3 font-bold text-slate-600">Ventas</th>
                          <th className="text-right px-4 py-3 font-bold text-slate-600">Ventas Totales</th>
                          <th className="text-right px-4 py-3 font-bold text-slate-600">Ventas Netas</th>
                          <th className="text-right px-4 py-3 font-bold text-slate-600">Costo</th>
                          <th className="text-right px-4 py-3 font-bold text-slate-600">Margen</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        <tr className="bg-slate-50 font-black">
                          <td className="px-4 py-3 text-slate-700">Total</td>
                          <td className="px-4 py-3 text-right">{last7DaysTable.totals.ventas}</td>
                          <td className="px-4 py-3 text-right">${last7DaysTable.totals.ventasTotales.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right">${last7DaysTable.totals.ventasNetas.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right">${last7DaysTable.totals.costo.toFixed(2)}</td>
                          <td className="px-4 py-3 text-right text-emerald-600">${last7DaysTable.totals.margen.toFixed(2)}</td>
                        </tr>
                        {last7DaysTable.rows.map((row, i) => (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 text-slate-700 font-medium">{row.fecha}</td>
                            <td className="px-4 py-3 text-right text-slate-600">{row.ventas}</td>
                            <td className="px-4 py-3 text-right text-slate-900 font-semibold">${row.ventasTotales.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right text-slate-900 font-semibold">${row.ventasNetas.toFixed(2)}</td>
                            <td className="px-4 py-3 text-right text-slate-500">${row.costo.toFixed(2)}</td>
                            <td className={`px-4 py-3 text-right font-bold ${row.margen >= 0 ? "text-emerald-600" : "text-red-500"}`}>${row.margen.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
