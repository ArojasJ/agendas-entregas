"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export default function PanelLayout({ children }) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [panelRole, setPanelRole] = useState(null);
  const [staffName, setStaffName] = useState("");
  const [pendingOrders, setPendingOrders] = useState(0);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false); // v2
  const pathname = usePathname();

  useEffect(() => {
    const saved = localStorage.getItem("panelAuth");
    const savedRole = localStorage.getItem("panelRole");
    const savedName = localStorage.getItem("staffName");
    
    if (saved === "true") {
      setAuthorized(true);
      if (savedRole) {
        setPanelRole(savedRole);
        if (savedRole === "driver" && !pathname.startsWith("/panel/entregas")) {
          router.push("/panel/entregas");
        } else if (savedRole === "worker" && pathname === "/panel") {
          router.push("/panel/pos");
        }
      }
      if (savedName) setStaffName(savedName);
    }
    setIsMobileMenuOpen(false); // Cerrar menú al cambiar de ruta
  }, [pathname]); // Re-validar al cambiar de ruta

  useEffect(() => {
    if (authorized) {
      checkPendingOrders();
      // Reducimos la frecuencia de revisión para no saturar el servidor local
      const interval = setInterval(checkPendingOrders, 60000); 
      return () => clearInterval(interval);
    }
  }, [authorized]);

  const checkPendingOrders = async () => {
    if (panelRole === "driver") return; // Repartidor no necesita esto
    try {
      const token = localStorage.getItem("panelToken") || "";
      // Solo pedimos las ventas con estado específico para que sea más rápido
      const res = await fetch("/api/sales?status=catalog_pending&countOnly=true", { headers: { "x-panel-token": token } });
      if (res.ok) {
        const data = await res.json();
        setPendingOrders(data.count || 0);
      }
    } catch (e) {}
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/login-panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.token) {
        localStorage.setItem("panelAuth", "true");
        localStorage.setItem("panelToken", data.token);
        localStorage.setItem("panelRole", data.role);
        localStorage.setItem("staffName", data.displayName);
        localStorage.setItem("staffId", data.staffId);
        
        setPanelRole(data.role);
        setStaffName(data.displayName);
        setAuthorized(true);
        setMessage("");

        // Redirección inmediata según el rol
        if (data.role === "driver") {
          router.push("/panel/entregas");
        } else if (data.role === "worker") {
          router.push("/panel/pos");
        } else {
          router.push("/panel");
        }
        return;
      } else {
        setMessage(data.message || "Credenciales incorrectas.");
        return;
      }
    } catch (err) {
      setMessage("Error de conexión.");
    }
  };

  if (!authorized) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.12),transparent)]" />
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: "linear-gradient(rgba(0,0,0,.3) 1px,transparent 1px),linear-gradient(90deg,rgba(0,0,0,.3) 1px,transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />

        <a href="/" className="absolute top-6 left-6 flex items-center gap-1.5 text-slate-500 hover:text-slate-700 text-sm transition-colors">
          ← Inicio
        </a>

        <div className="relative w-full max-w-sm px-6">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 mb-5 shadow-[0_0_40px_rgba(16,185,129,0.15)]">
              <span className="text-3xl">🚚</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">TRC Entregas</h1>
            <p className="text-slate-500 text-sm mt-1">Panel de administración</p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl relative z-10">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">
                  Usuario
                </label>
                <input
                  type="text"
                  placeholder="ej: gaby"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-2 uppercase tracking-wider">
                  Contraseña
                </label>
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-500/50 transition-all"
                />
              </div>
              <button
                type="submit"
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-white py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.98]"
              >
                Entrar al panel
              </button>
              {message && (
                <p className="text-sm text-center text-red-500">{message}</p>
              )}
            </form>
          </div>
        </div>
      </div>
    );
  }

  const navLinks = [
    { name: "Nueva Venta", href: "/panel/pos", icon: "🛍️", roles: ["admin", "worker"] },
    { name: "Pedidos Web", href: "/panel/catalogo", icon: "🌐", roles: ["admin", "worker"] },
    { name: "Cobranza", href: "/panel/cobranza", icon: "💸", roles: ["admin", "worker"] },
    { name: "Dashboard", href: "/panel", icon: "📊", roles: ["admin"] },
    { name: "Ventas", href: "/panel/ventas", icon: "💰", roles: ["admin", "worker"] },
    { name: "Reportes", href: "/panel/reportes", icon: "📋", roles: ["admin"] },
    { name: "Est. Resultados", href: "/panel/estado-resultados", icon: "📑", roles: ["admin"] },
    { name: "Entregas", href: "/panel/entregas", icon: "🚚", roles: ["admin", "worker", "driver"] },
    { name: "Inventario", href: "/panel/inventario", icon: "📦", roles: ["admin", "worker"] },
    { name: "Clientes", href: "/panel/clientes", icon: "👥", roles: ["admin", "worker"] },
    { name: "Historial", href: "/panel/historial", icon: "📋", roles: ["admin"] },
  ].filter(link => link.roles.includes(panelRole));

  return (
    <div className="h-screen flex overflow-hidden transition-colors duration-300 bg-slate-50 text-slate-900">
      {/* Sidebar */}
      <aside className="w-64 border-r hidden md:flex flex-col bg-white border-slate-200">
        <div className="h-16 flex items-center px-6 border-b border-inherit">
           <a href="/" className="flex items-center gap-2.5">
             <div className="w-8 h-8 rounded-lg flex items-center justify-center border bg-emerald-50 border-emerald-200">
               <span className="text-sm">🚚</span>
             </div>
             <span className="font-bold text-sm text-slate-900">Agéndalo TRC</span>
           </a>
        </div>
        <div className="p-4 flex-1 flex flex-col gap-2 overflow-y-auto">
          <p className="text-[10px] font-semibold uppercase tracking-widest pl-3 mb-2 mt-2 text-slate-500">Menú Principal</p>
          {navLinks.map((link, idx) => {
            const isActive = pathname === link.href;
            return (
              <Link key={idx} href={link.href} className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all ${isActive ? "bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200 shadow-sm" : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"}`}>
                <div className="flex items-center gap-3">
                  <span className="text-lg opacity-80">{link.icon}</span>
                  <span>{link.name}</span>
                </div>
                {link.href === "/panel/catalogo" && pendingOrders > 0 && (
                  <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full shadow-sm animate-pulse">
                    {pendingOrders}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <div className="p-4 border-t border-inherit">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-lg shadow-inner">
              {panelRole === "admin" ? "👑" : "👤"}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-slate-900 leading-none mb-1">{staffName || "Cargando..."}</span>
              <span className="text-[10px] uppercase font-black tracking-widest text-slate-400">{panelRole}</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Mobile Navbar & logout */}
        <header className="h-16 flex items-center justify-between px-4 md:px-8 border-b bg-white/90 border-slate-200 backdrop-blur-md z-20">
            <div className="md:hidden flex items-center gap-3">
             <button 
               onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
               className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-50 text-slate-600 hover:bg-slate-100"
             >
               {isMobileMenuOpen ? "✕" : "☰"}
             </button>
             <div className="w-8 h-8 rounded-lg flex items-center justify-center border bg-emerald-50 border-emerald-200">
               <span className="text-sm">🚚</span>
             </div>
             <span className="font-bold text-sm text-slate-900">TRC</span>
           </div>
           
           <div className="ml-auto flex items-center gap-4">
             <button
               onClick={() => {
                  localStorage.removeItem("panelAuth");
                  localStorage.removeItem("panelToken");
                  localStorage.removeItem("panelRole");
                  localStorage.removeItem("staffName");
                  localStorage.removeItem("staffId");
                  setAuthorized(false);
                  setPanelRole(null);
                  setStaffName("");
                }}
                className="text-sm px-4 py-2 font-medium rounded-xl transition-colors bg-slate-100 text-slate-600 hover:text-red-600 hover:bg-red-50"
              >
                Cerrar sesión
              </button>
           </div>
        </header>
        
        {/* Children Rendered Here */}
        <div className="flex-1 overflow-y-auto relative">
          {/* OVERLAY PARA MÓVIL */}
          {isMobileMenuOpen && (
            <div 
              className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-30 md:hidden"
              onClick={() => setIsMobileMenuOpen(false)}
            />
          )}

          {/* DRAWER MÓVIL */}
          <div className={`fixed inset-y-0 left-0 w-72 bg-white z-40 shadow-2xl transform transition-transform duration-300 md:hidden ${isMobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}>
            <div className="h-16 flex items-center px-6 border-b border-slate-100">
              <span className="font-bold text-slate-900">Menú Administrativo</span>
            </div>
            <div className="p-4 flex flex-col gap-2 overflow-y-auto h-[calc(100vh-120px)]">
              {navLinks.map((link, idx) => {
                const isActive = pathname === link.href;
                return (
                  <Link 
                    key={idx} 
                    href={link.href} 
                    className={`flex items-center justify-between px-4 py-3.5 rounded-2xl text-sm transition-all ${isActive ? "bg-emerald-50 text-emerald-700 font-bold border border-emerald-200 shadow-sm" : "text-slate-600 active:bg-slate-50"}`}
                  >
                    <div className="flex items-center gap-4">
                      <span className="text-xl">{link.icon}</span>
                      <span>{link.name}</span>
                    </div>
                    {link.href === "/panel/catalogo" && pendingOrders > 0 && (
                      <span className="bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full">
                        {pendingOrders}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
            <div className="absolute bottom-0 left-0 right-0 p-4 border-t border-slate-100 bg-slate-50 flex items-center gap-3">
               <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-sm">👑</div>
               <span className="text-xs font-bold text-slate-600">{staffName}</span>
            </div>
          </div>

          {children}
        </div>
      </div>
    </div>
  );
}
