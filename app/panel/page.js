"use client";
import { useEffect, useState } from "react";

// 🔑 leemos de env (Vercel) o dejamos MELANNY como fallback
const PANEL_PASSWORD_ENV =
  process.env.NEXT_PUBLIC_PANEL_PASSWORD ||
  process.env.PANEL_PASSWORD ||
  "MELANNY";

// 💵 dinero inicial en caja Noreste
const CASHBOX_INITIAL = 300;

// 👇 helpers fechas
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

// ✅ estilos según estado de entrega
function getDeliveryStatusClasses(status) {
  const value = (status || "pendiente").toLowerCase();

  if (value === "entregado") {
    return "bg-emerald-100 text-emerald-700 border-emerald-300";
  }

  if (value === "no_entregado") {
    return "bg-red-100 text-red-700 border-red-300";
  }

  // pendiente
  return "bg-slate-100 text-slate-700 border-slate-300";
}

// 📝 arma el mensaje de confirmación según tipo de entrega
function buildConfirmationMessage(bk) {
  const products =
    (bk.products && bk.products.trim()) || "— (sin productos capturados)";
  const adeudo =
    bk.amount_due !== undefined && bk.amount_due !== null ? bk.amount_due : 0;

  if (bk.type === "domicilio") {
    return `Hola sólo para confirmar lo que se te entregará el día de mañana:

${products}

Aún queda pendiente $${adeudo} de envío , puedes realizar transferencia (antes de tu entrega) o pagar en efectivo al recibir tu paquete 🖤

Tu entrega será después de las 3pm✨

Recuerda revisar tus productos al recibirlos con el repartidor ya que una vez entregados no hay cambios ni devoluciones. Solo podemos permanecer 10 min en el domicilio en caso de exceder este tiempo deberás agendar tu entrega nuevamente 🚚 🖤

Es correcto?✨`;
  }

  if (bk.type === "bodega") {
    return `Hola sólo para confirmar lo que se te entregará el día de mañana:

${products}

Aún queda pendiente $${adeudo} de envío , puedes realizar transferencia (antes de tu entrega) o pagar en efectivo al recibir tu paquete 🖤

Puedes pasar a recoger tus productos de 5 a 7pm✨

Recuerda revisar tus productos al recibirlos ya que una vez entregados no hay cambios ni devoluciones🖤

Es correcto?✨`;
  }

  // para paquetería u otros tipos no definimos mensaje
  return "";
}

