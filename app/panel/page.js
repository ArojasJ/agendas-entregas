"use client";
import { useEffect, useState } from "react";

// 🔑 leemos de env (Vercel) o dejamos MELANNY como fallback
const PANEL_PASSWORD_ENV =
  process.env.NEXT_PUBLIC_PANEL_PASSWORD ||
  process.env.PANEL_PASSWORD ||
  "MELANNY";

export default function PanelPage() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [slots, setSlots] = useState(null);
  const [loadingData, setLoadingData] = useState(false);
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  const [activeTab, setActiveTab] = useState("bodega"); // "bodega" | "domicilio" | "paqueteria"
  const [filterInstagram, setFilterInstagram] = useState("");

  // modal entrega manual
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualType, setManualType] = useState("bodega");
  const [manualForm, setManualForm] = useState({
    instagram: "",
    fullName: "",
    phone: "",
    address: "",
    date: "",
    city: "",
  });
  const [manualMsg, setManualMsg] = useState("");
  const [manualError, setManualError] = useState("");

  // leer si ya estaba loggeado en localStorage
  useEffect(() => {
    const saved = localStorage.getItem("panelAuth");
    if (saved === "true") setAuthorized(true);
  }, []);

  // 🟣 obtener bookings reales desde la API (Supabase) con token
  const fetchBookings = async () => {
    setLoadingData(true);
    try {
      const token = localStorage.getItem("panelToken") || "";

      const res = await fetch("/api/bookings", {
        headers: {
          "x-panel-token": token,
        },
      });

      // si el backend dijo "no"
      if (!res.ok) {
        console.warn("No autorizado para leer bookings");
        setBookings([]);
        setSlots(null);
        return;
      }

      const data = await res.json();
      setBookings(data.bookings || []);
      setSlots(data.slots || null);
    } catch (err) {
      console.error("Error al leer entregas:", err);
    } finally {
      setLoadingData(false);
    }
  };

  // cuando ya está autorizado, cargar datos
  useEffect(() => {
    if (authorized) fetchBookings();
  }, [authorized]);

  // 🔑 login con API + fallback con env
  const handleSubmit = async (e) => {
    e.preventDefault();
    setMessage("Verificando...");

    try {
      const res = await fetch("/api/login-panel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();

      // ✅ si la API responde correctamente y trae token
      if (res.ok && data.success && data.token) {
        localStorage.setItem("panelAuth", "true");
        localStorage.setItem("panelToken", data.token);
        setAuthorized(true);
        setMessage("");
        return;
      }
    } catch (err) {
      console.warn("Error al conectar con la API de login:", err);
    }

    // 🔁 Plan B: comparar con la variable local si la API falló
    if (password === PANEL_PASSWORD_ENV) {
      setAuthorized(true);
      localStorage.setItem("panelAuth", "true");
      setMessage("");
    } else {
      setMessage("❌ Contraseña incorrecta.");
    }
  };

  // 🔹 Marcar paquetería como cotizada (con token)
  const handleMarkCotizado = async (id) => {
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/bookings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-panel-token": token,
        },
        body: JSON.stringify({ id, status: "cotizado" }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || "No se pudo actualizar.");
        return;
      }
      fetchBookings();
    } catch (err) {
      alert("Error de conexión.");
    }
  };

  // eliminar (con token)
  const handleDelete = async (id) => {
    if (!confirm("¿Eliminar esta entrega?")) return;
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/bookings?id=${id}`, {
        method: "DELETE",
        headers: {
          "x-panel-token": token,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || "No se pudo eliminar.");
      } else {
        fetchBookings();
      }
    } catch (err) {
      alert("Error de conexión.");
    }
  };

  // 1️⃣ filtrar por pestaña
  const bookingsByTab = bookings.filter((bk) => {
    if (activeTab === "bodega") return bk.type === "bodega";
    if (activeTab === "domicilio") return bk.type === "domicilio";
    if (activeTab === "paqueteria") return bk.type === "paqueteria";
    return false;
  });

  // 2️⃣ filtrar por fecha
  const filteredByDate = bookingsByTab.filter((bk) => {
    if (!bk.date) return true;
    const date = new Date(bk.date);
    const start = filterStart ? new Date(filterStart) : null;
    const end = filterEnd ? new Date(filterEnd) : null;
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
  });

  // 3️⃣ filtrar por Instagram
  const finalFilteredBookings = filteredByDate.filter((bk) => {
    if (!filterInstagram) return true;
    if (!bk.instagram) return false;
    return bk.instagram.toLowerCase().includes(filterInstagram.toLowerCase());
  });

  // agregar entrega manual (con token)
  const handleManualSubmit = async (e) => {
    e.preventDefault();
    setManualError("");
    setManualMsg("");

    const { instagram, fullName, phone, address, date, city } = manualForm;
    if (!instagram || !fullName || !phone || !date) {
      setManualError("Faltan campos obligatorios.");
      return;
    }

    try {
      const token = localStorage.getItem("panelToken") || "";

      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-panel-token": token,
        },
        body: JSON.stringify({
          type: manualType,
          instagram,
          fullName,
          phone,
          address,
          city,
          date,
          override: true, // 👈 esto le dice al backend que viene del panel
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setManualError(data.message || "Error al crear entrega.");
      } else {
        setManualMsg("✅ Entrega manual agregada correctamente.");
        await fetchBookings();
        setManualForm({
          instagram: "",
          fullName: "",
          phone: "",
          address: "",
          date: "",
          city: "",
        });
        setTimeout(() => setShowManualModal(false), 1000);
      }
    } catch {
      setManualError("Error de conexión con el servidor.");
    }
  };

  // 👮 vista de login
  if (!authorized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 relative">
        {/* 🔹 Botón para volver al inicio */}
        <a
          href="/"
          className="absolute top-6 left-6 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-4 py-2 rounded-lg shadow"
        >
          🏠 Inicio
        </a>

        {/* 🔹 Formulario de acceso */}
        <form
          onSubmit={handleSubmit}
          className="bg-white shadow-lg rounded-xl p-6 w-80 flex flex-col gap-4"
        >
          <h1 className="text-xl font-semibold text-gray-800 text-center">
            Acceso al Panel
          </h1>
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="bg-emerald-500 hover:bg-emerald-600 text-white py-2 rounded-lg font-semibold"
          >
            Entrar
          </button>
          {message && (
            <p className="text-sm text-center text-gray-600">{message}</p>
          )}
        </form>
      </div>
    );
  }

  // ✅ vista del panel
  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8">
      {/* inicio */}
      <div className="mb-4 flex justify-between items-center">
        <a
          href="/"
          className="inline-flex items-center gap-2 text-sm text-emerald-600 hover:text-emerald-700 font-medium"
        >
          🏠 Inicio
        </a>
        <button
          onClick={() => setShowManualModal(true)}
          className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-3 py-2 rounded-lg shadow"
        >
          ➕ Agregar entrega manual
        </button>
      </div>

      {/* header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Panel de entregas</h1>
          <p className="text-sm text-slate-500">
            Administra, filtra y agrega entregas de forma manual.
          </p>
        </div>
        <button
          onClick={() => {
            localStorage.removeItem("panelAuth");
            localStorage.removeItem("panelToken");
            setAuthorized(false);
          }}
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          Cerrar sesión
        </button>
      </header>

      {/* pestañas */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab("bodega")}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
            activeTab === "bodega"
              ? "bg-emerald-500 text-white"
              : "bg-white text-slate-600"
          }`}
        >
          Entregas en bodega
        </button>
        <button
          onClick={() => setActiveTab("domicilio")}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
            activeTab === "domicilio"
              ? "bg-emerald-500 text-white"
              : "bg-white text-slate-600"
          }`}
        >
          Entregas a domicilio
        </button>
        <button
          onClick={() => setActiveTab("paqueteria")}
          className={`px-4 py-2 rounded-lg text-sm font-semibold ${
            activeTab === "paqueteria"
              ? "bg-emerald-500 text-white"
              : "bg-white text-slate-600"
          }`}
        >
          Paquetería
        </button>
      </div>

      {/* filtros */}
      <div className="bg-white rounded-xl shadow p-4 mb-6 flex flex-col md:flex-row md:items-end gap-4">
        <div>
          <label className="block text-sm font-medium mb-1 text-slate-700">
            Desde
          </label>
          <input
            type="date"
            value={filterStart}
            onChange={(e) => setFilterStart(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm w-full md:w-48"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1 text-slate-700">
            Hasta
          </label>
          <input
            type="date"
            value={filterEnd}
            onChange={(e) => setFilterEnd(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm w-full md:w-48"
          />
        </div>
        {/* 🔎 filtro por instagram */}
        <div>
          <label className="block text-sm font-medium mb-1 text-slate-700">
            Instagram
          </label>
          <input
            type="text"
            value={filterInstagram}
            onChange={(e) => setFilterInstagram(e.target.value)}
            placeholder="@usuario"
            className="border rounded-lg px-3 py-2 text-sm w-full md:w-52"
          />
        </div>
        <button
          onClick={() => {
            setFilterStart("");
            setFilterEnd("");
            setFilterInstagram("");
          }}
          className="text-sm bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-lg"
        >
          Limpiar filtro
        </button>
        {loadingData && (
          <span className="text-xs text-slate-400">Cargando…</span>
        )}
      </div>

      {/* tabla */}
      <div className="bg-white rounded-xl shadow overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">
            {activeTab === "bodega"
              ? "Entregas en bodega"
              : activeTab === "domicilio"
              ? "Entregas a domicilio"
              : "Paquetería"}
          </h2>
          <p className="text-xs text-slate-400">
            {finalFilteredBookings.length} registro(s)
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left py-2 px-3">Cliente</th>
                {activeTab === "domicilio" && (
                  <th className="text-left py-2 px-3">Dirección</th>
                )}
                {activeTab === "paqueteria" && (
                  <>
                    <th className="text-left py-2 px-3">Dirección</th>
                    <th className="text-left py-2 px-3">Ciudad / Estado</th>
                    <th className="text-left py-2 px-3">Estado</th>
                  </>
                )}
                <th className="text-left py-2 px-3">Fecha programada</th>
                <th className="text-left py-2 px-3">Fecha registro</th>
                <th className="text-left py-2 px-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {finalFilteredBookings.length === 0 ? (
                <tr>
                  <td
                    colSpan={
                      activeTab === "paqueteria"
                        ? 7
                        : activeTab === "domicilio"
                        ? 5
                        : 4
                    }
                    className="text-center py-6 text-slate-400 text-sm"
                  >
                    No hay entregas en este rango.
                  </td>
                </tr>
              ) : (
                finalFilteredBookings
                  .slice()
                  .reverse()
                  .map((bk) => (
                    <tr key={bk.id} className="border-t">
                      <td className="py-2 px-3">
                        <p className="font-medium">{bk.fullName}</p>
                        {bk.instagram && (
                          <p className="text-xs text-slate-500">
                            IG: {bk.instagram}
                          </p>
                        )}
                        {bk.phone && (
                          <p className="text-xs text-slate-500">
                            📞 {bk.phone}
                          </p>
                        )}
                        {/* mostrar día de bodega si viene */}
                        {bk.type === "bodega" && bk.day && (
                          <p className="text-xs text-slate-400">
                            Día:{" "}
                            {bk.day === "tuesday"
                              ? "Martes"
                              : bk.day === "thursday"
                              ? "Jueves"
                              : bk.day}
                          </p>
                        )}
                      </td>

                      {activeTab === "domicilio" && (
  <td className="py-2 px-3 text-xs text-slate-500 max-w-xs">
    {bk.address || "—"}
    {bk.notes && (
      <p className="text-[11px] text-slate-400 mt-1">📝 {bk.notes}</p>
    )}
  </td>
)}


                      {activeTab === "paqueteria" && (
                        <>
                          <td className="py-2 px-3 text-xs text-slate-500 max-w-xs">
                            {bk.address || "—"}
                          </td>
                          <td className="py-2 px-3 text-xs text-slate-500 max-w-xs">
                            {bk.city || "—"}
                          </td>
                          <td className="py-2 px-3 text-xs text-slate-500">
                            {bk.status === "cotizado" ? (
                              <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2 py-1 rounded">
                                ✅ Cotizado
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-2 py-1 rounded">
                                ⏱ Pendiente
                              </span>
                            )}
                          </td>
                        </>
                      )}

                      <td className="py-2 px-3 text-sm">
                        {bk.date
                          ? new Date(bk.date).toLocaleDateString("es-MX", {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                            })
                          : "—"}
                      </td>
                      <td className="py-2 px-3 text-xs text-slate-400">
                        {bk.createdAt
                          ? new Date(bk.createdAt).toLocaleString("es-MX")
                          : "—"}
                      </td>
                      <td className="py-2 px-3 text-xs flex gap-3">
                        {activeTab === "paqueteria" &&
                          bk.status !== "cotizado" && (
                            <button
                              onClick={() => handleMarkCotizado(bk.id)}
                              className="text-emerald-600 hover:text-emerald-800"
                            >
                              Marcar cotizado
                            </button>
                          )}
                        <button
                          onClick={() => handleDelete(bk.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* modal entrega manual */}
      {showManualModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md relative">
            <button
              onClick={() => setShowManualModal(false)}
              className="absolute top-2 right-3 text-slate-400 hover:text-slate-600"
            >
              ✖
            </button>
            <h2 className="text-lg font-semibold mb-4">
              Agregar entrega manual
            </h2>

            <form onSubmit={handleManualSubmit} className="space-y-3">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Tipo de entrega
                </label>
                <select
                  value={manualType}
                  onChange={(e) => setManualType(e.target.value)}
                  className="border rounded-lg px-3 py-2 text-sm w-full"
                >
                  <option value="bodega">Bodega</option>
                  <option value="domicilio">Domicilio</option>
                  <option value="paqueteria">Paquetería</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Instagram *
                </label>
                <input
                  value={manualForm.instagram}
                  onChange={(e) =>
                    setManualForm({ ...manualForm, instagram: e.target.value })
                  }
                  className="border rounded-lg px-3 py-2 text-sm w-full"
                  placeholder="@usuario"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Nombre completo *
                </label>
                <input
                  value={manualForm.fullName}
                  onChange={(e) =>
                    setManualForm({ ...manualForm, fullName: e.target.value })
                  }
                  className="border rounded-lg px-3 py-2 text-sm w-full"
                  placeholder="Nombre y apellidos"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Teléfono *
                </label>
                <input
                  value={manualForm.phone}
                  onChange={(e) =>
                    setManualForm({ ...manualForm, phone: e.target.value })
                  }
                  className="border rounded-lg px-3 py-2 text-sm w-full"
                  placeholder="871..."
                />
              </div>

              {(manualType === "domicilio" || manualType === "paqueteria") && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Dirección
                  </label>
                  <textarea
                    value={manualForm.address}
                    onChange={(e) =>
                      setManualForm({
                        ...manualForm,
                        address: e.target.value,
                      })
                    }
                    className="border rounded-lg px-3 py-2 text-sm w-full"
                    placeholder="Calle, número, colonia..."
                  />
                </div>
              )}

              {manualType === "paqueteria" && (
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Ciudad / Estado
                  </label>
                  <input
                    value={manualForm.city}
                    onChange={(e) =>
                      setManualForm({ ...manualForm, city: e.target.value })
                    }
                    className="border rounded-lg px-3 py-2 text-sm w-full"
                    placeholder="CDMX, Monterrey, Durango..."
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-medium mb-1">
                  Fecha *
                </label>
                <input
                  type="date"
                  value={manualForm.date}
                  onChange={(e) =>
                    setManualForm({ ...manualForm, date: e.target.value })
                  }
                  className="border rounded-lg px-3 py-2 text-sm w-full"
                />
              </div>

              <button
                type="submit"
                className="bg-emerald-500 hover:bg-emerald-600 text-white py-2 rounded-lg text-sm font-semibold w-full"
              >
                Guardar entrega
              </button>
              {manualMsg && (
                <p className="text-emerald-600 text-sm text-center mt-2">
                  {manualMsg}
                </p>
              )}
              {manualError && (
                <p className="text-red-600 text-sm text-center mt-2">
                  {manualError}
                </p>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}













