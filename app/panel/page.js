"use client";
import { useEffect, useState, useMemo } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, PieChart, Pie, Cell } from "recharts";

const COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#f43f5e'];

export default function DashboardPage() {
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Modal State
  const [activeChart, setActiveChart] = useState(null); // 'ventas', 'facturacion', 'productos', 'clientes'
  const [timeFilter, setTimeFilter] = useState("30d"); // hoy, ayer, 7d, 30d, 90d, historico

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/analytics", { headers: { "x-panel-token": token } });
      if (res.ok) {
        const data = await res.json();
        setSales(data.sales || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // ── FILTRADO POR TIEMPO ──
  const filteredSales = useMemo(() => {
    if (timeFilter === "historico") return sales;
    
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    
    const startDate = new Date();
    startDate.setHours(0, 0, 0, 0);

    if (timeFilter === "hoy") {
      // startDate is already today 00:00
    } else if (timeFilter === "ayer") {
      startDate.setDate(startDate.getDate() - 1);
      now.setDate(now.getDate() - 1); // El fin es ayer 23:59
    } else if (timeFilter === "7d") {
      startDate.setDate(startDate.getDate() - 7);
    } else if (timeFilter === "30d") {
      startDate.setDate(startDate.getDate() - 30);
    } else if (timeFilter === "90d") {
      startDate.setDate(startDate.getDate() - 90);
    }

    return sales.filter(s => {
      const saleDate = new Date(s.created_at);
      return saleDate >= startDate && saleDate <= now;
    });
  }, [sales, timeFilter]);

  // ── PROCESAMIENTO DE DATOS PARA GRÁFICAS ──
  
  // 1. Ventas y Facturación a lo largo del tiempo
  const timeSeriesData = useMemo(() => {
    const map = new Map();
    
    filteredSales.forEach(s => {
      // Agrupar por día (YYYY-MM-DD)
      const dateKey = new Date(s.created_at).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' });
      
      if (!map.has(dateKey)) {
        map.set(dateKey, { name: dateKey, ventas: 0, facturacion: 0 });
      }
      
      const dayData = map.get(dateKey);
      dayData.ventas += 1;
      
      // Sumar pagos recibidos en esa venta y enganches
      const totalPagado = Number(s.down_payment || 0) + (s.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
      dayData.facturacion += totalPagado;
    });

    return Array.from(map.values());
  }, [filteredSales]);

  // 2. Productos Más Vendidos
  const topProductsData = useMemo(() => {
    const map = new Map();
    filteredSales.forEach(s => {
      (s.sale_items || []).forEach(item => {
        const prodName = item.products?.name || "Producto Borrado";
        if (!map.has(prodName)) {
          map.set(prodName, { name: prodName, cantidad: 0 });
        }
        map.get(prodName).cantidad += Number(item.quantity);
      });
    });
    return Array.from(map.values()).sort((a, b) => b.cantidad - a.cantidad).slice(0, 10);
  }, [filteredSales]);

  // 3. Clientes con Más Compras
  const topClientsData = useMemo(() => {
    const map = new Map();
    filteredSales.forEach(s => {
      const igRaw = s.clients?.instagram || "";
      const ig = igRaw ? (igRaw.startsWith("@") ? igRaw : `@${igRaw}`) : (s.clients?.name || "General");
      if (!map.has(ig)) {
        map.set(ig, { name: ig, compras: 0, gastado: 0 });
      }
      map.get(ig).compras += 1;
      const pagado = Number(s.down_payment || 0) + (s.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
      map.get(ig).gastado += pagado;
    });
    return Array.from(map.values()).sort((a, b) => b.compras - a.compras).slice(0, 10);
  }, [filteredSales]);


  // ── RENDERIZADO DE MINI GRÁFICAS ──
  const renderMiniChart = (type) => {
    if (loading) return <div className="h-full w-full flex items-center justify-center opacity-50 text-xs">Cargando...</div>;
    if (filteredSales.length === 0) return <div className="h-full w-full flex items-center justify-center opacity-50 text-xs">Sin datos</div>;

    switch (type) {
      case 'ventas':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={timeSeriesData}>
              <Line type="monotone" dataKey="ventas" stroke="#10b981" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        );
      case 'facturacion':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={timeSeriesData}>
              <Line type="monotone" dataKey="facturacion" stroke="#f59e0b" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        );
      case 'productos':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topProductsData}>
              <Bar dataKey="cantidad" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        );
      case 'clientes':
        return (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topClientsData}>
              <Bar dataKey="compras" fill="#ec4899" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        );
    }
  };

  // ── RENDERIZADO DE GRÁFICA GIGANTE ──
  const renderFullChart = () => {
    if (filteredSales.length === 0) return <div className="h-64 flex items-center justify-center opacity-50">No hay datos en este periodo</div>;

    switch (activeChart) {
      case 'ventas':
        return (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={timeSeriesData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickMargin={10} />
              <YAxis stroke="#94a3b8" fontSize={12} allowDecimals={false} />
              <Tooltip contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '12px' }} itemStyle={{ color: '#10b981', fontWeight: 'bold' }} />
              <Line type="monotone" dataKey="ventas" name="No. Ventas" stroke="#10b981" strokeWidth={4} activeDot={{ r: 8, fill: '#10b981', stroke: '#fff' }} />
            </LineChart>
          </ResponsiveContainer>
        );
      case 'facturacion':
        return (
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={timeSeriesData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickMargin={10} />
              <YAxis stroke="#94a3b8" fontSize={12} tickFormatter={(val) => `$${val}`} />
              <Tooltip formatter={(val) => `$${val}`} contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '12px' }} itemStyle={{ color: '#f59e0b', fontWeight: 'bold' }} />
              <Line type="monotone" dataKey="facturacion" name="Ingresos" stroke="#f59e0b" strokeWidth={4} activeDot={{ r: 8, fill: '#f59e0b', stroke: '#fff' }} />
            </LineChart>
          </ResponsiveContainer>
        );
      case 'productos':
        return (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={topProductsData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" stroke="#94a3b8" fontSize={12} />
              <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={11} width={100} />
              <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '12px' }} />
              <Bar dataKey="cantidad" name="Unidades Vendidas" fill="#3b82f6" radius={[0, 4, 4, 0]}>
                {topProductsData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );
      case 'clientes':
        return (
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={topClientsData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickMargin={10} angle={-45} textAnchor="end" height={60} />
              <YAxis stroke="#94a3b8" fontSize={12} allowDecimals={false} />
              <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ backgroundColor: '#ffffff', borderColor: '#e2e8f0', borderRadius: '12px' }} />
              <Bar dataKey="compras" name="No. Compras" fill="#ec4899" radius={[4, 4, 0, 0]}>
                {topClientsData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        );
    }
  };

  const getChartTitle = (type) => {
    switch (type) {
      case 'ventas': return "Flujo de Ventas";
      case 'facturacion': return "Ingresos (Facturación)";
      case 'productos': return "Top Productos Más Vendidos";
      case 'clientes': return "Top Clientes Frecuentes";
      default: return "";
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-4 md:px-8 py-8">
      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard Analítico</h1>
          <p className="text-sm mt-1 opacity-70">
            Vista general del rendimiento de tu negocio.
          </p>
        </div>
        
        {/* Filtro Global Opcional (aplica a las mini gráficas) */}
        <select 
          value={timeFilter} 
          onChange={(e) => setTimeFilter(e.target.value)}
          className="px-4 py-2 rounded-xl bg-slate-50 border border-slate-200 text-sm focus:outline-none focus:border-emerald-500 cursor-pointer"
        >
          <option value="hoy" className="bg-white">Hoy</option>
          <option value="ayer" className="bg-white">Ayer</option>
          <option value="7d" className="bg-white">Últimos 7 Días</option>
          <option value="30d" className="bg-white">Últimos 30 Días</option>
          <option value="90d" className="bg-white">Últimos 90 Días</option>
          <option value="historico" className="bg-white">Histórico Completo</option>
        </select>
      </div>

      {/* ── GRID DE MINI GRÁFICAS ── */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        
        <div onClick={() => setActiveChart('ventas')} className="bg-slate-50 border border-slate-200 rounded-3xl p-5 cursor-pointer hover:bg-slate-100 hover:border-emerald-500/30 transition-all group relative overflow-hidden">
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Ventas</span>
              <h2 className="text-2xl font-black">{timeSeriesData.reduce((sum, d) => sum + d.ventas, 0)}</h2>
            </div>
            <div className="w-8 h-8 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform">📈</div>
          </div>
          <div className="h-16 w-[110%] -ml-2 opacity-50 group-hover:opacity-100 transition-opacity min-h-[64px]">
            {renderMiniChart('ventas')}
          </div>
        </div>

        <div onClick={() => setActiveChart('facturacion')} className="bg-slate-50 border border-slate-200 rounded-3xl p-5 cursor-pointer hover:bg-slate-100 hover:border-amber-500/30 transition-all group relative overflow-hidden">
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-amber-400">Facturación</span>
              <h2 className="text-2xl font-black">${timeSeriesData.reduce((sum, d) => sum + d.facturacion, 0).toFixed(2)}</h2>
            </div>
            <div className="w-8 h-8 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform">💵</div>
          </div>
          <div className="h-16 w-[110%] -ml-2 opacity-50 group-hover:opacity-100 transition-opacity min-h-[64px]">
            {renderMiniChart('facturacion')}
          </div>
        </div>

        <div onClick={() => setActiveChart('productos')} className="bg-slate-50 border border-slate-200 rounded-3xl p-5 cursor-pointer hover:bg-slate-100 hover:border-blue-500/30 transition-all group relative overflow-hidden">
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-blue-400">Más Vendido</span>
              <h2 className="text-lg font-black leading-tight truncate w-32">{topProductsData[0]?.name || "-"}</h2>
            </div>
            <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">📦</div>
          </div>
          <div className="h-16 w-[110%] -ml-2 opacity-50 group-hover:opacity-100 transition-opacity min-h-[64px]">
            {renderMiniChart('productos')}
          </div>
        </div>

        <div onClick={() => setActiveChart('clientes')} className="bg-slate-50 border border-slate-200 rounded-3xl p-5 cursor-pointer hover:bg-slate-100 hover:border-pink-500/30 transition-all group relative overflow-hidden">
          <div className="flex justify-between items-start mb-4 relative z-10">
            <div>
              <span className="text-[10px] font-black uppercase tracking-widest text-pink-400">Mejor Cliente</span>
              <h2 className="text-lg font-black leading-tight truncate w-32">{topClientsData[0]?.name || "-"}</h2>
            </div>
            <div className="w-8 h-8 rounded-full bg-pink-500/10 flex items-center justify-center text-pink-400 group-hover:scale-110 transition-transform">👑</div>
          </div>
          <div className="h-16 w-[110%] -ml-2 opacity-50 group-hover:opacity-100 transition-opacity min-h-[64px]">
            {renderMiniChart('clientes')}
          </div>
        </div>

      </div>

      <div className="mt-8 text-center text-xs opacity-30">
        Haz clic en cualquier tarjeta para expandir la gráfica y ver detalles.
      </div>

      {/* ── MODAL FULL SCREEN PARA GRÁFICA ── */}
      {activeChart && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-50 p-4 lg:p-10 animate-in fade-in zoom-in duration-300">
          <div className="bg-white border border-slate-200 rounded-[2rem] w-full max-w-5xl h-[85vh] shadow-2xl flex flex-col relative overflow-hidden">
            
            {/* Header del Modal */}
            <div className="p-6 lg:px-10 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black">{getChartTitle(activeChart)}</h2>
                <p className="text-sm opacity-50">Análisis detallado interactivo</p>
              </div>

              <div className="flex items-center gap-4">
                <select 
                  value={timeFilter} 
                  onChange={(e) => setTimeFilter(e.target.value)}
                  className="px-5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 font-bold focus:outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="hoy" className="bg-white">Hoy</option>
                  <option value="ayer" className="bg-white">Ayer</option>
                  <option value="7d" className="bg-white">Últimos 7 Días</option>
                  <option value="30d" className="bg-white">Últimos 30 Días</option>
                  <option value="90d" className="bg-white">Últimos 90 Días</option>
                  <option value="historico" className="bg-white">Histórico Completo</option>
                </select>

                <button onClick={() => setActiveChart(null)} className="w-10 h-10 rounded-xl bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-lg transition-colors">✕</button>
              </div>
            </div>

            {/* Cuerpo del Modal (Gráfica Gigante) */}
            <div className="flex-1 p-6 lg:p-10 flex flex-col items-center justify-center">
              {renderFullChart()}
            </div>

          </div>
        </div>
      )}

    </main>
  );
}
