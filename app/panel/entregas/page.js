"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const PANEL_PASSWORD_ENV =
  process.env.NEXT_PUBLIC_PANEL_PASSWORD ||
  process.env.PANEL_PASSWORD ||
  "MELANNY";

const CASHBOX_INITIAL = 300;

// 🚩 VARIABLE DE CONTROL: Cambia a true para volver a mostrar Bodega en el panel
const BODEGA_ACTIVA = true;

function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function formatShortMX(dateStr) {
  const d = parseLocalDate(dateStr);
  if (!d) return "â€”";
  return d.toLocaleDateString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function formatBlockedMX(dateStr) {
  const d = parseLocalDate(dateStr);
  if (!d) return "â€”";
  return d.toLocaleDateString("es-MX", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function getTodayInputDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeInstagram(ig) {
  if (!ig) return "";
  let v = ig.trim();
  if (v.startsWith("@")) v = v.slice(1);
  return v.toLowerCase();
}

function getStatusStyle(status) {
  const v = (status || "pendiente").toLowerCase();
  if (v === "entregado")
    return { pill: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25", dot: "bg-emerald-400" };
  if (v === "no_entregado")
    return { pill: "bg-red-500/15 text-red-400 border border-red-500/25", dot: "bg-red-400" };
  return { pill: "bg-amber-500/15 text-amber-400 border border-amber-500/25", dot: "bg-amber-400 animate-pulse" };
}

function getDeliveryStatusClasses(status) {
  return getStatusStyle(status).pill;
}

function parsePkgAddress(address) {
  if (!address) return null;
  const refIdx = address.indexOf(", Ref: ");
  const refs = refIdx !== -1 ? address.slice(refIdx + 7) : "";
  const mainPart = refIdx !== -1 ? address.slice(0, refIdx) : address;
  const parts = mainPart.split(", ");
  let street = "";
  let colonia = "";
  let cp = "";
  for (const p of parts) {
    if (p.startsWith("Col. ")) colonia = p.slice(5);
    else if (p.startsWith("CP ")) cp = p.slice(3);
    else if (!street) street = p;
  }
  return { street, colonia, cp, refs };
}

function getInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function getAvatarGradient(name) {
  const g = [
    "from-violet-500 to-purple-600",
    "from-emerald-500 to-teal-600",
    "from-blue-500 to-cyan-600",
    "from-orange-500 to-amber-600",
    "from-pink-500 to-rose-600",
    "from-indigo-500 to-blue-600",
    "from-teal-400 to-cyan-600",
  ];
  if (!name) return g[0];
  return g[name.charCodeAt(0) % g.length];
}

function buildConfirmationMessage(bk) {
  const products = (bk.products && bk.products.trim()) || "— (sin productos capturados)";
  const adeudo = bk.amount_due !== undefined && bk.amount_due !== null ? bk.amount_due : 0;

  if (bk.type === "domicilio") {
    return `Hola, sólo para confirmar lo que se te entregará:

${products}

Aún queda pendiente $${adeudo}, puedes realizar transferencia (antes de tu entrega) o pagar en efectivo al recibir tu paquete 🖤

Tu entrega será después de las 3pm✨

Recuerda revisar tus productos al recibirlos con el repartidor ya que una vez entregados no hay cambios ni devoluciones. Solo podemos permanecer 10 min en el domicilio en caso de exceder este tiempo deberás agendar tu entrega nuevamente 🚚 🖤

Es correcto?✨`;
  }

  if (bk.type === "bodega") {
    return `Hola, sólo para confirmar lo que se te entregará:

${products}

Aún queda pendiente $${adeudo}, puedes realizar transferencia (antes de tu entrega) o pagar en efectivo al recibir tu paquete 🖤

Puedes pasar a recoger tus productos de 5 a 7pm✨

Recuerda revisar tus productos al recibirlos ya que una vez entregados no hay cambios ni devoluciones 🖤

Es correcto?✨`;
  }

  return "";
}

export default function PanelPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [panelRole, setPanelRole] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [slots, setSlots] = useState(null);
  const [blockedDays, setBlockedDays] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");
  const [activeTab, setActiveTab] = useState(BODEGA_ACTIVA ? "bodega" : "domicilio");
  const [filterInstagram, setFilterInstagram] = useState("");

  const [blockDate, setBlockDate] = useState("");
  const [blockType, setBlockType] = useState("domicilio");
  const [blockReason, setBlockReason] = useState("");

  const [extraBodegaDays, setExtraBodegaDays] = useState([]);
  const [extraDate, setExtraDate] = useState("");
  const [extraReason, setExtraReason] = useState("");
  const [extraStartTime, setExtraStartTime] = useState("18:00");
  const [extraEndTime, setExtraEndTime] = useState("20:00");

  const [specialDays, setSpecialDays] = useState([]);
  const [specialDate, setSpecialDate] = useState("");
  const [specialReason, setSpecialReason] = useState("");

  const [clients, setClients] = useState([]);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [pendingItems, setPendingItems] = useState([]);
  const [selectedPendingIds, setSelectedPendingIds] = useState([]);

  const [showManualModal, setShowManualModal] = useState(false);
  const [manualType, setManualType] = useState("bodega");
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [manualForm, setManualForm] = useState({
    instagram: "",
    fullName: "",
    phone: "",
    address: "",
    date: "",
    city: "",
    products: "",
    amountDue: 0,
  });
  const [manualMsg, setManualMsg] = useState("");
  const [manualError, setManualError] = useState("");

  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [historyInstagram, setHistoryInstagram] = useState("");
  const [historyBookings, setHistoryBookings] = useState([]);

  const [showRescheduleModal, setShowRescheduleModal] = useState(false);
  const [bookingToReschedule, setBookingToReschedule] = useState(null);

  const [selectedBooking, setSelectedBooking] = useState(null);
  const [editForm, setEditForm] = useState({
    products: "",
    amount_due: 0,
    delivery_status: "pendiente",
    payment_method: "efectivo",
  });

  const [cashboxLastCut, setCashboxLastCut] = useState(null);
  const [cashboxLoading, setCashboxLoading] = useState(false);
  const [showCashboxModal, setShowCashboxModal] = useState(false);
  const [cashboxHistory, setCashboxHistory] = useState([]);
  const [cashboxHistoryLoading, setCashboxHistoryLoading] = useState(false);
  const [showCashboxHistoryModal, setShowCashboxHistoryModal] = useState(false);

  const [copiedBookingId, setCopiedBookingId] = useState(null);
  const [confirmDeleteBooking, setConfirmDeleteBooking] = useState({ show: false, id: null });
  const [isDark, setIsDark] = useState(true);

  const isDriver = panelRole === "driver";
  const isAdmin = !isDriver;

  useEffect(() => {
    const saved = localStorage.getItem("panelAuth");
    const savedRole = localStorage.getItem("panelRole");
    if (saved === "true") {
      setAuthorized(true);
      if (savedRole) {
        setPanelRole(savedRole);
        if (savedRole === "driver") setActiveTab("domicilio");
      }
    }
    const savedTheme = localStorage.getItem("panelTheme");
    if (savedTheme === "light") {
      setIsDark(false);
    } else {
      setIsDark(true);
      document.documentElement.classList.add("dark");
    }

  }, []);

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("panelTheme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("panelTheme", "light");
    }
  }, [isDark]);


  const handleSyncAllDeliveries = async () => {
    setSyncingAll(true);
    setSyncResult(null);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/panel/sync-deliveries", {
        method: "POST",
        headers: { "x-panel-token": token },
      });
      const data = await res.json();
      setSyncResult({ ok: res.ok, message: data.message, fixed: data.fixed || 0 });
      if (res.ok && data.fixed > 0) fetchBookings();
    } catch {
      setSyncResult({ ok: false, message: "Error de conexión" });
    } finally {
      setSyncingAll(false);
    }
  };

  const fetchBookings = async () => {
    setLoadingData(true);
    try {
      const token = localStorage.getItem("panelToken") || "";
      const [resB, resC] = await Promise.all([
        fetch("/api/bookings", { headers: { "x-panel-token": token } }),
        fetch("/api/clients", { headers: { "x-panel-token": token } })
      ]);

      if (!resB.ok) {
        if (resB.status === 401 || resB.status === 403) {
          localStorage.removeItem("panelAuth");
          localStorage.removeItem("panelToken");
          localStorage.removeItem("panelRole");
          setAuthorized(false);
          setPanelRole(null);
          return;
        }
        setBookings([]);
        setSlots(null);
        setBlockedDays([]);
        setExtraBodegaDays([]);
        return;
      }

      const data = await resB.json();
      setBookings(data.bookings || []);
      setSlots(data.slots || null);
      setBlockedDays(data.blockedDays || []);
      setExtraBodegaDays(data.extraBodegaDays || []);
      setSpecialDays(data.specialDays || []);

      if (resC.ok) {
        const dataC = await resC.json();
        setClients(dataC.clients || []);
      }
    } catch (err) {
      console.error("Error al leer entregas:", err);
    } finally {
      setLoadingData(false);
    }
  };

  const fetchCashboxInfo = async () => {
    try {
      setCashboxLoading(true);
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/cashbox", {
        headers: { "x-panel-token": token },
      });
      if (!res.ok) { setCashboxLastCut(null); return; }
      const data = await res.json();
      setCashboxLastCut(data.lastCut || null);
    } catch (err) {
      console.error("Error al leer caja:", err);
      setCashboxLastCut(null);
    } finally {
      setCashboxLoading(false);
    }
  };

  const fetchCashboxHistory = async () => {
    try {
      setCashboxHistoryLoading(true);
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/cashbox?history=1", {
        headers: { "x-panel-token": token },
      });
      if (!res.ok) { setCashboxHistory([]); return; }
      const data = await res.json();
      setCashboxHistory(data.cuts || []);
    } catch (err) {
      console.error("Error al leer historial de caja:", err);
      setCashboxHistory([]);
    } finally {
      setCashboxHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (authorized) {
      fetchBookings();
      if (isAdmin) fetchCashboxInfo();
    }
  }, [authorized, isAdmin]);

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

    if (password === PANEL_PASSWORD_ENV) {
      setAuthorized(true);
      setPanelRole("admin");
      localStorage.setItem("panelAuth", "true");
      localStorage.setItem("panelRole", "admin");
      setMessage("");
    } else {
      setMessage("Contraseña incorrecta.");
    }
  };

  const handleMarkCotizado = async (id) => {
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/bookings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({ id, status: "cotizado" }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.message || "No se pudo actualizar."); return; }
      fetchBookings();
    } catch (err) {
      alert("Error de conexión.");
    }
  };

  const handleDelete = async (id) => {
    setConfirmDeleteBooking({ show: false, id: null });
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/bookings?id=${id}`, {
        method: "DELETE",
        headers: { "x-panel-token": token },
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

  const handleBlockDay = async () => {
    if (!blockDate) { alert("Selecciona una fecha para bloquear."); return; }
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({ action: "block-day", date: blockDate, type: blockType, reason: blockReason }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.message || "No se pudo bloquear el día."); return; }
      await fetchBookings();
      setBlockDate("");
      setBlockReason("");
    } catch (err) {
      alert("Error de conexión.");
    }
  };

  const handleUnblock = async (blockedId) => {
    if (!confirm("¿Quitar este bloqueo?")) return;
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/bookings?blockedId=${blockedId}`, {
        method: "DELETE",
        headers: { "x-panel-token": token },
      });
      const data = await res.json();
      if (!res.ok) { alert(data.message || "No se pudo quitar."); } else { fetchBookings(); }
    } catch (err) {
      alert("Error de conexión.");
    }
  };

  const handleAddSpecialDay = async () => {
    if (!specialDate) { alert("Selecciona una fecha."); return; }
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({ action: "add-special-day", date: specialDate, reason: specialReason }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.message || "No se pudo agregar."); return; }
      await fetchBookings();
      setSpecialDate("");
      setSpecialReason("");
    } catch (err) { alert("Error de conexión."); }
  };

  const handleRemoveSpecialDay = async (id) => {
    if (!confirm("¿Quitar este día especial?")) return;
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/bookings?specialDayId=${id}`, {
        method: "DELETE",
        headers: { "x-panel-token": token },
      });
      if (res.ok) fetchBookings();
    } catch (err) { alert("Error de conexión."); }
  };

  const handleAddExtraBodegaDay = async () => {
    if (!extraDate) { alert("Selecciona una fecha para agregar."); return; }
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({
          action: "add-bodega-extra-day",
          date: extraDate,
          reason: extraReason,
          start_time: extraStartTime,
          end_time: extraEndTime,
        }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.message || "No se pudo agregar el día extra."); return; }
      await fetchBookings();
      setExtraStartTime("18:00");
      setExtraEndTime("20:00");
      setExtraDate("");
      setExtraReason("");
    } catch (err) {
      alert("Error de conexión.");
    }
  };

  const handleRemoveExtraBodegaDay = async (extraId) => {
    if (!confirm("¿Quitar este día extra de bodega?")) return;
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch(`/api/bookings?extraDayId=${extraId}`, {
        method: "DELETE",
        headers: { "x-panel-token": token },
      });
      const data = await res.json();
      if (!res.ok) { alert(data.message || "No se pudo quitar."); return; }
      await fetchBookings();
    } catch (err) {
      alert("Error de conexión.");
    }
  };

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
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({ 
          type: manualType, 
          instagram, 
          fullName, 
          phone, 
          address, 
          city, 
          date, 
          products: manualForm.products,
          amountDue: manualForm.amountDue,
          deliveryStatus: manualForm.delivery_status || "pendiente",
          sale_item_ids: selectedPendingIds,
          override: true 
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setManualError(data.message || "Error al crear entrega.");
      } else {
        setManualMsg("Entrega manual agregada correctamente.");
        await fetchBookings();
        setManualForm({ instagram: "", fullName: "", phone: "", address: "", date: "", city: "", products: "", amountDue: 0 });
        setTimeout(() => setShowManualModal(false), 1000);
      }
    } catch {
      setManualError("Error de conexión con el servidor.");
    }
  };

  const openHistoryForInstagram = (igRaw) => {
    const igNorm = normalizeInstagram(igRaw);
    if (!igNorm) return;
    const allForThisUser = bookings
      .filter((bk) => normalizeInstagram(bk.instagram) === igNorm)
      .sort((a, b) => {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
        return db - da;
      });
    setHistoryInstagram(igRaw);
    setHistoryBookings(allForThisUser);
    setShowHistoryModal(true);
  };

  const handleOpenReschedule = (booking) => {
    setBookingToReschedule(booking);
    setShowRescheduleModal(true);
  };

  const handleSelectBooking = (bk) => {
    setSelectedBooking(bk);
    setEditForm({
      products: bk.products || "",
      amount_due: bk.amount_due !== undefined && bk.amount_due !== null ? bk.amount_due : 0,
      delivery_status: bk.delivery_status || "pendiente",
      payment_method: bk.payment_method || "efectivo",
    });
  };

  const handleSaveDeliveryInfo = async () => {
    if (!selectedBooking) return;
    try {
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/bookings/update-delivery", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({
          id: selectedBooking.id,
          products: editForm.products || "",
          amountDue: editForm.amount_due || 0,
          deliveryStatus: editForm.delivery_status || "pendiente",
          paymentMethod: editForm.payment_method || "efectivo",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("Error al guardar entrega:", data.message);
        return;
      }
      setBookings((prev) => prev.map((b) => (b.id === selectedBooking.id ? data.booking : b)));
      if (isAdmin) fetchCashboxInfo();
      setSelectedBooking(null);
      setEditForm({ products: "", amount_due: 0, delivery_status: "pendiente", payment_method: "efectivo" });
    } catch (err) {
      console.error("Error de conexión:", err.message);
    }
  };

  const handleCopyMessage = async (bk) => {
    const text = buildConfirmationMessage(bk);
    if (!text) { alert("No se pudo generar el mensaje para copiar."); return; }
    try {
      await navigator.clipboard.writeText(text);
      setCopiedBookingId(bk.id);
      setTimeout(() => { setCopiedBookingId((current) => (current === bk.id ? null : current)); }, 1500);
    } catch (err) {
      console.error("No se pudo copiar el mensaje:", err);
      alert("No se pudo copiar el mensaje. Revisa los permisos del navegador.");
    }
  };

  const handleCreateCashboxCut = async ({ countedCash, note }) => {
    try {
      const token = localStorage.getItem("panelToken") || "";
      const domicilioBookingsAll = bookings.filter(
        (bk) => String(bk.type || "").trim().toLowerCase() === "domicilio"
      );
      let lastCutTimestamp = null;
      if (cashboxLastCut && cashboxLastCut.created_at) {
        lastCutTimestamp = new Date(cashboxLastCut.created_at).getTime();
      }
      const effectiveDeliveries = domicilioBookingsAll.filter((bk) => {
        const status = String(bk.delivery_status || "").toLowerCase();
        if (status !== "entregado") return false;
        const method = String(bk.payment_method || "efectivo").toLowerCase();
        if (method !== "efectivo") return false;
        if (!bk.delivered_at) return false;
        const deliveredTs = new Date(bk.delivered_at).getTime();
        if (lastCutTimestamp && deliveredTs <= lastCutTimestamp) return false;
        return true;
      });
      const deliveriesAmount = effectiveDeliveries.reduce((sum, bk) => {
        const v = bk.amount_due !== undefined && bk.amount_due !== null ? Number(bk.amount_due) : 0;
        return sum + (isNaN(v) ? 0 : v);
      }, 0);
      const expectedCash = CASHBOX_INITIAL + deliveriesAmount;
      const res = await fetch("/api/cashbox", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({ route: "noreste", initialCash: CASHBOX_INITIAL, deliveriesAmount, expectedCash, countedCash, note: note || "" }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.message || "No se pudo guardar el corte de caja."); return; }
      setCashboxLastCut(data.cut || null);
      setShowCashboxModal(false);
      if (showCashboxHistoryModal) fetchCashboxHistory();
    } catch (err) {
      console.error("Error al guardar corte de caja:", err);
      alert("Error de conexión al guardar el corte de caja.");
    }
  };


  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayInput = getTodayInputDate();

  const hasAnyFilter =
    (filterStart && filterStart !== "") ||
    (filterEnd && filterEnd !== "") ||
    (filterInstagram && filterInstagram.trim() !== "");

  const bookingsByTab = bookings.filter((bk) => {
    const t = String(bk.type || "").trim().toLowerCase();
    if (activeTab === "bodega") return t.includes("bod");
    if (activeTab === "domicilio") return t.includes("dom");
    if (activeTab === "paqueteria") return t.includes("paq");
    return false;
  });

  const filteredByDate = bookingsByTab.filter((bk) => {
    if (!bk.date) return true;
    const date = parseLocalDate(bk.date);
    const start = filterStart ? parseLocalDate(filterStart) : null;
    const end = filterEnd ? parseLocalDate(filterEnd) : null;
    
    // Si hay filtros manuales, los respetamos estrictamente
    if (start && date < start) return false;
    if (end && date > end) return false;
    
    // Si no hay filtros, ocultamos las pasadas pero dejamos las de hoy y futuro
    if (!hasAnyFilter && date < today) return false;
    
    return true;
  });

  const finalFilteredBookings = filteredByDate.filter((bk) => {
    if (!filterInstagram) return true;
    if (!bk.instagram) return false;
    return bk.instagram.toLowerCase().includes(filterInstagram.toLowerCase());
  }).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  const todayDomicilio = bookings.filter((bk) => bk.type === "domicilio" && bk.date === todayInput);
  const todayDeliveredDom = todayDomicilio.filter((bk) => String(bk.delivery_status || "pendiente").toLowerCase() === "entregado").length;
  const todayNotDeliveredDom = todayDomicilio.filter((bk) => String(bk.delivery_status || "pendiente").toLowerCase() === "no_entregado").length;
  const todayPendingDom = todayDomicilio.length - todayDeliveredDom - todayNotDeliveredDom;

  const todayBodega = bookings.filter((bk) => bk.type === "bodega" && bk.date === todayInput);
  const todayDeliveredBod = todayBodega.filter((bk) => String(bk.delivery_status || "pendiente").toLowerCase() === "entregado").length;
  const todayNotDeliveredBod = todayBodega.filter((bk) => String(bk.delivery_status || "pendiente").toLowerCase() === "no_entregado").length;
  const todayPendingBod = todayBodega.length - todayDeliveredBod - todayNotDeliveredBod;

  const domicilioBookingsAll = bookings.filter((bk) => String(bk.type || "").trim().toLowerCase() === "domicilio");
  let lastCutTimestamp = null;
  if (cashboxLastCut && cashboxLastCut.created_at) {
    lastCutTimestamp = new Date(cashboxLastCut.created_at).getTime();
  }
  const effectiveDeliveries = domicilioBookingsAll.filter((bk) => {
    const status = String(bk.delivery_status || "").toLowerCase();
    if (status !== "entregado") return false;
    const method = String(bk.payment_method || "efectivo").toLowerCase();
    if (method !== "efectivo") return false;
    if (!bk.delivered_at) return false;
    const deliveredTs = new Date(bk.delivered_at).getTime();
    if (lastCutTimestamp && deliveredTs <= lastCutTimestamp) return false;
    return true;
  });
  const deliveriesAmount = effectiveDeliveries.reduce((sum, bk) => {
    const v = bk.amount_due !== undefined && bk.amount_due !== null ? Number(bk.amount_due) : 0;
    return sum + (isNaN(v) ? 0 : v);
  }, 0);
  const expectedCash = CASHBOX_INITIAL + deliveriesAmount;

  const D = isDark;

  const inputCls = `rounded-xl px-4 py-3 text-sm border w-full focus:outline-none transition-all ${
    D
      ? "bg-white/[0.05] border-slate-200 text-slate-900 placeholder-slate-600 focus:border-emerald-500/50 focus:bg-slate-100"
      : "bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400 focus:border-emerald-400"
  }`;

  const cardCls = `rounded-3xl border ${
    D ? "bg-white border-slate-200" : "bg-white border-slate-200 shadow-sm"
  }`;

  if (!authorized) {
    return (
      <div className={`min-h-screen flex flex-col items-center justify-center p-6 transition-colors duration-500 ${D ? "bg-slate-50" : "bg-slate-100"}`}>
        <div className="w-full max-w-sm animate-in fade-in zoom-in duration-500">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-emerald-500 rounded-[2rem] flex items-center justify-center mx-auto mb-4 shadow-[0_0_40px_rgba(16,185,129,0.3)]">
              <span className="text-3xl">🚚</span>
            </div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">TRC Logística</h1>
            <p className="text-sm text-slate-500 mt-2">Ingrese su contraseña de acceso</p>
          </div>

          <form onSubmit={handleSubmit} className={`${cardCls} p-8 flex flex-col gap-4 border-2`}>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-400 ml-1">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={`${inputCls} text-center text-lg tracking-[0.5em]`}
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-bold py-4 rounded-2xl shadow-xl shadow-emerald-500/20 transition-all active:scale-[0.97] mt-2 flex items-center justify-center gap-2"
            >
              <span>Entrar al panel</span>
              <span className="text-xl">→</span>
            </button>
            {message && (
              <p className="text-center text-sm font-medium text-red-500 mt-2 animate-bounce">
                {message}
              </p>
            )}
          </form>

          <p className="text-center text-[10px] text-slate-400 mt-10 uppercase tracking-[0.2em]">
            Optimizado para repartidores · v2.0
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`min-h-screen transition-colors duration-300 ${
        D ? "bg-slate-50 text-slate-900" : "bg-slate-100 text-slate-900"
      }`}
    >
      <main className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className={`text-3xl font-bold tracking-tight ${D ? "text-slate-900" : "text-slate-900"}`}>
              {isDriver ? "Mis entregas" : "Panel de entregas"}
            </h1>
            <p className={`text-sm mt-1 ${D ? "text-slate-500" : "text-slate-500"}`}>
              {isDriver
                ? "Consulta y actualiza tus entregas a domicilio."
                : "Administra, filtra y gestiona todas las entregas."}
            </p>
          </div>
          {isAdmin && (
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSyncAllDeliveries}
                  disabled={syncingAll}
                  title="Sincroniza automáticamente todos los productos que siguen pendientes aunque su entrega ya esté marcada como entregada"
                  className="flex items-center justify-center gap-2 bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-700 text-sm font-semibold px-4 py-2.5 rounded-xl transition-all active:scale-[0.98] disabled:opacity-50"
                >
                  <span className="text-base leading-none">{syncingAll ? "⏳" : "↺"}</span>
                  <span>{syncingAll ? "Sincronizando..." : "Sincronizar entregas"}</span>
                </button>
                <button
                  onClick={() => router.push("/panel/entregas/live")}
                  className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 border border-slate-700 text-sky-400 text-sm font-semibold px-4 py-2.5 rounded-xl transition-all active:scale-[0.98]"
                >
                  <span className="text-base leading-none">📍</span>
                  <span>Ver ruta en vivo</span>
                </button>
                <button
                  onClick={() => setShowManualModal(true)}
                  className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-900 text-sm font-semibold px-4 py-2.5 rounded-xl transition-all hover:shadow-[0_0_20px_rgba(16,185,129,0.35)] active:scale-[0.98]"
                >
                  <span className="text-base leading-none">+</span>
                  <span>Nueva entrega manual</span>
                </button>
              </div>
              {syncResult && (
                <p className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${syncResult.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-600 border border-red-200"}`}>
                  {syncResult.message}
                </p>
              )}
            </div>
          )}
        </div>

        <div
          className={`inline-flex items-center gap-1 p-1 rounded-2xl mb-8 border ${
            D ? "bg-slate-50 border-white/[0.07]" : "bg-slate-200/70 border-slate-200"
          }`}
        >
          {isAdmin && BODEGA_ACTIVA && (
            <TabBtn label="Bodega" icon="📦" id="bodega" active={activeTab} onClick={setActiveTab} dark={D} />
          )}
          <TabBtn label="Domicilio" icon="🚚" id="domicilio" active={activeTab} onClick={setActiveTab} dark={D} />
          {isAdmin && (
            <TabBtn label="Paquetería" icon="📦" id="paqueteria" active={activeTab} onClick={setActiveTab} dark={D} />
          )}
        </div>

        {(activeTab === "domicilio" || activeTab === "bodega") && (
          <div className="grid sm:grid-cols-3 gap-4 mb-8">
            <StatCard
              label="Entregadas hoy"
              value={activeTab === "domicilio" ? todayDeliveredDom : todayDeliveredBod}
              sub="Marcadas como entregado"
              color="emerald"
              icon="✓"
              dark={D}
            />
            <StatCard
              label="Pendientes hoy"
              value={activeTab === "domicilio" ? todayPendingDom : todayPendingBod}
              sub="Sin marcar estado"
              color="amber"
              icon="⏳"
              dark={D}
            />
            <StatCard
              label="No entregadas hoy"
              value={activeTab === "domicilio" ? todayNotDeliveredDom : todayNotDeliveredBod}
              sub="Marcadas como no entregado"
              color="red"
              icon="✖"
              dark={D}
            />
          </div>
        )}

        {isAdmin && (
          <TrendChart bookings={bookings} activeTab={activeTab} todayStr={todayInput} dark={D} />
        )}

        <div className={`${cardCls} p-5 mb-5`}>
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${D ? "text-slate-500" : "text-slate-500"}`}>Desde</label>
              <input type="date" value={filterStart} onChange={(e) => setFilterStart(e.target.value)}
                className={inputCls.replace("w-full", "w-40")} />
            </div>
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${D ? "text-slate-500" : "text-slate-500"}`}>Hasta</label>
              <input type="date" value={filterEnd} onChange={(e) => setFilterEnd(e.target.value)}
                className={inputCls.replace("w-full", "w-40")} />
            </div>
            <div>
              <label className={`block text-xs font-medium mb-1.5 ${D ? "text-slate-500" : "text-slate-500"}`}>Instagram</label>
              <input type="text" value={filterInstagram} onChange={(e) => setFilterInstagram(e.target.value)}
                placeholder="@usuario" className={inputCls.replace("w-full", "w-44")} />
            </div>
            {(activeTab === "bodega" || activeTab === "domicilio") && (
              <button
                onClick={() => { const t = getTodayInputDate(); setFilterStart(t); setFilterEnd(t); }}
                className={`px-4 py-2 text-sm rounded-xl font-medium transition-all border ${
                  D ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20" : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                }`}
              >
                Hoy
              </button>
            )}
            {activeTab === "domicilio" && (
              <Link
                href="/panel/entregas/ruta"
                className={`px-4 py-2 text-sm rounded-xl font-bold transition-all border flex items-center gap-1.5 ${
                  D ? "bg-indigo-500/15 text-indigo-400 border-indigo-500/25 hover:bg-indigo-500/25" : "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100"
                }`}
              >
                🚛 Ruta del Día
              </Link>
            )}
            <button
              onClick={() => {
                setFilterStart("");
                setFilterEnd("");
                setFilterInstagram("");
              }}
              className={`px-4 py-2 text-sm rounded-xl font-medium transition-all border ${
                D ? "bg-slate-50 text-slate-500 border-slate-200 hover:bg-slate-100" : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
              }`}
            >
              Limpiar
            </button>

            {loadingData && (
              <span className={`text-xs self-end mb-2.5 ${D ? "text-slate-600" : "text-slate-500"}`}>
                Cargando…
              </span>
            )}
          </div>

          {hasAnyFilter && (
            <div className={`flex flex-wrap gap-2 mt-3 pt-3 border-t ${D ? "border-white/[0.06]" : "border-slate-100"}`}>
              {filterStart && (
                <FilterChip label={`Desde: ${filterStart}`} onRemove={() => setFilterStart("")} dark={D} />
              )}
              {filterEnd && (
                <FilterChip label={`Hasta: ${filterEnd}`} onRemove={() => setFilterEnd("")} dark={D} />
              )}
              {filterInstagram && (
                <FilterChip label={`IG: ${filterInstagram}`} onRemove={() => setFilterInstagram("")} dark={D} />
              )}
            </div>
          )}
        </div>

        {isAdmin && (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mb-5">
            <div className={`${cardCls} p-4`}>
              <h3 className={`text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2 ${D ? "text-slate-500" : "text-slate-500"}`}>
                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs border ${D ? "bg-red-500/10 border-red-500/20" : "bg-red-50 border-red-200"}`}>🚫</span>
                Bloquear día
              </h3>
              <div className="flex flex-col gap-2">
                <input type="date" value={blockDate} onChange={(e) => setBlockDate(e.target.value)} className={inputCls} />
                <select value={blockType} onChange={(e) => setBlockType(e.target.value)}
                  className={inputCls}>
                  <option value="domicilio">Domicilio</option>
                  <option value="bodega">Bodega</option>
                </select>
                <input type="text" value={blockReason} onChange={(e) => setBlockReason(e.target.value)}
                  placeholder="Motivo (opcional)" className={inputCls} />
                <button onClick={handleBlockDay}
                  className="bg-red-500/80 hover:bg-red-500 text-slate-900 text-sm rounded-xl py-2 font-medium transition-all">
                  Guardar bloqueo
                </button>
              </div>
            </div>

            {activeTab === "domicilio" && (
              <div className={`${cardCls} p-4`}>
                <h3 className={`text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2 ${D ? "text-slate-500" : "text-slate-500"}`}>
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs border ${D ? "bg-violet-500/10 border-violet-500/20" : "bg-violet-50 border-violet-200"}`}>⭐</span>
                  Día especial
                </h3>
                <p className={`text-[11px] mb-2 ${D ? "text-slate-600" : "text-slate-400"}`}>Abre entregas a domicilio en un día normalmente cerrado (sábado, domingo).</p>
                <div className="flex flex-col gap-2">
                  <input type="date" value={specialDate} onChange={e => setSpecialDate(e.target.value)} className={inputCls} />
                  <input type="text" value={specialReason} onChange={e => setSpecialReason(e.target.value)}
                    placeholder="Motivo (ej. Día de las Madres)" className={inputCls} />
                  <button onClick={handleAddSpecialDay}
                    className="bg-violet-500/80 hover:bg-violet-500 text-white text-sm rounded-xl py-2 font-medium transition-all">
                    Activar día especial
                  </button>
                </div>
                {specialDays.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {specialDays.map(d => (
                      <div key={d.id} className={`flex items-center gap-2 text-xs rounded-full px-3 py-1 border ${D ? "bg-violet-500/10 border-violet-500/20 text-violet-300" : "bg-violet-50 border-violet-200 text-violet-700"}`}>
                        <span>⭐ {formatBlockedMX(d.date)}{d.reason ? ` · ${d.reason}` : ""}</span>
                        <button onClick={() => handleRemoveSpecialDay(d.id)} className="opacity-50 hover:opacity-100 ml-1">×</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "bodega" && BODEGA_ACTIVA && (
              <div className={`${cardCls} p-4`}>
                <h3 className={`text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2 ${D ? "text-slate-500" : "text-slate-500"}`}>
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs border ${D ? "bg-emerald-500/10 border-emerald-500/20" : "bg-emerald-50 border-emerald-200"}`}>➕</span>
                  Día extra bodega
                </h3>
                <div className="flex flex-col gap-2">
                  <input type="date" value={extraDate} onChange={(e) => setExtraDate(e.target.value)} className={inputCls} />
                  <div className="flex gap-2">
                    <input type="time" value={extraStartTime} onChange={(e) => setExtraStartTime(e.target.value)}
                      className={inputCls} />
                    <input type="time" value={extraEndTime} onChange={(e) => setExtraEndTime(e.target.value)}
                      className={inputCls} />
                  </div>
                  <input type="text" value={extraReason} onChange={(e) => setExtraReason(e.target.value)}
                    placeholder="Motivo (opcional)" className={inputCls} />
                  <button onClick={handleAddExtraBodegaDay}
                    className="bg-emerald-500/80 hover:bg-emerald-500 text-slate-900 text-sm rounded-xl py-2 font-medium transition-all">
                    Guardar día extra
                  </button>
                </div>
              </div>
            )}

            {activeTab === "domicilio" && (
              <div className={`${cardCls} p-4`}>
                <h3 className={`text-xs font-semibold uppercase tracking-widest mb-3 flex items-center gap-2 ${D ? "text-slate-500" : "text-slate-500"}`}>
                  <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs border ${D ? "bg-amber-500/10 border-amber-500/20" : "bg-amber-50 border-amber-200"}`}>💰</span>
                  Caja Noreste
                </h3>
                <div className={`space-y-1.5 text-xs mb-3 ${D ? "text-slate-500" : "text-slate-600"}`}>
                  <div className="flex justify-between">
                    <span>Dinero inicial</span>
                    <span className="font-semibold">${CASHBOX_INITIAL}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Efectivo desde último corte</span>
                    <span className="font-semibold">${deliveriesAmount}</span>
                  </div>
                  <div className={`flex justify-between pt-2 border-t font-semibold ${D ? "border-slate-200 text-slate-800" : "border-slate-100 text-slate-900"}`}>
                    <span>Total esperado</span>
                    <span>${expectedCash}</span>
                  </div>
                </div>
                {cashboxLastCut ? (
                  <p className={`text-[11px] mb-3 ${D ? "text-slate-600" : "text-slate-500"}`}>
                    Último corte: {cashboxLastCut.created_at ? new Date(cashboxLastCut.created_at).toLocaleString("es-MX") : "—"} · Dif: ${cashboxLastCut.difference ?? 0}
                  </p>
                ) : (
                  <p className={`text-[11px] mb-3 ${D ? "text-slate-600" : "text-slate-500"}`}>Sin cortes registrados</p>
                )}
                <div className="flex flex-col gap-2">
                  <button onClick={() => setShowCashboxModal(true)}
                    className="bg-amber-500/80 hover:bg-amber-500 text-slate-900 text-xs font-semibold rounded-xl py-2 transition-all">
                    Hacer corte
                  </button>
                  <button
                    onClick={() => { setShowCashboxHistoryModal(true); if (cashboxHistory.length === 0) fetchCashboxHistory(); }}
                    className={`text-xs text-left underline transition-colors ${D ? "text-slate-600 hover:text-slate-700" : "text-slate-500 hover:text-slate-600"}`}
                  >
                    Ver historial de cortes
                  </button>
                </div>
                {cashboxLoading && <span className={`text-[10px] ${D ? "text-slate-600" : "text-slate-500"}`}>Actualizando…</span>}
              </div>
            )}
          </div>
        )}

        {isAdmin && blockedDays && blockedDays.length > 0 && (
          <div className={`${cardCls} p-4 mb-4`}>
            <h3 className={`text-xs font-semibold uppercase tracking-widest mb-3 ${D ? "text-slate-500" : "text-slate-500"}`}>
              Días bloqueados
            </h3>
            <div className="flex flex-wrap gap-2">
              {blockedDays.map((bd) => (
                <div key={bd.id}
                  className={`flex items-center gap-2 text-xs rounded-full px-3 py-1 border ${
                    D ? "bg-red-500/10 border-red-500/20 text-red-300" : "bg-red-50 border-red-200 text-red-700"
                  }`}>
                  <span>
                    {formatBlockedMX(bd.date)} — {bd.type === "domicilio" ? "Domicilio" : "Bodega"}
                    {bd.reason ? ` · ${bd.reason}` : ""}
                  </span>
                  <button onClick={() => handleUnblock(bd.id)} className="opacity-50 hover:opacity-100 ml-1">×</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {isAdmin && BODEGA_ACTIVA && activeTab === "bodega" && extraBodegaDays?.length > 0 && (
          <div className={`${cardCls} p-4 mb-4`}>
            <h3 className={`text-xs font-semibold uppercase tracking-widest mb-3 ${D ? "text-slate-500" : "text-slate-500"}`}>
              Días extra bodega
            </h3>
            <div className="flex flex-wrap gap-2">
              {extraBodegaDays.map((d) => (
                <div key={d.id}
                  className={`flex items-center gap-2 text-xs rounded-full px-3 py-1 border ${
                    D ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300" : "bg-emerald-50 border-emerald-200 text-emerald-700"
                  }`}>
                  <span>
                    {formatBlockedMX(d.date)}
                    {d.start_time && d.end_time ? ` · ${d.start_time}–${d.end_time}` : ""}
                    {d.reason ? ` · ${d.reason}` : ""}
                  </span>
                  <button onClick={() => handleRemoveExtraBodegaDay(d.id)} className="opacity-50 hover:opacity-100 ml-1">×</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className={`${cardCls} overflow-hidden`}>
          <div className={`px-5 py-4 border-b flex items-center justify-between ${D ? "border-white/[0.07]" : "border-slate-100"}`}>
            <h2 className={`font-semibold ${D ? "text-slate-900" : "text-slate-900"}`}>
              {activeTab === "bodega" ? "Entregas en bodega" : activeTab === "domicilio" ? "Entregas a domicilio" : "Paquetería"}
            </h2>
            <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${
              D ? "bg-slate-50 border-slate-200 text-slate-500" : "bg-slate-100 border-slate-200 text-slate-500"
            }`}>
              {finalFilteredBookings.length} registros
            </span>
          </div>

          <div className="p-5">
            {finalFilteredBookings.length === 0 ? (
              <div className="py-20 text-center flex flex-col items-center gap-3">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${D ? "bg-slate-50" : "bg-slate-50"}`}>
                  <span className="text-2xl opacity-40">📦</span>
                </div>
                <p className={`text-sm ${D ? "text-slate-600" : "text-slate-500"}`}>
                  No hay entregas en este rango
                </p>
              </div>
            ) : (
              <div className={`grid gap-5 ${activeTab === "paqueteria" ? "grid-cols-1 xl:grid-cols-2" : "md:grid-cols-2 xl:grid-cols-3"}`}>
                {finalFilteredBookings
                  .slice()
                  .reverse()
                  .map((bk) => {
                    const isSelected = selectedBooking && selectedBooking.id === bk.id;
                    const statusLabel =
                      bk.delivery_status === "entregado" ? "Entregado"
                      : bk.delivery_status === "no_entregado" ? "Intento fallido"
                      : "Pendiente";
                    const { pill, dot } = getStatusStyle(bk.delivery_status);
                    const initials = getInitials(bk.fullName);
                    const grad = getAvatarGradient(bk.fullName);
                    const rawPhone = (bk.phone || "").replace(/\D/g, "").replace(/^52/, "");
                    const waUrl = `https://wa.me/52${rawPhone}?text=${encodeURIComponent(buildConfirmationMessage(bk))}`;

                    if (bk.type === "paqueteria") {
                      const pkg = parsePkgAddress(bk.address);
                      return (
                        <div
                          key={bk.id}
                          onClick={() => handleSelectBooking(bk)}
                          className={`cursor-pointer rounded-2xl border-2 transition-all duration-200 overflow-hidden bg-white ${
                            isSelected ? "border-indigo-400 shadow-lg shadow-indigo-100" : "border-slate-100 hover:border-indigo-200"
                          }`}
                        >
                          {/* Header */}
                          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${grad} flex items-center justify-center flex-shrink-0 shadow`}>
                                <span className="text-white font-black text-base">{initials}</span>
                              </div>
                              <div className="min-w-0">
                                <h3 className="font-black text-slate-900 leading-tight truncate">{bk.fullName}</h3>
                                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                  {bk.instagram && <span className="text-xs font-bold text-emerald-500">@{normalizeInstagram(bk.instagram)}</span>}
                                  <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${pill}`}>
                                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dot}`} />
                                    {statusLabel}
                                  </div>
                                </div>
                                {bk.phone && (
                                  <p className="text-xs text-slate-400 mt-0.5">📱 {bk.phone}</p>
                                )}
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0 ml-3">
                              <p className="text-[10px] text-slate-400 uppercase tracking-wide">Adeudo</p>
                              <p className={`text-xl font-black leading-tight ${bk.amount_due > 0 ? "text-amber-500" : "text-slate-300"}`}>
                                ${bk.amount_due || 0}
                              </p>
                            </div>
                          </div>

                          {/* Body: 2 columns */}
                          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-100">
                            {/* Left: Address */}
                            <div className="p-5 space-y-3">
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Dirección de envío</p>
                              {pkg ? (
                                <div className="space-y-2.5">
                                  <div className="flex items-start gap-2">
                                    <span className="text-base mt-0.5 flex-shrink-0">📍</span>
                                    <div>
                                      <p className="text-sm font-bold text-slate-800 leading-snug">{pkg.street}</p>
                                      <p className="text-xs text-slate-500 mt-0.5">Col. {pkg.colonia}</p>
                                      <p className="text-xs text-slate-500">CP {pkg.cp}</p>
                                    </div>
                                  </div>
                                  {pkg.refs && (
                                    <div className="flex items-start gap-2">
                                      <span className="text-base flex-shrink-0">🗒️</span>
                                      <p className="text-xs text-slate-600 italic leading-relaxed">{pkg.refs}</p>
                                    </div>
                                  )}
                                  <div className="flex items-center gap-2">
                                    <span className="text-base flex-shrink-0">🏙️</span>
                                    <p className="text-xs font-semibold text-slate-600">{[bk.city, bk.state].filter(Boolean).join(", ")}</p>
                                  </div>
                                </div>
                              ) : (
                                <p className="text-sm text-slate-500">{bk.address || "Sin dirección"}</p>
                              )}
                            </div>

                            {/* Right: Products */}
                            <div className="p-5 space-y-3">
                              <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Productos a enviar</p>
                              <div className="flex items-start gap-2">
                                <span className="text-base flex-shrink-0">📦</span>
                                <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">{bk.products || "Sin especificar"}</p>
                              </div>
                              {bk.notes && (
                                <div className="flex items-start gap-2 pt-2 border-t border-slate-100">
                                  <span className="text-sm flex-shrink-0">📝</span>
                                  <p className="text-xs italic text-slate-500 leading-relaxed">{bk.notes}</p>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Footer: Actions */}
                          <div className="px-5 py-3 border-t border-slate-100 flex items-center gap-2 flex-wrap">
                            <button
                              onClick={(e) => { e.stopPropagation(); window.open(`tel:${bk.phone}`, "_self"); }}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors border border-slate-200 text-xs font-bold"
                            >
                              <span>📞</span> Llamar
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); window.open(waUrl, "_blank"); }}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors border border-emerald-200 text-xs font-bold"
                            >
                              <span>💬</span> WhatsApp
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleCopyMessage(bk); }}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl transition-all border text-xs font-bold ${
                                copiedBookingId === bk.id
                                  ? "bg-emerald-500 text-white border-emerald-600"
                                  : "bg-slate-50 text-slate-500 hover:bg-slate-100 border-slate-200"
                              }`}
                            >
                              <span>{copiedBookingId === bk.id ? "✅" : "📋"}</span>
                              {copiedBookingId === bk.id ? "Copiado" : "Copiar"}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleOpenReschedule(bk); }}
                              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors border border-amber-200 text-xs font-bold"
                            >
                              <span>📅</span> Fecha
                            </button>
                            <div className="ml-auto flex gap-2">
                              {isAdmin && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setConfirmDeleteBooking({ show: true, id: bk.id }); }}
                                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors border border-rose-200 text-xs font-bold"
                                >
                                  <span>🗑️</span> Eliminar
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={bk.id}
                        onClick={() => handleSelectBooking(bk)}
                        className={`text-left rounded-[2rem] p-5 flex flex-col gap-4 border-2 transition-all duration-300 cursor-pointer relative overflow-hidden ${
                          isSelected
                            ? "border-emerald-500 bg-emerald-50/50 shadow-xl scale-[1.02]"
                            : "bg-white border-slate-100 hover:border-emerald-200"
                        }`}
                      >
                        <div className="flex items-center gap-4 mt-2">
                          <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${grad} flex items-center justify-center flex-shrink-0 shadow-lg`}>
                            <span className="text-white text-xl font-black">{initials}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-black text-lg text-slate-900 leading-tight truncate">{bk.fullName}</h3>
                            <div className="flex items-center gap-2 mt-1">
                              {bk.instagram && (
                                <span className="text-sm font-bold text-emerald-500">@{normalizeInstagram(bk.instagram)}</span>
                              )}
                              <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${pill}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                                {statusLabel}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-3 bg-slate-50/50 p-4 rounded-2xl border border-slate-100">
                          <p className="font-bold text-sm text-slate-900">
                            {bk.instagram ? `@${bk.instagram.replace(/^@/, '')}` : bk.fullName}
                          </p>
                          <div className="flex items-start gap-3">
                            <span className="text-lg">📍</span>
                            <div className="flex-1">
                              <p className="text-sm font-bold text-slate-800 leading-snug">{bk.address || "Sin dirección"}</p>
                              <p className="text-[11px] text-slate-500 mt-0.5">{[bk.city, bk.postal_code ? `CP ${bk.postal_code}` : ""].filter(Boolean).join(" · ")}</p>
                            </div>
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-slate-200/50">
                            <div className="flex items-center gap-2">
                              <span className="text-lg">💰</span>
                              <span className={`text-lg font-black ${bk.amount_due > 0 ? "text-amber-600" : "text-slate-400"}`}>
                                ${bk.amount_due || 0}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-slate-500">
                              <span className="text-lg">📦</span>
                              <span className="text-xs font-bold truncate max-w-[120px]">{bk.products || "Sin productos"}</span>
                            </div>
                          </div>

                          {bk.notes && (
                            <div className="pt-2 border-t border-slate-200/50 flex items-start gap-2">
                              <span className="text-sm">📝</span>
                              <p className="text-[11px] italic text-slate-600 leading-relaxed">{bk.notes}</p>
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-3 gap-2 pt-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); window.open(`tel:${bk.phone}`, "_self"); }}
                            className="flex flex-col items-center justify-center gap-1 p-3 rounded-2xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors border border-slate-200"
                          >
                            <span className="text-xl">📞</span>
                            <span className="text-[9px] font-black uppercase">Llamar</span>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); window.open(waUrl, "_blank"); }}
                            className="flex flex-col items-center justify-center gap-1 p-3 rounded-2xl bg-emerald-100 text-emerald-700 hover:bg-emerald-200 transition-colors border border-emerald-200"
                          >
                            <span className="text-xl">💬</span>
                            <span className="text-[9px] font-black uppercase">WhatsApp</span>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); const _mu = (bk.location_url && (bk.location_url.startsWith("http://") || bk.location_url.startsWith("https://"))) ? bk.location_url : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(bk.address + " " + bk.city)}`; window.open(_mu, "_blank"); }}
                            className="flex flex-col items-center justify-center gap-1 p-3 rounded-2xl bg-sky-100 text-sky-700 hover:bg-sky-200 transition-colors border border-sky-200"
                          >
                            <span className="text-xl">🗺️</span>
                            <span className="text-[9px] font-black uppercase">Mapa</span>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCopyMessage(bk); }}
                            className={`flex flex-col items-center justify-center gap-1 p-3 rounded-2xl transition-all border ${
                              copiedBookingId === bk.id
                                ? 'bg-emerald-500 text-white border-emerald-600 animate-pulse'
                                : 'bg-slate-50 text-slate-500 hover:bg-slate-100 border-slate-200'
                            }`}
                          >
                            <span className="text-xl">{copiedBookingId === bk.id ? "✅" : "📋"}</span>
                            <span className="text-[9px] font-black uppercase">{copiedBookingId === bk.id ? "Copiado" : "Copiar"}</span>
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleOpenReschedule(bk); }}
                            className="flex flex-col items-center justify-center gap-1 p-3 rounded-2xl bg-amber-50 text-amber-700 hover:bg-amber-100 transition-colors border border-amber-200"
                          >
                            <span className="text-xl">📅</span>
                            <span className="text-[9px] font-black uppercase">Fecha</span>
                          </button>
                          {isAdmin && (
                            <button
                              onClick={(e) => { e.stopPropagation(); setConfirmDeleteBooking({ show: true, id: bk.id }); }}
                              className="flex flex-col items-center justify-center gap-1 p-3 rounded-2xl bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors border border-rose-200 shadow-sm active:scale-95"
                            >
                              <span className="text-xl">🗑️</span>
                              <span className="text-[9px] font-black uppercase">Eliminar</span>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>

        {!selectedBooking && finalFilteredBookings.length > 0 && (
          <p className={`text-center text-xs mt-4 ${D ? "text-slate-600" : "text-slate-500"}`}>
            Toca una entrega para editar productos, adeudo y estado
          </p>
        )}
      </main>

      {selectedBooking && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-40 px-4">
          <div className={`rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 relative border ${
            D ? "bg-white border-slate-200" : "bg-white border-slate-200"
          }`}>
            <button
              type="button"
              onClick={() => { setSelectedBooking(null); setEditForm({ products: "", amount_due: 0, delivery_status: "pendiente", payment_method: "efectivo" }); }}
              className={`absolute top-4 right-4 w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${
                D ? "bg-slate-50 hover:bg-slate-100 text-slate-500" : "bg-slate-100 hover:bg-slate-200 text-slate-500"
              }`}
            >
              ✖
            </button>

            <h2 className={`text-lg font-bold mb-1 ${D ? "text-slate-900" : "text-slate-900"}`}>Editar entrega</h2>
            <p className={`text-sm mb-5 ${D ? "text-slate-500" : "text-slate-500"}`}>
              {selectedBooking.fullName} · {selectedBooking.instagram}
            </p>

            <div className="grid gap-4 md:grid-cols-[2fr,1fr] items-start mb-5">
              <div className="flex flex-col gap-1.5">
                <label className={`text-xs font-medium ${D ? "text-slate-500" : "text-slate-600"}`}>Productos</label>
                <textarea
                  className={`${inputCls} min-h-[110px] resize-none`}
                  placeholder="Productos a entregar..."
                  value={editForm.products}
                  onChange={(e) => setEditForm((f) => ({ ...f, products: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className={`text-xs font-medium ${D ? "text-slate-500" : "text-slate-600"}`}>Monto adeudado (MXN)</label>
                  <input
                    type="number"
                    className={inputCls}
                    value={editForm.amount_due === 0 ? "" : editForm.amount_due}
                    placeholder="0"
                    onChange={(e) => { const v = e.target.value; setEditForm((f) => ({ ...f, amount_due: v === "" ? 0 : Number(v) })); }}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={`text-xs font-medium ${D ? "text-slate-500" : "text-slate-600"}`}>Forma de pago</label>
                  <select className={inputCls} value={editForm.payment_method}
                    onChange={(e) => setEditForm((f) => ({ ...f, payment_method: e.target.value }))}>
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={`text-xs font-medium ${D ? "text-slate-500" : "text-slate-600"}`}>Estado entrega</label>
                  <select
                    className={`${inputCls} ${getDeliveryStatusClasses(editForm.delivery_status)}`}
                    value={editForm.delivery_status}
                    onChange={(e) => setEditForm((f) => ({ ...f, delivery_status: e.target.value }))}
                  >
                    <option value="pendiente">Pendiente</option>
                    <option value="entregado">Entregado</option>
                    <option value="no_entregado">No entregado</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setSelectedBooking(null); setEditForm({ products: "", amount_due: 0, delivery_status: "pendiente", payment_method: "efectivo" }); }}
                className={`px-4 py-2 rounded-xl border text-sm transition-colors ${D ? "border-slate-200 text-slate-500 hover:bg-slate-50" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveDeliveryInfo}
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:shadow-[0_0_16px_rgba(16,185,129,0.35)]"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}

      {showManualModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className={`rounded-2xl shadow-2xl w-full max-w-md relative border ${
            D ? "bg-white border-slate-200" : "bg-white border-slate-200"
          }`}>
            <div className={`px-6 py-4 border-b flex items-center justify-between ${D ? "border-white/[0.07]" : "border-slate-100"}`}>
              <h2 className={`text-base font-bold ${D ? "text-slate-900" : "text-slate-900"}`}>Nueva entrega manual</h2>
              <button onClick={() => setShowManualModal(false)}
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${D ? "bg-slate-50 hover:bg-slate-100 text-slate-500" : "bg-slate-100 hover:bg-slate-200 text-slate-500"}`}>
                ✖
              </button>
            </div>

            <form onSubmit={handleManualSubmit} className="p-6 flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={`text-xs font-medium ${D ? "text-slate-500" : "text-slate-600"}`}>Tipo de entrega</label>
                <select value={manualType} onChange={(e) => {
                  const val = e.target.value;
                  setManualType(val);
                  // Recalcular envío al cambiar tipo
                  if (manualForm.products) {
                    const selectedItems = pendingItems.filter(i => selectedPendingIds.includes(i.id));
                    const uniqueSales = [...new Set(selectedItems.map(i => i.saleId))];
                    let totalDebt = 0;
                    uniqueSales.forEach(sid => {
                      const saleItem = pendingItems.find(i => i.saleId === sid);
                      totalDebt += (saleItem?.remainingDebt || 0);
                    });
                    const shipping = val === 'domicilio' ? 45 : 0;
                    setManualForm(prev => ({ ...prev, amountDue: totalDebt + shipping }));
                  }
                }} className={inputCls}>
                  <option value="bodega">Bodega</option>
                  <option value="domicilio">Domicilio</option>
                  <option value="paqueteria">Paquetería</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5 relative">
                <label className={`text-xs font-medium ${D ? "text-slate-500" : "text-slate-600"}`}>Instagram *</label>
                <div className="relative">
                  <input
                    value={manualForm.instagram}
                    onFocus={() => setShowClientDropdown(true)}
                    onChange={(e) => {
                      const val = e.target.value;
                      setManualForm({ ...manualForm, instagram: val });
                      setClientSearchQuery(val.replace('@', ''));
                      setShowClientDropdown(true);
                    }}
                    className={inputCls}
                    placeholder="@usuario"
                  />
                  {showClientDropdown && clientSearchQuery.length > 0 && (
                    <div className="absolute z-50 mt-1 w-full max-h-40 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-xl">
                      {clients.filter(c => c.instagram && c.instagram.toLowerCase().includes(clientSearchQuery.toLowerCase())).map(c => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={async () => {
                            setManualForm({
                              ...manualForm,
                              instagram: c.instagram,
                              fullName: c.name,
                              phone: c.phone || ""
                            });
                            setShowClientDropdown(false);
                            setClientSearchQuery('@' + c.instagram.replace(/^@/, ''));
                            setPendingItems([]);
                            setSelectedPendingIds([]);

                            // 🆕 Cargar lista para checkboxes
                            try {
                              const resP = await fetch(`/api/clients/pending-products?instagram=${encodeURIComponent(c.instagram)}`);
                              if (resP.ok) {
                                const dataP = await resP.json();
                                if (dataP.pendingItems) {
                                  setPendingItems(dataP.pendingItems);
                                }
                              }
                            } catch (e) {
                              console.error("Error fetching pending items:", e);
                            }
                          }}
                          className="w-full text-left px-4 py-3 hover:bg-slate-50 border-b border-slate-100 last:border-0 text-sm transition-colors flex items-center justify-between"
                        >
                          <span className="font-bold text-emerald-500">{c.instagram}</span>
                          <span className="text-[10px] opacity-40">{c.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {pendingItems.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Seleccionar productos pendientes</label>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl max-h-32 overflow-y-auto p-2 flex flex-col gap-1">
                    {pendingItems.map((item, idx) => {
                      const isSelected = selectedPendingIds.includes(item.id);
                      return (
                        <label key={item.id} className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-emerald-500/10 border border-emerald-500/20' : 'hover:bg-white border border-transparent'}`}>
                          <div className="flex items-center gap-2">
                            <input 
                              type="checkbox"
                              className="w-4 h-4 rounded text-emerald-500 focus:ring-emerald-500 border-slate-300"
                              checked={isSelected}
                              onChange={(e) => {
                                let newSelected = [...selectedPendingIds];
                                if (e.target.checked) {
                                  newSelected.push(item.id);
                                } else {
                                  newSelected = newSelected.filter(id => id !== item.id);
                                }
                                setSelectedPendingIds(newSelected);
                                
                                // Actualizar el textarea de productos automáticamente
                                const selectedItems = pendingItems.filter(i => newSelected.includes(i.id));
                                const text = selectedItems
                                  .map(i => `${i.quantity}x ${i.name}`)
                                  .join("\n");
                                
                                // Calcular monto a cobrar
                                // 1. Adeudos de ventas (solo una vez por venta)
                                const uniqueSales = [...new Set(selectedItems.map(i => i.saleId))];
                                let totalDebt = 0;
                                uniqueSales.forEach(sid => {
                                  const saleItem = pendingItems.find(i => i.saleId === sid);
                                  totalDebt += (saleItem?.remainingDebt || 0);
                                });

                                // 2. Envío si es domicilio
                                const shipping = manualType === 'domicilio' ? 45 : 0;
                                
                                setManualForm(prev => ({ 
                                  ...prev, 
                                  products: text,
                                  amountDue: totalDebt + shipping
                                }));
                              }}
                            />
                            <div>
                              <span className="text-xs font-bold text-slate-700 block leading-tight">{item.name}</span>
                              {item.remainingDebt > 0 && (
                                <span className="text-[9px] font-bold text-amber-600 tracking-tight">Debe: ${item.remainingDebt}</span>
                              )}
                              {item.remainingDebt === 0 && (
                                <span className="text-[9px] font-bold text-emerald-500 tracking-tight">Liquidado</span>
                              )}
                            </div>
                          </div>
                          <span className="text-[10px] font-black text-slate-400">{item.quantity}x</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className={`text-xs font-medium ${D ? "text-slate-500" : "text-slate-600"}`}>Productos (Selecciona arriba o escribe aquí)</label>
                <textarea 
                  value={manualForm.products || ""}
                  onChange={(e) => setManualForm({ ...manualForm, products: e.target.value })}
                  className={`${inputCls} min-h-[80px] resize-none`}
                  placeholder="Lista de productos..."
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className={`text-xs font-medium ${D ? "text-slate-500" : "text-slate-600"}`}>Estado de entrega</label>
                <select 
                  value={manualForm.delivery_status || "pendiente"}
                  onChange={(e) => setManualForm({ ...manualForm, delivery_status: e.target.value })}
                  className={inputCls}
                >
                  <option value="pendiente">Pendiente</option>
                  <option value="entregado">Entregado</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className={`text-xs font-medium ${D ? "text-slate-500" : "text-slate-600"}`}>Monto a cobrar (MXN)</label>
                <input 
                  type="number"
                  value={manualForm.amountDue || ""}
                  onChange={(e) => setManualForm({ ...manualForm, amountDue: e.target.value })}
                  className={inputCls}
                  placeholder="0"
                />
              </div>

              {[
                { key: "fullName", label: "Nombre completo *", placeholder: "Nombre y apellidos" },
                { key: "phone", label: "Teléfono *", placeholder: "871..." },
              ].map(({ key, label, placeholder }) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <label className={`text-xs font-medium ${D ? "text-slate-500" : "text-slate-600"}`}>{label}</label>
                  <input
                    value={manualForm[key]}
                    onChange={(e) => setManualForm({ ...manualForm, [key]: e.target.value })}
                    className={inputCls}
                    placeholder={placeholder}
                  />
                </div>
              ))}
              {(manualType === "domicilio" || manualType === "paqueteria") && (
                <div className="flex flex-col gap-1.5">
                  <label className={`text-xs font-medium ${D ? "text-slate-500" : "text-slate-600"}`}>Dirección</label>
                  <textarea value={manualForm.address}
                    onChange={(e) => setManualForm({ ...manualForm, address: e.target.value })}
                    className={`${inputCls} min-h-[70px] resize-none`}
                    placeholder="Calle, número, colonia..." />
                </div>
              )}
              {manualType === "paqueteria" && (
                <div className="flex flex-col gap-1.5">
                  <label className={`text-xs font-medium ${D ? "text-slate-500" : "text-slate-600"}`}>Ciudad / Estado</label>
                  <input value={manualForm.city}
                    onChange={(e) => setManualForm({ ...manualForm, city: e.target.value })}
                    className={inputCls} placeholder="CDMX, Monterrey, Durango..." />
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                <label className={`text-xs font-medium ${D ? "text-slate-500" : "text-slate-600"}`}>Fecha *</label>
                <input type="date" value={manualForm.date}
                  onChange={(e) => setManualForm({ ...manualForm, date: e.target.value })}
                  className={inputCls} />
              </div>

              <button type="submit"
                className="bg-emerald-500 hover:bg-emerald-400 text-slate-900 py-2.5 rounded-xl text-sm font-semibold transition-all hover:shadow-[0_0_16px_rgba(16,185,129,0.35)]">
                Guardar entrega
              </button>
              {manualMsg && <p className="text-emerald-400 text-sm text-center">{manualMsg}</p>}
              {manualError && <p className="text-red-400 text-sm text-center">{manualError}</p>}
            </form>
          </div>
        </div>
      )}

      {showHistoryModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className={`rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto relative border ${
            D ? "bg-white border-slate-200" : "bg-white border-slate-200"
          }`}>
            <div className={`sticky top-0 px-6 py-4 border-b flex items-center justify-between ${D ? "bg-white border-white/[0.07]" : "bg-white border-slate-100"}`}>
              <div>
                <h2 className={`text-base font-bold ${D ? "text-slate-900" : "text-slate-900"}`}>
                  Historial de {historyInstagram}
                </h2>
                <p className={`text-xs ${D ? "text-slate-500" : "text-slate-500"}`}>
                  {historyBookings.length} entrega(s) registradas
                </p>
              </div>
              <button onClick={() => setShowHistoryModal(false)}
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${D ? "bg-slate-50 hover:bg-slate-100 text-slate-500" : "bg-slate-100 hover:bg-slate-200 text-slate-500"}`}>
                ✖
              </button>
            </div>

            <div className="p-6">
              {historyBookings.length === 0 ? (
                <p className={`text-sm ${D ? "text-slate-500" : "text-slate-500"}`}>No hay entregas para este cliente.</p>
              ) : (
                <ul className="space-y-3">
                  {historyBookings.map((h) => (
                    <li key={h.id} className={`rounded-xl p-3 border ${D ? "bg-slate-50 border-white/[0.07]" : "bg-slate-50 border-slate-100"}`}>
                      <p className={`text-[11px] mb-1 ${D ? "text-slate-600" : "text-slate-500"}`}>
                        {h.createdAt ? new Date(h.createdAt).toLocaleString("es-MX") : ""}
                      </p>
                      <p className={`text-sm font-semibold ${D ? "text-slate-800" : "text-slate-800"}`}>
                        {h.type === "bodega" ? "Entrega en bodega" : h.type === "domicilio" ? "Entrega a domicilio" : "Paquetería"}
                        <span className={`font-normal ml-2 ${D ? "text-slate-500" : "text-slate-500"}`}>
                          · {h.date ? formatShortMX(h.date) : "sin fecha"}
                        </span>
                      </p>
                      {h.address && <p className={`text-xs mt-1 ${D ? "text-slate-500" : "text-slate-600"}`}>📍 {h.address}</p>}
                      {(h.city || h.state || h.postal_code) && (
                        <p className={`text-[11px] mt-0.5 ${D ? "text-slate-600" : "text-slate-500"}`}>
                          {[h.city, h.state, h.postal_code ? `CP ${h.postal_code}` : ""].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      {h.notes && <p className={`text-[11px] mt-0.5 ${D ? "text-slate-600" : "text-slate-500"}`}>📝 {h.notes}</p>}
                      {h.location_url && (h.location_url.startsWith("http://") || h.location_url.startsWith("https://")) && (
                        <button type="button" onClick={() => window.open(h.location_url, "_blank")}
                          className="mt-1.5 text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 underline transition-colors">
                          📍 Ver en Google Maps
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmDeleteBooking.show && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[100] px-4">
          <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-sm p-8 text-center border border-slate-200 animate-in zoom-in duration-200">
            <div className="w-20 h-20 bg-rose-50 rounded-3xl flex items-center justify-center mx-auto mb-6 border-2 border-rose-100 text-3xl">🗑️</div>
            <h3 className="text-xl font-black text-slate-900 mb-2">¿Eliminar entrega?</h3>
            <p className="text-sm text-slate-500 mb-8 leading-relaxed">Esta acción no se puede deshacer y el producto volverá a estar pendiente de entrega.</p>
            <div className="grid grid-cols-2 gap-3">
              <button 
                onClick={() => setConfirmDeleteBooking({ show: false, id: null })}
                className="py-3.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold transition-all text-sm"
              >
                Cancelar
              </button>
              <button 
                onClick={() => handleDelete(confirmDeleteBooking.id)}
                className="py-3.5 rounded-2xl bg-rose-500 hover:bg-rose-600 text-white font-bold transition-all shadow-lg shadow-rose-500/25 text-sm"
              >
                Sí, eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {showRescheduleModal && bookingToReschedule && (
        <RescheduleModal
          booking={bookingToReschedule}
          dark={D}
          onClose={() => { setShowRescheduleModal(false); setBookingToReschedule(null); }}
          onSaved={async () => { await fetchBookings(); setShowRescheduleModal(false); setBookingToReschedule(null); }}
        />
      )}

      {showCashboxModal && (
        <CashboxCutModal
          initialCash={CASHBOX_INITIAL}
          deliveriesAmount={deliveriesAmount}
          expectedCash={expectedCash}
          lastCut={cashboxLastCut}
          dark={D}
          onClose={() => setShowCashboxModal(false)}
          onConfirm={handleCreateCashboxCut}
        />
      )}

      {showCashboxHistoryModal && (
        <CashboxHistoryModal
          cuts={cashboxHistory}
          loading={cashboxHistoryLoading}
          dark={D}
          onClose={() => setShowCashboxHistoryModal(false)}
          onRefresh={fetchCashboxHistory}
        />
      )}
      {confirmDeleteBooking.show && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-[70] p-4">
          <div className="bg-white border border-slate-200 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="p-6 text-center">
              <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">🗑️</span>
              </div>
              <h3 className="text-lg font-bold text-slate-900 mb-2">¿Eliminar entrega?</h3>
              <p className="text-sm text-slate-500">Esta acción no se puede deshacer. Se liberará el cupo en la agenda.</p>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-3">
              <button onClick={() => setConfirmDeleteBooking({ show: false, id: null })} className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 font-medium hover:bg-slate-50 transition-colors">Cancelar</button>
              <button onClick={() => handleDelete(confirmDeleteBooking.id)} 
                className="flex-1 px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold shadow-lg shadow-red-500/20 transition-all">
                Sí, eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TrendChart({ bookings, activeTab, todayStr, dark: D }) {
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const str = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, "0"),
      String(d.getDate()).padStart(2, "0"),
    ].join("-");
    const count = bookings.filter((bk) => bk.date === str && bk.type === activeTab).length;
    days.push({ str, dayNum: d.getDate(), count });
  }

  const total = days.reduce((s, d) => s + d.count, 0);
  const max = Math.max(...days.map((d) => d.count), 1);
  const BAR_H = 72;

  const typeLabel =
    activeTab === "domicilio" ? "Domicilio" :
    activeTab === "bodega" ? "Bodega" : "Paquetería";

  const firstDate = days[0]
    ? new Date(days[0].str + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" })
    : "";

  return (
    <div className={`rounded-2xl border p-5 mb-5 ${D ? "bg-slate-50 border-slate-200" : "bg-white border-slate-200 shadow-sm"}`}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className={`text-sm font-semibold ${D ? "text-slate-800" : "text-slate-700"}`}>
            Tendencia · {typeLabel}
          </h3>
          <p className={`text-xs mt-0.5 ${D ? "text-slate-500" : "text-slate-500"}`}>Últimos 14 días</p>
        </div>
        <div className="text-right">
          <span className={`text-2xl font-bold tabular-nums ${D ? "text-slate-900" : "text-slate-900"}`}>{total}</span>
          <span className={`text-xs ml-1.5 ${D ? "text-slate-500" : "text-slate-500"}`}>entregas</span>
        </div>
      </div>

      <div className="flex items-end gap-[3px]">
        {days.map(({ str, dayNum, count }) => {
          const isToday = str === todayStr;
          const barH = count === 0 ? 3 : Math.max(8, Math.round((count / max) * BAR_H));
          return (
            <div key={str} className="flex-1 flex flex-col items-center gap-1.5 group cursor-default">
              <div className="w-full flex items-end justify-center" style={{ height: `${BAR_H}px` }}>
                <div
                  style={{ height: `${barH}px` }}
                  title={`${count} entrega${count !== 1 ? "s" : ""}`}
                  className={`w-full rounded-sm transition-all duration-200 ${
                    isToday
                      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.45)]"
                      : count === 0
                      ? D ? "bg-slate-100" : "bg-slate-100"
                      : D
                      ? "bg-emerald-500/35 group-hover:bg-emerald-500/60"
                      : "bg-emerald-300/70 group-hover:bg-emerald-400/90"
                  }`}
                />
              </div>
              <span className={`text-[9px] leading-none tabular-nums ${
                isToday ? "text-emerald-400 font-bold" : D ? "text-slate-600" : "text-slate-500"
              }`}>
                {dayNum}
              </span>
            </div>
          );
        })}
      </div>

      <div className={`flex justify-between mt-2 text-[10px] ${D ? "text-slate-600" : "text-slate-500"}`}>
        <span>{firstDate}</span>
        <span className={D ? "text-emerald-500/70" : "text-emerald-600/60"}>Hoy</span>
      </div>
    </div>
  );
}

function TabBtn({ label, icon, id, active, onClick, dark: D }) {
  const isActive = active === id;
  return (
    <button
      onClick={() => onClick(id)}
      className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 ${
        isActive
          ? D
            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-[0_0_20px_rgba(16,185,129,0.08)]"
            : "bg-white text-emerald-600 border border-emerald-200 shadow-sm"
          : D
          ? "text-slate-500 hover:text-slate-800 border border-transparent"
          : "text-slate-500 hover:text-slate-700 border border-transparent"
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function StatCard({ label, value, sub, color, icon, dark: D }) {
  const colors = {
    emerald: {
      bg: D ? "bg-emerald-500/5 border-emerald-500/20" : "bg-emerald-50 border-emerald-200",
      label: D ? "text-emerald-400" : "text-emerald-600",
      icon: D ? "bg-emerald-500/15 border-emerald-500/20" : "bg-emerald-100 border-emerald-200",
    },
    amber: {
      bg: D ? "bg-amber-500/5 border-amber-500/20" : "bg-amber-50 border-amber-200",
      label: D ? "text-amber-400" : "text-amber-600",
      icon: D ? "bg-amber-500/15 border-amber-500/20" : "bg-amber-100 border-amber-200",
    },
    red: {
      bg: D ? "bg-red-500/5 border-red-500/20" : "bg-red-50 border-red-200",
      label: D ? "text-red-400" : "text-red-600",
      icon: D ? "bg-red-500/15 border-red-500/20" : "bg-red-100 border-red-200",
    },
  };
  const c = colors[color];

  return (
    <div className={`rounded-2xl p-5 border ${c.bg}`}>
      <div className="flex items-center justify-between mb-3">
        <span className={`text-xs font-semibold uppercase tracking-widest ${c.label}`}>{label}</span>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center border text-sm ${c.icon}`}>
          {icon}
        </div>
      </div>
      <p className={`text-4xl font-bold tracking-tight ${D ? "text-slate-900" : "text-slate-900"}`}>{value}</p>
      <p className={`text-xs mt-1.5 ${D ? "text-slate-600" : "text-slate-500"}`}>{sub}</p>
    </div>
  );
}

function FilterChip({ label, onRemove, dark: D }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border ${
      D ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-emerald-50 text-emerald-700 border-emerald-200"
    }`}>
      {label}
      <button onClick={onRemove} className="opacity-60 hover:opacity-100 transition-opacity leading-none">✕</button>
    </span>
  );
}

function RescheduleModal({ booking, dark: D, onClose, onSaved }) {
  const [newDate, setNewDate] = useState(booking.date || "");
  const [saving, setSaving] = useState(false);
  const today = getTodayInputDate();

  const inputCls = `rounded-xl px-3 py-2.5 text-sm border w-full focus:outline-none transition-all ${
    D
      ? "bg-white/[0.05] border-slate-200 text-slate-900 focus:border-emerald-500/50"
      : "bg-slate-50 border-slate-200 text-slate-900 focus:border-emerald-400"
  }`;

  const handleSave = async () => {
    if (!newDate) { alert("Selecciona una fecha"); return; }
    try {
      setSaving(true);
      const token = localStorage.getItem("panelToken") || "";
      const res = await fetch("/api/bookings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-panel-token": token },
        body: JSON.stringify({ action: "reschedule", id: booking.id, date: newDate }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.message || "No se pudo reagendar"); return; }
      onSaved?.();
    } catch (err) {
      alert("Error de conexión");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className={`rounded-2xl shadow-2xl w-full max-w-md p-6 relative border ${
        D ? "bg-white border-slate-200" : "bg-white border-slate-200"
      }`}>
        <button onClick={onClose}
          className={`absolute top-4 right-4 w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${D ? "bg-slate-50 hover:bg-slate-100 text-slate-500" : "bg-slate-100 hover:bg-slate-200 text-slate-500"}`}>
          ✖
        </button>
        <h2 className={`text-lg font-bold mb-1 ${D ? "text-slate-900" : "text-slate-900"}`}>Reagendar entrega</h2>
        <p className={`text-xs mb-5 ${D ? "text-slate-500" : "text-slate-500"}`}>
          {booking.fullName || booking.instagram} · Actual: {booking.date ? formatShortMX(booking.date) : "sin fecha"}
        </p>

        <label className={`text-xs font-medium mb-1.5 block ${D ? "text-slate-500" : "text-slate-600"}`}>Nueva fecha</label>
        <input type="date" value={newDate} min={today} onChange={(e) => setNewDate(e.target.value)}
          className={`${inputCls} mb-5`} />

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className={`px-4 py-2 rounded-xl border text-sm transition-colors ${D ? "border-slate-200 text-slate-500 hover:bg-slate-50" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-900 text-sm font-semibold transition-all disabled:opacity-50">
            {saving ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CashboxCutModal({ initialCash, deliveriesAmount, expectedCash, lastCut, dark: D, onClose, onConfirm }) {
  const [countedCash, setCountedCash] = useState(expectedCash);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const inputCls = `rounded-xl px-3 py-2.5 text-sm border w-full focus:outline-none transition-all ${
    D
      ? "bg-white/[0.05] border-slate-200 text-slate-900 focus:border-emerald-500/50"
      : "bg-slate-50 border-slate-200 text-slate-900 focus:border-emerald-400"
  }`;

  const handleSave = async () => {
    if (countedCash === null || countedCash === undefined || countedCash === "") {
      alert("Captura cuánto dinero hay en la caja."); return;
    }
    const numericCounted = Number(countedCash);
    if (isNaN(numericCounted)) { alert("El monto contado debe ser un número válido."); return; }
    try {
      setSaving(true);
      await onConfirm({ countedCash: numericCounted, note });
    } finally {
      setSaving(false);
    }
  };

  const diff = Number(countedCash || 0) - Number(expectedCash || 0);

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div className={`rounded-2xl shadow-2xl w-full max-w-md p-6 relative border ${
        D ? "bg-white border-slate-200" : "bg-white border-slate-200"
      }`}>
        <button onClick={onClose}
          className={`absolute top-4 right-4 w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${D ? "bg-slate-50 hover:bg-slate-100 text-slate-500" : "bg-slate-100 hover:bg-slate-200 text-slate-500"}`}>
          ✖
        </button>
        <h2 className={`text-lg font-bold mb-1 ${D ? "text-slate-900" : "text-slate-900"}`}>Corte de caja Noreste</h2>
        {lastCut && lastCut.created_at && (
          <p className={`text-xs mb-4 ${D ? "text-slate-500" : "text-slate-500"}`}>
            Último corte: {new Date(lastCut.created_at).toLocaleString("es-MX")}
          </p>
        )}

        <div className={`rounded-xl p-3 mb-4 border text-xs space-y-1.5 ${D ? "bg-slate-50 border-white/[0.07] text-slate-500" : "bg-slate-50 border-slate-100 text-slate-600"}`}>
          <div className="flex justify-between"><span>Dinero inicial</span><span className="font-semibold">${initialCash}</span></div>
          <div className="flex justify-between"><span>Entregado en efectivo</span><span className="font-semibold">${deliveriesAmount}</span></div>
          <div className={`flex justify-between pt-1.5 border-t font-semibold ${D ? "border-slate-200 text-slate-800" : "border-slate-200 text-slate-800"}`}>
            <span>Total esperado</span><span>${expectedCash}</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5 mb-3">
          <label className={`text-xs font-medium ${D ? "text-slate-500" : "text-slate-600"}`}>Dinero contado en caja</label>
          <input type="number" className={inputCls} value={countedCash} onChange={(e) => setCountedCash(e.target.value)} />
          <p className={`text-xs ${D ? "text-slate-500" : "text-slate-500"}`}>
            Diferencia:{" "}
            <span className={diff === 0 ? D ? "text-slate-500" : "text-slate-600" : diff > 0 ? "text-emerald-400" : "text-red-400"}>
              {diff >= 0 ? "+" : ""}{diff}
            </span>
          </p>
        </div>

        <div className="flex flex-col gap-1.5 mb-5">
          <label className={`text-xs font-medium ${D ? "text-slate-500" : "text-slate-600"}`}>Nota (opcional)</label>
          <textarea className={`${inputCls} min-h-[70px] resize-none`}
            placeholder="Ej: Faltaron $40, cliente X dijo que pagará mañana..."
            value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={saving}
            className={`px-4 py-2 rounded-xl border text-sm transition-colors ${D ? "border-slate-200 text-slate-500 hover:bg-slate-50" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-900 text-sm font-semibold transition-all disabled:opacity-50">
            {saving ? "Guardando…" : "Guardar corte"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CashboxHistoryModal({ cuts, loading, dark: D, onClose, onRefresh }) {
  const [expandedId, setExpandedId] = useState(null);

  const sortedCuts = [...(cuts || [])].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm">
      <div className="flex-1" onClick={onClose} aria-hidden="true" />

      <div className={`w-full max-w-md h-full shadow-2xl flex flex-col border-l ${
        D ? "bg-white border-slate-200" : "bg-white border-slate-200"
      }`}>
        <div className={`flex items-center justify-between px-5 py-4 border-b ${D ? "border-white/[0.07]" : "border-slate-100"}`}>
          <div>
            <h2 className={`text-base font-bold ${D ? "text-slate-900" : "text-slate-900"}`}>Historial de cortes</h2>
            <p className={`text-xs ${D ? "text-slate-500" : "text-slate-500"}`}>{cuts?.length || 0} corte(s)</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onRefresh}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${D ? "border-slate-200 text-slate-500 hover:bg-slate-50" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
              Actualizar
            </button>
            <button onClick={onClose}
              className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors ${D ? "bg-slate-50 hover:bg-slate-100 text-slate-500" : "bg-slate-100 hover:bg-slate-200 text-slate-500"}`}>
              ✖
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className={`text-xs ${D ? "text-slate-500" : "text-slate-500"}`}>Cargando historial…</p>
          ) : sortedCuts.length === 0 ? (
            <p className={`text-sm ${D ? "text-slate-500" : "text-slate-500"}`}>Aún no hay cortes registrados.</p>
          ) : (
            <ul className="space-y-2">
              {sortedCuts.map((cut) => {
                const diff = cut.difference ?? 0;
                const diffCls = diff > 0 ? "text-emerald-400" : diff < 0 ? "text-red-400" : D ? "text-slate-500" : "text-slate-600";
                const isOpen = expandedId === cut.id;

                return (
                  <li key={cut.id} className={`rounded-xl border overflow-hidden ${D ? "border-white/[0.07] bg-slate-50" : "border-slate-100 bg-slate-50"}`}>
                    <button
                      type="button"
                      onClick={() => setExpandedId((c) => (c === cut.id ? null : cut.id))}
                      className="w-full flex items-center justify-between px-4 py-3 text-xs"
                    >
                      <div className="text-left">
                        <p className={`font-semibold ${D ? "text-slate-800" : "text-slate-800"}`}>
                          {cut.created_at ? new Date(cut.created_at).toLocaleString("es-MX") : "Sin fecha"}
                        </p>
                        <p className={D ? "text-slate-500" : "text-slate-500"}>Ruta: {cut.route || "noreste"}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`font-semibold ${diffCls}`}>
                          Dif: {diff >= 0 ? "+" : ""}{diff}
                        </span>
                        <span className={D ? "text-slate-600" : "text-slate-500"}>{isOpen ? "▲" : "▼"}</span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className={`px-4 pb-3 text-[11px] space-y-1 border-t ${D ? "border-white/[0.06] text-slate-500" : "border-slate-100 text-slate-600"}`}>
                        {cut.from_datetime && (
                          <p className={D ? "text-slate-500" : "text-slate-500"}>
                            Desde: {new Date(cut.from_datetime).toLocaleString("es-MX")}
                          </p>
                        )}
                        <p>Inicial: <strong>${cut.initial_cash ?? 0}</strong></p>
                        <p>Esperado: <strong>${cut.expected_cash ?? 0}</strong></p>
                        <p>Contado: <strong>${cut.counted_cash ?? 0}</strong></p>
                        <p>Diferencia: <strong className={diffCls}>{diff >= 0 ? "+" : ""}{diff}</strong></p>
                        {cut.note && <p className={D ? "text-slate-500" : "text-slate-500"}>Nota: {cut.note}</p>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
