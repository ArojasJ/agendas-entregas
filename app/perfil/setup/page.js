"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function SetupProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  // Datos del form
  const [name, setName] = useState("");
  const [instagram, setInstagram] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const checkProfile = async () => {
      try {
        const res = await fetch("/api/clients/me", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          // Si ya tiene un perfil completo de cliente, lo mandamos al catálogo o donde estaba
          if (data.client) {
            router.push("/perfil");
            return;
          }
          // Si no tiene cliente, pero si hay usuario de auth, pre-llenamos el nombre
          if (data.user) {
            const userName = data.user.user_metadata?.full_name || data.user.user_metadata?.name || "";
            setName(userName);
          }
        } else {
          router.push("/login"); // No está logueado
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    checkProfile();
  }, [router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    if (!name || !instagram || !phone) {
      setError("Todos los campos son obligatorios.");
      setSubmitting(false);
      return;
    }

    try {
      const res = await fetch("/api/clients/me", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, instagram, phone })
      });

      if (res.ok) {
        router.push("/perfil"); // Listo, vamos al perfil
      } else {
        const d = await res.json();
        setError(d.message || "Error al guardar el perfil");
      }
    } catch (err) {
      setError("Error de conexión");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePhoneChange = (e) => {
    const onlyNums = e.target.value.replace(/[^0-9]/g, "").slice(0, 10);
    setPhone(onlyNums);
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Cargando...</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl overflow-hidden">
        <div className="p-8">
          <div className="text-center mb-8">
            <span className="text-4xl mb-4 block">👋</span>
            <h1 className="text-2xl font-black text-slate-900">¡Casi listo!</h1>
            <p className="text-slate-500 mt-2 text-sm leading-relaxed">
              Para terminar de crear tu cuenta y agilizar tus futuras compras o entregas, necesitamos estos datos vitales.
            </p>
          </div>

          {error && <div className="mb-6 p-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Nombre Completo *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                required
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                placeholder="Juan Pérez"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Usuario de Instagram *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium">@</span>
                <input
                  type="text"
                  value={instagram.replace(/^@/, '')}
                  onChange={e => setInstagram(e.target.value.replace(/^@/, ''))}
                  required
                  className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                  placeholder="tu_usuario"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Teléfono / WhatsApp *</label>
              <input
                type="tel"
                value={phone}
                onChange={handlePhoneChange}
                required
                inputMode="numeric"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                placeholder="871..."
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full mt-4 bg-emerald-500 hover:bg-emerald-600 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-emerald-500/30 transition-all active:scale-95 disabled:opacity-50"
            >
              {submitting ? "Guardando..." : "Guardar Perfil"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