export default function PanelPage() {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [panelRole, setPanelRole] = useState(null); // 👈 admin | driver
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

  // modal reagendar
  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [bookingToReschedule, setBookingToReschedule] = useState(null);

  // selección para formulario de edición (productos / adeudo / estado / pago)
  const [selectedBooking, setSelectedBooking] = useState(null);
  const [editForm, setEditForm] = useState({
    products: "",
    amount_due: 0,
    delivery_status: "pendiente",
    payment_method: "efectivo",
  });

  // 💵 caja Noreste
  const [cashboxLastCut, setCashboxLastCut] = useState(null);
  const [cashboxLoading, setCashboxLoading] = useState(false);
  const [showCashboxModal, setShowCashboxModal] = useState(false);

  // botón Copiar → Copiado ✓
  const [copiedBookingId, setCopiedBookingId] = useState(null);

  const isDriver = panelRole === "driver";
  const isAdmin = !isDriver;

  // leer si ya estaba loggeado
  useEffect(() => {
    const saved = localStorage.getItem("panelAuth");
    const savedRole = localStorage.getItem("panelRole");
    if (saved === "true") {
      setAuthorized(true);
      if (savedRole) setPanelRole(savedRole);
    }
  }, []);

  // si es repartidor, siempre forzamos pestaña domicilio
  useEffect(() => {
    if (authorized && isDriver) {
      setActiveTab("domicilio");
    }
  }, [authorized, isDriver]);

  // obtener bookings desde API
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

  // leer info de caja (último corte) — solo tiene sentido para admin
  const fetchCashboxInfo = async () => {
    try {
      setCashboxLoading(true);
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/cashbox", {
        headers: {
          "x-panel-token": token,
        },
      });
      if (!res.ok) {
        console.warn("No se pudo leer info de caja");
        setCashboxLastCut(null);
        return;
      }
      const data = await res.json();
      setCashboxLastCut(data.lastCut || null);
    } catch (err) {
      console.error("Error al leer caja:", err);
      setCashboxLastCut(null);
    } finally {
      setCashboxLoading(false);
    }
  };

  useEffect(() => {
    if (authorized) {
      fetchBookings();
      if (isAdmin) {
        fetchCashboxInfo();
      }
    }
  }, [authorized, isAdmin]);

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
        localStorage.setItem("panelRole", data.role || "admin");
        setPanelRole(data.role || "admin");
        setAuthorized(true);
        setMessage("");
        return;
      }
    } catch (err) {
      console.warn("Error al conectar con la API de login:", err);
    }

    // 🔙 fallback viejo: si coincide con env, lo dejamos como admin
    if (password === PANEL_PASSWORD_ENV) {
      setAuthorized(true);
      setPanelRole("admin");
      localStorage.setItem("panelAuth", "true");
      localStorage.setItem("panelRole", "admin");
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
        if (isAdmin) fetchCashboxInfo();
      }
    } catch (err) {
      alert("Error de conexión.");
    }
  };

  // bloquear día (solo admin, pero igual está oculto en UI para repartidor)
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

  // abrir modal reagendar
  const handleOpenReschedule = (booking) => {
    setBookingToReschedule(booking);
    setShowRescheduleModal(true);
  };

  // al hacer click en tarjeta
  const handleSelectBooking = (bk) => {
    setSelectedBooking(bk);
    setEditForm({
      products: bk.products || "",
      amount_due:
        bk.amount_due !== undefined && bk.amount_due !== null
          ? bk.amount_due
          : 0,
      delivery_status: bk.delivery_status || "pendiente",
      payment_method: bk.payment_method || "efectivo",
    });
  };

  // guardar info desde formulario de edición
  const handleSaveDeliveryInfo = async () => {
    if (!selectedBooking) return;

    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/bookings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-panel-token": token,
        },
        body: JSON.stringify({
          action: "update-delivery-info", // recuerda tener este caso en /api/bookings
          id: selectedBooking.id,
          products: editForm.products || "",
          amountDue: editForm.amount_due || 0,
          deliveryStatus: editForm.delivery_status || "pendiente",
          paymentMethod: editForm.payment_method || "efectivo",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || "No se pudo guardar la información.");
        return;
      }

      // actualizar en memoria (usamos lo que regrese la API)
      setBookings((prev) =>
        prev.map((b) => (b.id === selectedBooking.id ? data.booking : b))
      );

      // refrescar caja (por si cambió entregado/efectivo)
      if (isAdmin) fetchCashboxInfo();

      // cerrar formulario
      setSelectedBooking(null);
      setEditForm({
        products: "",
        amount_due: 0,
        delivery_status: "pendiente",
        payment_method: "efectivo",
      });
    } catch (err) {
      alert("Error de conexión.");
    }
  };

  // copiar mensaje al portapapeles (con botón Copiado ✓)
  const handleCopyMessage = async (bk) => {
    const text = buildConfirmationMessage(bk);

    // si por alguna razón no se generó mensaje, avisamos
    if (!text) {
      alert("No se pudo generar el mensaje para copiar.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      // cambia texto del botón 1.5s
      setCopiedBookingId(bk.id);
      setTimeout(() => {
        setCopiedBookingId((current) => (current === bk.id ? null : current));
      }, 1500);
    } catch (err) {
      console.error("No se pudo copiar el mensaje:", err);
      alert(
        "No se pudo copiar el mensaje. Revisa los permisos del navegador o cópialo manualmente."
      );
    }
  };

  // crear corte de caja
  const handleCreateCashboxCut = async ({ countedCash, note }) => {
    try {
      const token = localStorage.getItem("panelToken") || "";
      // recalculamos montos actuales (para asegurar que usamos lo último)
      const domicilioBookingsAll = bookings.filter(
        (bk) =>
          String(bk.type || "")
            .trim()
            .toLowerCase() === "domicilio"
      );

      let lastCutDate = null;
      if (cashboxLastCut && cashboxLastCut.created_at) {
        lastCutDate = new Date(cashboxLastCut.created_at);
      }

      const effectiveDeliveries = domicilioBookingsAll.filter((bk) => {
        const status = String(bk.delivery_status || "").toLowerCase();
        if (status !== "entregado") return false;

        const method = String(bk.payment_method || "efectivo").toLowerCase();
        if (method !== "efectivo") return false;

        if (lastCutDate && bk.createdAt) {
          const createdAt = new Date(bk.createdAt);
          if (createdAt <= lastCutDate) return false;
        }
        return true;
      });

      const deliveriesAmount = effectiveDeliveries.reduce((sum, bk) => {
        const v =
          bk.amount_due !== undefined && bk.amount_due !== null
            ? Number(bk.amount_due)
            : 0;
        return sum + (isNaN(v) ? 0 : v);
      }, 0);

      const expectedCash = CASHBOX_INITIAL + deliveriesAmount;

      const res = await fetch("/api/cashbox", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-panel-token": token,
        },
        body: JSON.stringify({
          route: "noreste",
          initialCash: CASHBOX_INITIAL,
          deliveriesAmount,
          expectedCash,
          countedCash,
          note: note || "",
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.message || "No se pudo guardar el corte de caja.");
        return;
      }

      setCashboxLastCut(data.cut || null);
      setShowCashboxModal(false);
    } catch (err) {
      console.error("Error al guardar corte de caja:", err);
      alert("Error de conexión al guardar el corte de caja.");
    }
  };

  // vista login
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

  // filtros (incluye lógica para ocultar días pasados cuando no hay filtros)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

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

    // si NO hay filtros, ocultar todo lo que sea antes de HOY
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

  // 💵 cálculos de caja (solo tiene sentido para domicilio, pero usamos todos bookings)
  const domicilioBookingsAll = bookings.filter(
    (bk) =>
      String(bk.type || "")
        .trim()
        .toLowerCase() === "domicilio"
  );

  let lastCutDate = null;
  if (cashboxLastCut && cashboxLastCut.created_at) {
    lastCutDate = new Date(cashboxLastCut.created_at);
  }

  const effectiveDeliveries = domicilioBookingsAll.filter((bk) => {
    const status = String(bk.delivery_status || "").toLowerCase();
    if (status !== "entregado") return false;

    const method = String(bk.payment_method || "efectivo").toLowerCase();
    if (method !== "efectivo") return false;

    if (lastCutDate && bk.createdAt) {
      const createdAt = new Date(bk.createdAt);
      if (createdAt <= lastCutDate) return false;
    }
    return true;
  });

  const deliveriesAmount = effectiveDeliveries.reduce((sum, bk) => {
    const v =
      bk.amount_due !== undefined && bk.amount_due !== null
        ? Number(bk.amount_due)
        : 0;
    return sum + (isNaN(v) ? 0 : v);
  }, 0);

  const expectedCash = CASHBOX_INITIAL + deliveriesAmount;

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

        {/* botón solo para admin */}
        {isAdmin && (
          <button
            onClick={() => setShowManualModal(true)}
            className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-3 py-2 rounded-lg shadow"
          >
            ➕ Agregar entrega manual
          </button>
        )}
      </div>

      {/* header */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isDriver ? "Panel repartidor" : "Panel de entregas"}
          </h1>
          <p className="text-sm text-slate-500">
            {isDriver
              ? "Consulta y actualiza tus entregas a domicilio."
              : "Administra, filtra y agrega entregas de forma manual."}
          </p>
        </div>
        <button
          onClick={() => {
            localStorage.removeItem("panelAuth");
            localStorage.removeItem("panelToken");
            localStorage.removeItem("panelRole");
            setAuthorized(false);
            setPanelRole(null);
          }}
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          Cerrar sesión
        </button>
      </header>

      {/* pestañas */}
      <div className="flex gap-2 mb-6">
        {/* bodega solo admin */}
        {isAdmin && (
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
        )}

        {/* domicilio todos */}
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

        {/* paquetería solo admin */}
        {isAdmin && (
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
        )}
      </div>

      {/* filtros + bloqueador + caja */}
      <div className="bg-white rounded-xl shadow p-4 mb-6 flex flex-col md:flex-row md:items-end gap-6 justify-between">
        {/* filtros (para todos) */}
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

        {/* bloqueador + caja dinero (solo admin) */}
        {isAdmin && (
          <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
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

            {/* caja Noreste: solo en pestaña domicilio */}
            {activeTab === "domicilio" && (
              <div className="bg-slate-50 rounded-lg p-3 flex flex-col gap-2 w-full md:w-72">
                <p className="text-sm font-semibold text-slate-700 flex items-center gap-1">
                  💵 Caja Noreste
                </p>
                <p className="text-xs text-slate-600">
                  Dinero inicial: <strong>${CASHBOX_INITIAL}</strong>
                </p>
                <p className="text-xs text-slate-600">
                  Entregado en efectivo desde último corte:{" "}
                  <strong>${deliveriesAmount}</strong>
                </p>
                <p className="text-xs text-slate-800 font-semibold">
                  Total esperado en caja: <strong>${expectedCash}</strong>
                </p>
                {cashboxLastCut ? (
                  <p className="text-[11px] text-slate-500">
                    Último corte:{" "}
                    {cashboxLastCut.created_at
                      ? new Date(
                          cashboxLastCut.created_at
                        ).toLocaleString("es-MX")
                      : "—"}
                    {" · "}
                    Dif: ${cashboxLastCut.difference ?? 0}
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-400">
                    Aún no hay cortes registrados.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setShowCashboxModal(true)}
                  className="mt-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold rounded-lg py-2"
                >
                  Hacer corte
                </button>
                {cashboxLoading && (
                  <span className="text-[10px] text-slate-400">
                    Actualizando caja…
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* lista de bloqueos — solo admin */}
      {isAdmin && blockedDays && blockedDays.length > 0 && (
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

      {/* tarjetas de entregas */}
      <div className="bg-white rounded-xl shadow">
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

        <div className="p-4">
          {finalFilteredBookings.length === 0 ? (
            <p className="text-center py-6 text-slate-400 text-sm">
              No hay entregas en este rango.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {finalFilteredBookings
                .slice()
                .reverse()
                .map((bk) => {
                  const isSelected =
                    selectedBooking && selectedBooking.id === bk.id;

                  const statusLabel =
                    bk.delivery_status === "entregado"
                      ? "Entregado"
                      : bk.delivery_status === "no_entregado"
                      ? "No entregado"
                      : "Pendiente";

                  return (
                    <div
                      key={bk.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectBooking(bk)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleSelectBooking(bk);
                        }
                      }}
                      className={`text-left bg-white rounded-2xl shadow-sm p-4 flex flex-col gap-2 border transition cursor-pointer hover:shadow-md hover:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-300 ${
                        isSelected
                          ? "border-emerald-400 ring-2 ring-emerald-200"
                          : "border-slate-100"
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-slate-900 truncate">
                            {bk.fullName}
                          </p>
                          {bk.instagram && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openHistoryForInstagram(bk.instagram);
                              }}
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
                            <p className="text-[11px] text-slate-400">
                              Día:{" "}
                              {bk.day === "tuesday"
                                ? "Martes"
                                : bk.day === "thursday"
                                ? "Jueves"
                                : bk.day}
                            </p>
                          )}
                        </div>

                        <span
                          className={`px-2 py-1 rounded-lg border text-[11px] font-medium whitespace-nowrap ${getDeliveryStatusClasses(
                            bk.delivery_status
                          )}`}
                        >
                          {statusLabel}
                        </span>
                      </div>

                      <div className="text-xs text-slate-700 mt-1 space-y-1">
                        <p>
                          <strong>📦 Productos:</strong>{" "}
                          {bk.products || "— (sin capturar)"}
                        </p>
                        <p>
                          <strong>💰 Adeudo:</strong> $
                          {bk.amount_due ? bk.amount_due : 0}
                        </p>
                        <p>
                          <strong>📅 Fecha programada:</strong>{" "}
                          {bk.date ? formatShortMX(bk.date) : "—"}
                        </p>
                      </div>

                      {/* detalles según tipo */}
                      {activeTab === "domicilio" && (
                        <div className="text-[11px] text-slate-600 mt-1 space-y-1">
                          <p>
                            <strong>📍 Dirección:</strong>{" "}
                            {bk.address || "—"}
                          </p>
                          {bk.city || bk.state || bk.postal_code ? (
                            <p>
                              {bk.city ? `🏙 ${bk.city} · ` : ""}
                              {bk.state ? `🗺 ${bk.state} · ` : ""}
                              {bk.postal_code
                                ? `📮 C.P. ${bk.postal_code}`
                                : ""}
                            </p>
                          ) : null}
                          {bk.notes && (
                            <p className="text-[11px] text-slate-500">
                              📝 {bk.notes}
                            </p>
                          )}
                        </div>
                      )}

                      {activeTab === "paqueteria" && (
                        <div className="text-[11px] text-slate-600 mt-1 space-y-1">
                          <p>
                            <strong>📍 Dirección:</strong>{" "}
                            {bk.address || "—"}
                          </p>
                          <p>
                            <strong>🏙 Ciudad/Estado:</strong>{" "}
                            {bk.city || "—"}
                          </p>
                          <p>
                            <strong>Estado cotización:</strong>{" "}
                            {bk.status === "cotizado"
                              ? "✅ Cotizado"
                              : "⏱ Pendiente"}
                          </p>
                        </div>
                      )}

                      {/* fecha registro y acciones */}
                      <div className="mt-2 flex flex-col gap-1">
                        <p className="text-[11px] text-slate-400">
                          Registrado:{" "}
                          {bk.createdAt
                            ? new Date(bk.createdAt).toLocaleString("es-MX")
                            : "—"}
                        </p>
                        <div className="flex flex-wrap gap-2 text-[11px] mt-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleOpenReschedule(bk);
                            }}
                            className="text-emerald-600 hover:text-emerald-800"
                          >
                            Reagendar
                          </button>

                          {activeTab === "paqueteria" &&
                            bk.status !== "cotizado" && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMarkCotizado(bk.id);
                                }}
                                className="text-emerald-600 hover:text-emerald-800"
                              >
                                Marcar cotizado
                              </button>
                            )}

                          {(bk.type === "domicilio" || bk.type === "bodega") && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyMessage(bk);
                              }}
                              className="text-sky-600 hover:text-sky-800"
                            >
                              {copiedBookingId === bk.id
                                ? "Copiado ✓"
                                : "Copiar"}
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(bk.id);
                            }}
                            className="text-red-500 hover:text-red-700"
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* mensaje cuando no hay selección */}
      {!selectedBooking && finalFilteredBookings.length > 0 && (
        <p className="text-center text-sm text-slate-500 italic mt-4">
          Selecciona una entrega para editar productos, adeudo y estado de
          entrega.
        </p>
      )}

      {/* formulario de edición de entrega como MODAL centrado */}
      {selectedBooking && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40 px-3">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-5 relative">
            <button
              type="button"
              onClick={() => {
                setSelectedBooking(null);
                setEditForm({
                  products: "",
                  amount_due: 0,
                  delivery_status: "pendiente",
                  payment_method: "efectivo",
                });
              }}
              className="absolute top-3 right-4 text-slate-400 hover:text-slate-700 text-lg"
            >
              ✖
            </button>

            <h2 className="text-lg font-semibold text-slate-900 mb-1">
              Editar entrega
            </h2>
            <p className="text-sm text-slate-500 mb-4">
              Cliente:{" "}
              <span className="font-medium">{selectedBooking.fullName}</span> ·{" "}
              {selectedBooking.instagram}
            </p>

            <div className="grid gap-4 md:grid-cols-[2fr,1fr] items-start mb-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-700">
                  Productos
                </label>
                <textarea
                  className="border rounded-lg px-2 py-1 text-sm min-h-[100px]"
                  placeholder="Productos a entregar..."
                  value={editForm.products}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, products: e.target.value }))
                  }
                />
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-700">
                    Monto adeudado (MXN)
                  </label>
                  <input
                    type="number"
                    className="border rounded-lg px-2 py-1 text-sm"
                    value={
                      editForm.amount_due === 0 ? "" : editForm.amount_due
                    }
                    placeholder="0"
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditForm((f) => ({
                        ...f,
                        amount_due: v === "" ? 0 : Number(v),
                      }));
                    }}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-700">
                    Forma de pago
                  </label>
                  <select
                    className="border rounded-lg px-2 py-1 text-xs"
                    value={editForm.payment_method}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        payment_method: e.target.value,
                      }))
                    }
                  >
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-slate-700">
                    Estado entrega
                  </label>
                  <select
                    className={`border rounded-lg px-2 py-1 text-xs ${getDeliveryStatusClasses(
                      editForm.delivery_status
                    )}`}
                    value={editForm.delivery_status}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        delivery_status: e.target.value,
                      }))
                    }
                  >
                    <option value="pendiente">Pendiente</option>
                    <option value="entregado">Entregado</option>
                    <option value="no_entregado">No entregado</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-2 text-sm">
              <button
                type="button"
                onClick={() => {
                  setSelectedBooking(null);
                  setEditForm({
                    products: "",
                    amount_due: 0,
                    delivery_status: "pendiente",
                    payment_method: "efectivo",
                  });
                }}
                className="px-4 py-2 rounded-lg border text-slate-600"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveDeliveryInfo}
                className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg font-medium"
              >
                Guardar info entrega
              </button>
            </div>
          </div>
        </div>
      )}

      {/* modal entrega manual (solo admin, porque el botón solo lo ve admin) */}
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
                    setManualForm({
                      ...manualForm,
                      instagram: e.target.value,
                    })
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
                    setManualForm({
                      ...manualForm,
                      fullName: e.target.value,
                    })
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

              {(manualType === "domicilio" ||
                manualType === "paqueteria") && (
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

      {/* modal REAGENDAR */}
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

      {/* modal CORTE DE CAJA */}
      {showCashboxModal && (
        <CashboxCutModal
          initialCash={CASHBOX_INITIAL}
          deliveriesAmount={deliveriesAmount}
          expectedCash={expectedCash}
          lastCut={cashboxLastCut}
          onClose={() => setShowCashboxModal(false)}
          onConfirm={handleCreateCashboxCut}
        />
      )}
    </div>
  );
}

// componente modal reagendar
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

// componente modal CORTE DE CAJA
function CashboxCutModal({
  initialCash,
  deliveriesAmount,
  expectedCash,
  lastCut,
  onClose,
  onConfirm,
}) {
  const [countedCash, setCountedCash] = useState(expectedCash);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (countedCash === null || countedCash === undefined || countedCash === "") {
      alert("Captura cuánto dinero hay en la caja.");
      return;
    }
    const numericCounted = Number(countedCash);
    if (isNaN(numericCounted)) {
      alert("El monto contado debe ser un número válido.");
      return;
    }
    try {
      setSaving(true);
      await onConfirm({
        countedCash: numericCounted,
        note,
      });
    } finally {
      setSaving(false);
    }
  };

  const diff = Number(countedCash || 0) - Number(expectedCash || 0);

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-3">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-4 text-slate-400 hover:text-slate-700"
        >
          ✖
        </button>
        <h2 className="text-lg font-semibold mb-2">Corte de caja Noreste</h2>
        {lastCut && lastCut.created_at && (
          <p className="text-[11px] text-slate-500 mb-2">
            Último corte:{" "}
            {new Date(lastCut.created_at).toLocaleString("es-MX")}
          </p>
        )}

        <div className="text-xs text-slate-700 space-y-1 mb-4">
          <p>
            Dinero inicial: <strong>${initialCash}</strong>
          </p>
          <p>
            Entregado en efectivo desde último corte:{" "}
            <strong>${deliveriesAmount}</strong>
          </p>
          <p>
            Total esperado en caja: <strong>${expectedCash}</strong>
          </p>
        </div>

        <div className="flex flex-col gap-2 mb-3">
          <label className="text-xs font-medium text-slate-700">
            Dinero contado en caja
          </label>
          <input
            type="number"
            className="border rounded-lg px-3 py-2 text-sm"
            value={countedCash}
            onChange={(e) => setCountedCash(e.target.value)}
          />
          <p className="text-[11px] text-slate-500">
            Diferencia:{" "}
            <span
              className={
                diff === 0
                  ? "text-slate-600"
                  : diff > 0
                  ? "text-emerald-600"
                  : "text-red-600"
              }
            >
              {diff >= 0 ? "+" : ""}
              {diff}
            </span>
          </p>
        </div>

        <div className="flex flex-col gap-2 mb-4">
          <label className="text-xs font-medium text-slate-700">
            Nota (opcional)
          </label>
          <textarea
            className="border rounded-lg px-3 py-2 text-sm"
            placeholder="Ej: Faltaron $40, cliente X dijo que pagará mañana..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-2 text-sm">
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
            {saving ? "Guardando..." : "Guardar corte"}
          </button>
        </div>
      </div>
    </div>
  );
}



























