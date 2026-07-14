"use client";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function HomePage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [profile, setProfile] = useState(null);
  const [catalogEnabled, setCatalogEnabled] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsLoggedIn(!!session);
      if (session) {
        fetch("/api/clients/me", { cache: "no-store" })
          .then(res => res.json())
          .then(data => { if (data.client) setProfile(data.client); });
      }
    });
    fetch("/api/public/catalog-settings")
      .then(r => r.json())
      .then(d => setCatalogEnabled(d.settings?.catalog_enabled === "true"))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-slate-50 to-white flex flex-col relative overflow-hidden">
      {/* BOTÓN ARRIBA DERECHA: MI CUENTA */}
      {catalogEnabled ? (
        <a
          href={isLoggedIn ? "/perfil" : "/login"}
          className="absolute right-6 bg-white hover:bg-slate-50 text-slate-700 font-bold px-6 py-2.5 rounded-full shadow-sm border border-slate-200 flex items-center gap-2 transition-all active:scale-95 z-10"
          style={{ top: "calc(1.5rem + env(safe-area-inset-top))" }}
        >
          <span>👤</span> {profile ? profile.instagram : (isLoggedIn ? "Mi Cuenta" : "Iniciar Sesión")}
        </a>
      ) : (
        <div className="absolute right-6 bg-slate-100 text-slate-400 font-bold px-6 py-2.5 rounded-full border border-slate-200 flex items-center gap-2 cursor-not-allowed select-none z-10"
          style={{ top: "calc(1.5rem + env(safe-area-inset-top))" }}>
          <span>🔒</span> Mi Cuenta
        </div>
      )}

      {/* CONTENIDO CENTRADO */}
      <main className="flex-1 flex flex-col items-center justify-center text-center gap-6 px-4">
        {/* LOGO ANIMADO */}
        <motion.img
          src="/logo.png"
          alt="Logo Agéndalo TRC"
          className="w-40 h-40 md:w-44 md:h-44 rounded-full shadow-xl"
          initial={{ opacity: 0, y: 40, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
        />

        {/* TÍTULO */}
        <motion.h1
          className="text-3xl md:text-4xl font-semibold text-slate-900"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.25 }}
        >
          Noreste Clothes and More.
        </motion.h1>

        {/* DESCRIPCIÓN */}
        <motion.p
          className="text-slate-500 max-w-md"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35 }}
        >
          Nuestros productos son ORIGINALES, de las mejores marcas y con precios justos 🇺🇸
        </motion.p>

        {/* BOTONES PRINCIPALES */}
        <motion.div
          className="flex flex-col sm:flex-row items-center gap-4 mt-2"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          <motion.a
            href="/agendar" // <- aquí tu ruta real del formulario
            className="bg-white hover:bg-slate-50 text-slate-800 font-bold px-8 py-3.5 rounded-full shadow-sm border border-slate-200 flex items-center gap-2 transition-all active:scale-95"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.985 }}
          >
            <span>📦</span> Agendar Entrega
          </motion.a>
          
          {catalogEnabled ? (
            <motion.a
              href="/catalogo"
              className="bg-white hover:bg-slate-50 text-slate-800 font-bold px-8 py-3.5 rounded-full shadow-sm border border-slate-200 flex items-center gap-2 transition-all active:scale-95"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.985 }}
            >
              <span>🛍️</span> Ver Catálogo
            </motion.a>
          ) : (
            <div className="bg-slate-100 text-slate-400 font-bold px-8 py-3.5 rounded-full border border-slate-200 flex items-center gap-2 cursor-not-allowed select-none">
              <span>🔒</span> Ver Catálogo
            </div>
          )}

          {isLoggedIn && (
            <motion.a
              href="/perfil"
              className="bg-slate-900 hover:bg-slate-800 text-white font-bold px-8 py-3.5 rounded-full shadow-lg shadow-slate-900/20 flex items-center gap-2 transition-all active:scale-95"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.985 }}
            >
              <span>📜</span> Mi Historial
            </motion.a>
          )}
        </motion.div>

        {/* TEXTO CHIQUITO */}
        <motion.p
          className="text-xs text-slate-500"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.7 }}
        >
          Disponible 24/7
        </motion.p>
      </main>

      {/* FOOTER */}
      {/* FOOTER */}
      <footer className="py-6 flex flex-col items-center gap-2 z-10 relative">
        <div className="opacity-30 hover:opacity-100 transition-opacity">
          <a href="/panel" className="text-xs text-slate-500 hover:text-emerald-600 font-medium tracking-widest uppercase">
            Acceso Empleados
          </a>
        </div>
        <p className="text-xs text-slate-700">© {new Date().getFullYear()} Noreste CM</p>
      </footer>
    </div>
  );
}





