"use client";
import { motion } from "framer-motion";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-emerald-50 to-white flex flex-col relative overflow-hidden">
      {/* BOTÓN ARRIBA IZQUIERDA */}
      <a
        href="/panel" // <- tu ruta de empleados
        className="absolute top-6 left-6 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-4 py-2 rounded-full shadow"
      >
        Ingresar
      </a>

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
          Agenda tus entregas en segundos
        </motion.h1>

        {/* DESCRIPCIÓN */}
        <motion.p
          className="text-slate-500 max-w-md"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35 }}
        >
          Domicilio, bodega y paquetería.
        </motion.p>

        {/* BOTÓN PRINCIPAL */}
        <motion.a
          href="/agendar" // <- aquí tu ruta real del formulario
          className="bg-emerald-500 hover:bg-emerald-600 text-white font-semibold px-9 py-3 rounded-full shadow-lg"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.985 }}
        >
          Agendar Entrega
        </motion.a>

        {/* TEXTO CHIQUITO */}
        <motion.p
          className="text-xs text-slate-400"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.7 }}
        >
          Disponible 24/7 
        </motion.p>
      </main>

      {/* FOOTER */}
      <footer className="py-4 text-center text-xs text-slate-300">
        © {new Date().getFullYear()} Agéndalo TRC
      </footer>
    </div>
  );
}





