"use client";
import { useEffect, useState } from "react";

// 🔑 leemos de env (Vercel) o dejamos MELANNY como fallback
const PANEL_PASSWORD_ENV =
  process.env.NEXT_PUBLIC_PANEL_PASSWORD ||
  process.env.PANEL_PASSWORD ||
  "MELANNY";

// 👇👇👇 helpers para NO usar UTC
function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d); // local
}

function formatShortMX(dateStr) {
  const d = parseLocalDate(dateStr);
  if (!d) return "—";
  return d.toLocaleDateString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatBlockedMX(dateStr) {
  const d = parseLocalDate(dateStr);
  if (!d) return "—";
  return d.toLocaleDateString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

// ✅ para poner la fecha de HOY en los filtros
function getTodayInputDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ✅ para comparar IG
function normalizeInstagram(ig) {
  if (!ig) return "";
  let v = ig.trim();
  if (v.startsWith("@")) v = v.slice(1);
  return v.toLowerCase();
}

export default function PanelPage() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [bookings, setBookings] = useState([]);
  const [slots, setSlots] = useState(null);
  const [blockedDays, setBlockedDays] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  const [activeTab, setActiveTab] = useState("bodega");
  const [filterInstagram, setFilterInstagram] = useState("");

  // bloqueo rápido
  const [blockDate, setBlockDate] = useState("");
  const [blockType, setBlockType] = useState("domicilio");
  const [blockReason, setBlockReason] = useState("");

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

  // modal historial
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyInstagram, setHistoryInstagram] = useState("");
  const [historyBookings, setHistoryBookings] = useState([]);

  // 🆕 modal reagendar
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [bookingToReschedule, setBookingToReschedule] = useState(null);

  // leer si ya estaba loggeado
  useEffect(() => {
    const saved = localStorage.getItem("panelAuth");
    if (saved === "true") setAuthorized(true);
  }, []);

  // 🟣 obtener bookings desde API
  const fetchBookings = async () => {
    setLoadingData(true);
    try {
      const token = localStorage.getItem("panelToken") || "";

      const res = await fetch("/api/bookings", {
        headers: {
          "x-panel-token": token,
        },
      });

      if (!res.ok) {
        console.warn("No autorizado para leer bookings");
        setBookings([]);
        setSlots(null);
        setBlockedDays([]);
        return;
      }

      const data = await res.json();
      setBookings(data.bookings || []);
      setSlots(data.slots || null);
      setBlockedDays(data.blockedDays || []);
    } catch (err) {
      console.error("Error al leer entregas:", err);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (authorized) fetchBookings();
  }, [authorized]);

  // login
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

    if (password === PANEL_PASSWORD_ENV) {
      setAuthorized(true);
      localStorage.setItem("panelAuth", "true");
      setMessage("");
    } else {
      setMessage("❌ Contraseña incorrecta.");
    }
  };

  // marcar paquetería como cotizada
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

  // eliminar
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

  // bloquear día
  const handleBlockDay = async () => {
    if (!blockDate) {
      alert("Selecciona una fecha para bloquear.");
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
          action: "block-day",
          date: blockDate,
          type: blockType,
          reason: blockReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || "No se pudo bloquear el día.");
        return;
      }
      await fetchBookings();
      setBlockDate("");
      setBlockReason("");
    } catch (err) {
      alert("Error de conexión.");
    }
  };

  // quitar bloqueo
  const handleUnblock = async (blockedId) => {
    if (!confirm("¿Quitar este bloqueo?")) return;
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/bookings?blockedId=${blockedId}`, {
        method: "DELETE",
        headers: {
          "x-panel-token": token,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || "No se pudo quitar.");
      } else {
        fetchBookings();
      }
    } catch (err) {
      alert("Error de conexión.");
    }
  };

  // agregar manual
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
          override: true,
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

  // historial por IG
  const openHistoryForInstagram = (igRaw) => {
    const igNorm = normalizeInstagram(igRaw);
    if (!igNorm) return;
    const allForThisUser = bookings
      .filter((bk) => normalizeInstagram(bk.instagram) === igNorm)
      .sort((a, b) => {
        const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return db - da;
      });
    setHistoryInstagram(igRaw);
    setHistoryBookings(allForThisUser);
    setShowHistoryModal(true);
  };

  // 🆕 abrir modal reagendar
  const handleOpenReschedule = (booking) => {
    setBookingToReschedule(booking);
    setShowRescheduleModal(true);
  };

  // 👮 vista login
  if (!authorized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 relative">
        <a
          href="/"
          className="absolute top-6 left-6 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-4 py-2 rounded-lg shadow"
        >
          🏠 Inicio
        </a>

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

  // filtros
  // 🆕 hoy sin horas
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 🆕 saber si hay filtros activos
  const hasAnyFilter =
    (filterStart && filterStart !== "") ||
    (filterEnd && filterEnd !== "") ||
    (filterInstagram && filterInstagram.trim() !== "");

  const bookingsByTab = bookings.filter((bk) => {
    if (activeTab === "bodega") return bk.type === "bodega";
    if (activeTab === "domicilio") return bk.type === "domicilio";
    if (activeTab === "paqueteria") return bk.type === "paqueteria";
    return false;
  });

  const filteredByDate = bookingsByTab.filter((bk) => {
    if (!bk.date) return true;
    const date = parseLocalDate(bk.date);
    const start = filterStart ? parseLocalDate(filterStart) : null;
    const end = filterEnd ? parseLocalDate(filterEnd) : null;

    // 🆕 si NO hay filtros, ocultar todo lo que sea antes de HOY
    if (!hasAnyFilter && date < today) return false;

    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
  });

  const finalFilteredBookings = filteredByDate.filter((bk) => {
    if (!filterInstagram) return true;
    if (!bk.instagram) return false;
    return bk.instagram.toLowerCase().includes(filterInstagram.toLowerCase());
  });

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

      {/* filtros + bloqueador */}
      <div className="bg-white rounded-xl shadow p-4 mb-6 flex flex-col md:flex-row md:items-end gap-6 justify-between">
        {/* filtros */}
        <div className="flex flex-wrap gap-4">
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

          {(activeTab === "bodega" || activeTab === "domicilio") && (
            <button
              onClick={() => {
                const todayInput = getTodayInputDate();
                setFilterStart(todayInput);
                setFilterEnd(todayInput);
              }}
              className="text-sm bg-emerald-100 hover:bg-emerald-200 px-3 py-2 rounded-lg h-10 mt-6"
            >
              Hoy
            </button>
          )}

          <button
            onClick={() => {
              setFilterStart("");
              setFilterEnd("");
              setFilterInstagram("");
            }}
            className="text-sm bg-slate-100 hover:bg-slate-200 px-3 py-2 rounded-lg h-10 mt-6"
          >
            Limpiar filtro
          </button>
          {loadingData && (
            <span className="text-xs text-slate-400 mt-8">Cargando…</span>
          )}
        </div>

        {/* bloqueador */}
        <div className="bg-slate-50 rounded-lg p-3 flex flex-col gap-2 w-full md:w-80">
          <p className="text-sm font-semibold text-slate-700 flex items-center gap-1">
            ⛔ Bloquear día
          </p>
          <input
            type="date"
            value={blockDate}
            onChange={(e) => setBlockDate(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={blockType}
            onChange={(e) => setBlockType(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            <option value="domicilio">Domicilio</option>
            <option value="bodega">Bodega</option>
          </select>
          <input
            type="text"
            value={blockReason}
            onChange={(e) => setBlockReason(e.target.value)}
            placeholder="Motivo (opcional)"
            className="border rounded-lg px-3 py-2 text-sm"
          />
          <button
            onClick={handleBlockDay}
            className="bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg py-2"
          >
            Guardar bloqueo
          </button>
        </div>
      </div>

      {/* lista de bloqueos */}
      {blockedDays && blockedDays.length > 0 && (
        <div className="bg-white rounded-xl shadow p-4 mb-6">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">
            Días bloqueados
          </h2>
          <div className="flex flex-wrap gap-2">
            {blockedDays.map((bd) => (
              <div
                key={bd.id}
                className="flex items-center gap-2 bg-slate-100 rounded-full px-3 py-1 text-xs"
              >
                <span>
                  {formatBlockedMX(bd.date)} —{" "}
                  {bd.type === "domicilio" ? "Domicilio" : "Bodega"}
                  {bd.reason ? ` · ${bd.reason}` : ""}
                </span>
                <button
                  onClick={() => handleUnblock(bd.id)}
                  className="text-red-500 hover:text-red-700 text-xs"
                >
                  Quitar
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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
                  <>
                    <th className="text-left py-2 px-3">Dirección</th>
                    <th className="text-left py-2 px-3">
                      Ciudad / Estado / C.P.
                    </th>
                  </>
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
                        ? 6
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
                          <button
                            type="button"
                            onClick={() => openHistoryForInstagram(bk.instagram)}
                            className="text-xs text-emerald-600 hover:text-emerald-800 underline"
                          >
                            {bk.instagram}
                          </button>
                        )}
                        {bk.phone && (
                          <p className="text-xs text-slate-500">
                            📞 {bk.phone}
                          </p>
                        )}
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
                        <>
                          <td className="py-2 px-3 text-xs text-slate-500 max-w-xs">
                            {bk.address || "—"}
                            {bk.notes && (
                              <p className="text-[11px] text-slate-400 mt-1">
                                📝 {bk.notes}
                              </p>
                            )}
                          </td>
                          <td className="py-2 px-3 text-xs text-slate-500">
                            {bk.city || bk.state || bk.postal_code ? (
                              <div className="space-y-1">
                                {bk.city && <p>🏙 {bk.city}</p>}
                                {bk.state && <p>🗺 {bk.state}</p>}
                                {bk.postal_code && (
                                  <p>📮 C.P.: {bk.postal_code}</p>
                                )}
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                        </>
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
                        {bk.date ? formatShortMX(bk.date) : "—"}
                      </td>
                      <td className="py-2 px-3 text-xs text-slate-400">
                        {bk.createdAt
                          ? new Date(bk.createdAt).toLocaleString("es-MX")
                          : "—"}
                      </td>
                      <td className="py-2 px-3 text-xs flex gap-3 flex-wrap">
                        {/* 🆕 botón reagendar */}
                        <button
                          onClick={() => handleOpenReschedule(bk)}
                          className="text-emerald-600 hover:text-emerald-800"
                        >
                          Reagendar
                        </button>

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

      {/* modal historial por IG */}
      {showHistoryModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 relative">
            <button
              onClick={() => setShowHistoryModal(false)}
              className="absolute top-3 right-4 text-slate-400 hover:text-slate-600 text-lg"
            >
              ✖
            </button>
            <h2 className="text-lg font-semibold text-slate-900 mb-1">
              Historial de {historyInstagram}
            </h2>
            <p className="text-xs text-slate-500 mb-4">
              {historyBookings.length} entrega(s) registradas
            </p>

            {historyBookings.length === 0 ? (
              <p className="text-sm text-slate-400">
                No hay entregas para este cliente.
              </p>
            ) : (
              <ul className="space-y-3">
                {historyBookings.map((h) => (
                  <li
                    key={h.id}
                    className="border border-slate-100 rounded-lg p-3 bg-slate-50"
                  >
                    <p className="text-xs text-slate-400 mb-1">
                      {h.createdAt
                        ? new Date(h.createdAt).toLocaleString("es-MX")
                        : ""}
                    </p>
                    <p className="text-sm">
                      <span className="font-semibold">
                        {h.type === "bodega"
                          ? "Entrega en bodega"
                          : h.type === "domicilio"
                          ? "Entrega a domicilio"
                          : "Paquetería"}
                      </span>{" "}
                      · {h.date ? formatShortMX(h.date) : "sin fecha"}
                    </p>
                    {h.address && (
                      <p className="text-xs text-slate-600 mt-1">
                        📍 {h.address}
                      </p>
                    )}
                    {(h.city || h.state || h.postal_code) && (
                      <p className="text-[11px] text-slate-500 mt-1">
                        {h.city ? `🏙 ${h.city} · ` : ""}
                        {h.state ? `🗺 ${h.state} · ` : ""}
                        {h.postal_code ? `📮 C.P. ${h.postal_code}` : ""}
                      </p>
                    )}
                    {h.notes && (
                      <p className="text-[11px] text-slate-400 mt-1">
                        📝 {h.notes}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* 🆕 modal REAGENDAR */}
      {showRescheduleModal && bookingToReschedule && (
        <RescheduleModal
          booking={bookingToReschedule}
          onClose={() => {
            setShowRescheduleModal(false);
            setBookingToReschedule(null);
          }}
          onSaved={async () => {
            await fetchBookings();
            setShowRescheduleModal(false);
            setBookingToReschedule(null);
          }}
        />
      )}
    </div>
  );
}

// 🆕 componente modal reagendar
function RescheduleModal({ booking, onClose, onSaved }) {
  const [newDate, setNewDate] = useState(booking.date || "");
  const [saving, setSaving] = useState(false);
  const today = getTodayInputDate();

  const handleSave = async () => {
    if (!newDate) {
      alert("Selecciona una fecha");
      return;
    }
    try {
      setSaving(true);
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/bookings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-panel-token": token,
        },
        body: JSON.stringify({
          action: "reschedule",
          id: booking.id,
          date: newDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || "No se pudo reagendar");
        return;
      }
      onSaved?.();
    } catch (err) {
      alert("Error de conexión");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-3">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-4 text-slate-400 hover:text-slate-700"
        >
          ✖
        </button>
        <h2 className="text-lg font-semibold mb-2">
          Reagendar a {booking.fullName || booking.instagram}
        </h2>
        <p className="text-xs text-slate-500 mb-4">
          Actual: {booking.date ? formatShortMX(booking.date) : "sin fecha"}
        </p>

        <label className="text-sm font-medium text-slate-700 mb-1 block">
          Nueva fecha
        </label>
        <input
          type="date"
          value={newDate}
          min={today}
          onChange={(e) => setNewDate(e.target.value)}
          className="border rounded-lg px-3 py-2 w-full mb-4"
        />

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border text-slate-600"
            disabled={saving}
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-lg bg-emerald-500 text-white font-medium hover:bg-emerald-600"
            disabled={saving}
          >
            {saving ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}




















