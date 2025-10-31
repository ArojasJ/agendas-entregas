"use client";
import { motion } from "framer-motion";

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white relative overflow-hidden">
      {/* 🔹 Botón superior izquierdo (Ingresar) */}
      <a
        href="/panel"
        className="absolute top-6 left-6 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-4 py-2 rounded-lg shadow"
      >
        Ingresar
      </a>

      {/* 🔹 Logo animado */}
      <motion.img
        src="/logo.png"
        alt="Logo"
        className="w-155 h-155 object-contain mb-8"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, ease: "easeOut" }}
      />

      {/* 🔹 Botón “Agendar Entrega” animado */}
      <motion.a
        href="/agendar"
        className="bg-emerald-500 hover:bg-emerald-600 text-white text-lg font-semibold px-6 py-3 rounded-full shadow-lg transition-all duration-200"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.6, ease: "easeOut" }}
      >
        Agendar Entrega
      </motion.a>
    </div>
  );
}




