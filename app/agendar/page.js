"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { es } from "date-fns/locale";
import { registerLocale } from "react-datepicker";

registerLocale("es", es);

// 🚩 VARIABLE DE CONTROL: Cambia a true para volver a mostrar la opción de Bodega
const BODEGA_ACTIVA = true;

// 🔹 genera los siguientes días válidos LUN-VIE (siempre a partir de MAÑANA)
function getNextPickupDates(count = 6) {
  const result = [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // empezamos a contar desde mañana
  let d = new Date(today);
  d.setDate(d.getDate() + 1);

  while (result.length < count) {
    const day = d.getDay(); // 0 dom, 1 lun, ... 6 sáb
    // lunes(1) a viernes(5)
    if (day >= 1 && day <= 5) {
      result.push(new Date(d));
    }
    d.setDate(d.getDate() + 1);
  }
  return result;
}

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toNiceDate(date) {
  return date.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

function formatDateStringMX(dateStr) {
  if (!dateStr) return "";
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("es-MX", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function capitalizeFirst(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// lista de estados de México (para paquetería)
const MEX_STATES = [
  "Aguascalientes",
  "Baja California",
  "Baja California Sur",
  "Campeche",
  "Chiapas",
  "Chihuahua",
  "Ciudad de México",
  "Coahuila",
  "Colima",
  "Durango",
  "Estado de México",
  "Guanajuato",
  "Guerrero",
  "Hidalgo",
  "Jalisco",
  "Michoacán",
  "Morelos",
  "Nayarit",
  "Nuevo León",
  "Oaxaca",
  "Puebla",
  "Querétaro",
  "Quintana Roo",
  "San Luis Potosí",
  "Sinaloa",
  "Sonora",
  "Tabasco",
  "Tamaulipas",
  "Tlaxcala",
  "Veracruz",
  "Yucatán",
  "Zacatecas",
];

// 👇 ciudades de la Comarca que quieres
const LAGUNA_CITIES = [
  { city: "Torreón", state: "Coahuila" },
  { city: "Gómez Palacio", state: "Durango" },
  { city: "Lerdo", state: "Durango" },
];

export default function AgendarPage() {
  const router = useRouter();

  // "bodega" | "domicilio" | "paqueteria"
  // 🟢 AJUSTE: Iniciamos en domicilio porque bodega está pausada
  const [mode, setMode] = useState("domicilio");
  const [slots, setSlots] = useState(null); // para bodega (si existe)
  const [bookingCounts, setBookingCounts] = useState({}); // { "YYYY-MM-DD": n } para contar domicilio
  const [blockedDays, setBlockedDays] = useState([]);
  const [extraBodegaDays, setExtraBodegaDays] = useState([]);
  const [specialDays, setSpecialDays] = useState([]);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  // campos cliente
  const [insta, setInsta] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [street, setStreet] = useState("");
  const [houseNum, setHouseNum] = useState("");
  const [colonia, setColonia] = useState("");
  const [references, setReferences] = useState("");
  const [address, setAddress] = useState(""); // Se usará para paquetería o como respaldo
  const [notes, setNotes] = useState("");
  const [city, setCity] = useState(""); // solo paquetería
  const [stateMx, setStateMx] = useState("Coahuila"); // paquetería

  // campos separados de dirección paquetería
  const [pkgStreet, setPkgStreet] = useState("");
  const [pkgNumExt, setPkgNumExt] = useState("");
  const [pkgNumInt, setPkgNumInt] = useState("");
  const [pkgColonia, setPkgColonia] = useState("");
  const [pkgRefs, setPkgRefs] = useState("");
  const [pkgCP, setPkgCP] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(null);

  // DOMICILIO
  const [domicilioCity, setDomicilioCity] = useState("");
  const [domicilioState, setDomicilioState] = useState("");
  const [domicilioCP, setDomicilioCP] = useState("");
  const [locationUrl, setLocationUrl] = useState(""); // URL de Maps

  // modal éxito
  const [successModal, setSuccessModal] = useState(false);
  const [successText, setSuccessText] = useState("");
  const [successBooking, setSuccessBooking] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Perfil Inteligente
  const [clientProfile, setClientProfile] = useState(null);
  const [clientSales, setClientSales] = useState([]);
  const [clientBookings, setClientBookings] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]); // items seleccionados
  const [calculatingDebt, setCalculatingDebt] = useState(0);

  // modal ayuda ubicación
  const [showLocationHelp, setShowLocationHelp] = useState(false);

  // límite domicilio
  const DOMICILIO_LIMIT = 15;

  // traer conteo de domicilios por fecha (público) y días bloqueados
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/public/booking-counts");
        if (res.ok) {
          const data = await res.json();
          setBookingCounts(data.counts || {});
        }
      } catch (err) {
        console.error(err);
      }

      try {
        const res2 = await fetch("/api/blocked-days", {
          cache: "no-store",
        });
        const data2 = await res2.json();
        setBlockedDays(data2.blockedDays || []);
        setExtraBodegaDays(data2.extraBodegaDays || []);
        setSpecialDays(data2.specialDays || []);
      } catch (err) {
        console.warn("No se pudieron leer los días públicos", err);
      }
    };
    fetchData();

    // Cargar perfil inteligente
    const fetchProfile = async () => {
      try {
        const res = await fetch("/api/clients/me/dashboard");
        if (res.ok) {
          const data = await res.json();
          if (data.client) {
            setClientProfile(data.client);
            setInsta(data.client.instagram || "");
            setFullName(data.client.name || "");
            setPhone(data.client.phone || "");
            setClientSales(data.sales || []);
            setClientBookings(data.bookings || []);
          }
        }
      } catch (err) {
        console.warn("No logged in", err);
      }
    };
    fetchProfile();
  }, []);

  const isBlocked = (dateStr, type) => {
    return blockedDays.some((bd) => bd.date === dateStr && bd.type === type);
  };

  const getBodegaCardDates = () => {
    const baseDates = getNextPickupDates(6);
    const now = new Date();
    const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowLocal = new Date(todayLocal);
    tomorrowLocal.setDate(tomorrowLocal.getDate() + 1);

    const map = new Map();
    baseDates.forEach((d) => {
      map.set(toInputDate(d), {
        date: d,
        isExtra: false,
      });
    });

    (extraBodegaDays || []).forEach((x) => {
      const d = new Date(x.date + "T00:00:00");
      if (d >= tomorrowLocal) {
        map.set(x.date, {
          date: d,
          isExtra: true,
          start_time: x.start_time,
          end_time: x.end_time,
        });
      }
    });

    return Array.from(map.values()).sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );
  };

  const bodegaCardDates = getBodegaCardDates();

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const minDate = new Date(today);
  minDate.setDate(minDate.getDate() + 1);
  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 30);

  const blockedForDomicilio = blockedDays
    .filter((b) => b.type === "domicilio")
    .map((b) => new Date(b.date + "T00:00:00"));

  const isWeekday = (date) => {
    const day = date.getDay();
    const dateStr = toInputDate(date);
    if (isBlocked(dateStr, "domicilio")) return false;
    // día especial: abre aunque sea sábado o domingo
    if (specialDays.some(s => s.date === dateStr)) return true;
    if (day === 0 || day === 6) return false;
    return true;
  };

  let domicilioCountForSelected = 0;
  if (deliveryDate) {
    const selectedStr = toInputDate(deliveryDate);
    domicilioCountForSelected = bookingCounts[selectedStr] || 0;
  }
  const domicilioRemaining =
    deliveryDate != null
      ? Math.max(DOMICILIO_LIMIT - domicilioCountForSelected, 0)
      : DOMICILIO_LIMIT;

  // Penalización por intento fallido: solo si el último no_entregado no fue seguido de un entregado
  const lastFailed = clientBookings
    .filter(bk => bk.delivery_status === "no_entregado")
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
  const hasPendingFailedAttempt = !!lastFailed && !clientBookings.some(
    bk => bk.delivery_status === "entregado" && new Date(bk.date) > new Date(lastFailed.date)
  );

  // Calcular deuda de productos seleccionados
  useEffect(() => {
    let debt = 0;
    const debtBySale = new Map();
    selectedItems.forEach(item => {
      const sale = clientSales.find(s => s.id === item.sale_id);
      if (sale && (sale.status === 'credit' || sale.status === 'catalog_pending' || sale.status === 'catalog_viewed')) {
        // Calculamos cuánto se ha pagado en total (enganche + abonos)
        const totalPaid = Number(sale.down_payment || 0) + (sale.payments ? sale.payments.reduce((acc, p) => acc + p.amount, 0) : 0);
        const saleDebt = Math.max(0, Number(sale.total) - totalPaid);
        
        // Si la venta tiene deuda, mostramos la deuda total de la venta para que el cliente sepa qué falta liquidar
        // Para evitar confusiones, sumaremos la deuda de la venta a la que pertenece el item
        // Pero solo una vez por venta para no duplicar si hay varios items de la misma venta
        if (!debtBySale.has(sale.id)) {
          debtBySale.set(sale.id, saleDebt);
          debt += saleDebt;
        }
      }
    });
    setCalculatingDebt(debt);
  }, [selectedItems, clientSales]);

  const handleBodegaBooking = async (day, date, extraInfo = {}) => {
    if (!BODEGA_ACTIVA) return; // Protección extra
    if (isSubmitting) return;
    setMsg("");
    setError("");

    if (!insta || !fullName || !phone) {
      setError("Llena Instagram, nombre y teléfono.");
      return;
    }
    if (!date) {
      setError("Selecciona una fecha.");
      return;
    }

    const dateStr = toInputDate(date);
    if (isBlocked(dateStr, "bodega")) {
      setError("Ese día no estamos entregando en bodega. Elige otro.");
      return;
    }

    const nowLocal = new Date();
    const todayLocal = new Date(
      nowLocal.getFullYear(),
      nowLocal.getMonth(),
      nowLocal.getDate()
    );
    const selectedDateOnly = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate()
    );

    if (selectedDateOnly <= todayLocal) {
      setError("Solo puedes agendar a partir del día siguiente.");
      return;
    }

    let instaValue = insta.trim();
    if (!instaValue.startsWith("@")) instaValue = "@" + instaValue;

    try {
      setIsSubmitting(true);
      const isExtraDay = !!extraInfo?.isExtra;
      const dayToSend = isExtraDay ? null : (day || null);

      let productsString = "";
      if (selectedItems.length > 0) {
        productsString = selectedItems.map(i => `${i.quantity}x ${i.product_name}`).join(", ");
      }

      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "bodega",
          day: dayToSend,
          isExtra: isExtraDay,
          date: toInputDate(date),
          instagram: instaValue,
          fullName,
          phone,
          products: productsString || null,
          amountDue: calculatingDebt
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "No se pudo agendar.");
      } else {
        setSuccessText("✅ Tu entrega en bodega quedó registrada.");
        const horario =
          isExtraDay && extraInfo?.start_time && extraInfo?.end_time
            ? `${extraInfo.start_time} – ${extraInfo.end_time}`
            : "1:00 pm – 5:00 pm";

        setSuccessBooking({
          type: "bodega",
          instagram: instaValue,
          date: toInputDate(date),
          fullName,
          phone,
          isExtra: isExtraDay,
          start_time: isExtraDay ? extraInfo?.start_time : null,
          end_time: isExtraDay ? extraInfo?.end_time : null,
          horario,
        });

        setSuccessModal(true);
      }
    } catch (err) {
      setError("Error de conexión.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDomicilioBooking = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setMsg("");
    setError("");

    if (
      !insta ||
      !fullName ||
      !phone ||
      !street ||
      !houseNum ||
      !colonia ||
      !references ||
      !domicilioCity ||
      !domicilioState ||
      !domicilioCP
    ) {
      setError("Llena todos los campos (incluye calle, número, colonia y referencias).");
      return;
    }
    if (domicilioCP.length !== 5) {
      setError("El código postal debe tener 5 dígitos.");
      return;
    }
    if (!deliveryDate) {
      setError("Selecciona la fecha de entrega.");
      return;
    }

    const selectedStr = toInputDate(deliveryDate);

    if (isBlocked(selectedStr, "domicilio")) {
      setError("Ese día no estamos entregando a domicilio. Elige otro.");
      return;
    }

    const nowLocal = new Date();
    const todayLocal = new Date(
      nowLocal.getFullYear(),
      nowLocal.getMonth(),
      nowLocal.getDate()
    );
    const selectedDateOnly = new Date(
      deliveryDate.getFullYear(),
      deliveryDate.getMonth(),
      deliveryDate.getDate()
    );

    if (selectedDateOnly <= todayLocal) {
      setError("Solo puedes agendar a partir del día siguiente.");
      return;
    }

    const alreadyForDay = bookingCounts[selectedStr] || 0;
    if (alreadyForDay >= DOMICILIO_LIMIT) {
      setError("Ya no hay entregas disponibles para ese día.");
      return;
    }

    let instaValue = insta.trim();
    if (!instaValue.startsWith("@")) instaValue = "@" + instaValue;

    try {
      setIsSubmitting(true);
      
      let productsString = "";
      if (selectedItems.length > 0) {
        productsString = selectedItems.map(i => `${i.quantity}x ${i.product_name}`).join(", ");
      }

      const deliveryFee = hasPendingFailedAttempt ? 90 : 45;

      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "domicilio",
          instagram: instaValue,
          fullName,
          phone,
          address: `Calle: ${street}, Num: ${houseNum}, Col: ${colonia}, Ref: ${references}`,
          notes,
          date: selectedStr,
          city: domicilioCity,
          state: domicilioState,
          postalCode: domicilioCP,
          locationUrl,
          products: productsString || null,
          amountDue: calculatingDebt + deliveryFee
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "No se pudo agendar.");
      } else {
        const nice =
          deliveryDate.toLocaleDateString("es-MX", {
            weekday: "long",
            day: "numeric",
            month: "long",
          }) || "";
        setSuccessText(`✅ Entrega registrada para ${nice}.`);
        setSuccessBooking({
          type: "domicilio",
          instagram: instaValue,
          date: selectedStr,
          fullName,
          phone,
          address: `Calle: ${street}, Num: ${houseNum}, Col: ${colonia}, Ref: ${references}`,
          notes,
          city: domicilioCity,
          state: domicilioState,
          postalCode: domicilioCP,
          price: 45,
          locationUrl,
        });
        setSuccessModal(true);

        setInsta("");
        setFullName("");
        setPhone("");
        setStreet("");
        setHouseNum("");
        setColonia("");
        setReferences("");
        setAddress("");
        setNotes("");
        setDeliveryDate(null);
        setDomicilioCity("");
        setDomicilioState("");
        setDomicilioCP("");
        setLocationUrl("");
        setSelectedItems([]);

        setBookingCounts((prev) => ({
          ...prev,
          [selectedStr]: (prev[selectedStr] || 0) + 1,
        }));
      }
    } catch (err) {
      setError("Error de conexión.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePaqueteriaBooking = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setMsg("");
    setError("");

    if (!insta || !fullName || !phone || !pkgStreet || !pkgNumExt || !pkgColonia || !pkgRefs || !pkgCP || !city || !stateMx) {
      setError("Llena todos los campos obligatorios de paquetería.");
      return;
    }
    if (pkgCP.trim().length !== 5) {
      setError("El código postal debe tener exactamente 5 dígitos.");
      return;
    }

    let instaValue = insta.trim();
    if (!instaValue.startsWith("@")) instaValue = "@" + instaValue;

    const composedAddress = [
      `${pkgStreet} ${pkgNumExt}${pkgNumInt ? ` Int. ${pkgNumInt}` : ""}`,
      `Col. ${pkgColonia}`,
      `CP ${pkgCP}`,
      `Ref: ${pkgRefs}`,
    ].join(", ");

    const todayStr = new Date().toISOString().split("T")[0];

    try {
      setIsSubmitting(true);
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "paqueteria",
          instagram: instaValue,
          fullName,
          phone,
          address: composedAddress,
          city,
          state: stateMx,
          date: todayStr,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "No se pudo enviar la solicitud.");
      } else {
        setSuccessText(
          "✅ Recibimos tu solicitud de paquetería. Te escribiremos para enviar tu cotización."
        );
        setSuccessBooking({
          type: "paqueteria",
          instagram: instaValue,
          date: todayStr,
          fullName,
          phone,
          address: composedAddress,
          city,
          state: stateMx,
        });
        setSuccessModal(true);

        setInsta("");
        setFullName("");
        setPhone("");
        setPkgStreet("");
        setPkgNumExt("");
        setPkgNumInt("");
        setPkgColonia("");
        setPkgRefs("");
        setPkgCP("");
        setCity("");
        setStateMx("Coahuila");

      }
    } catch (err) {
      setError("Error de conexión.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePhoneChange = (e) => {
    const onlyNums = e.target.value.replace(/[^0-9]/g, "").slice(0, 10);
    setPhone(onlyNums);
  };

  const handleCPChange = (e) => {
    const onlyNums = e.target.value.replace(/[^0-9]/g, "").slice(0, 5);
    setDomicilioCP(onlyNums);
  };

  const handleDomicilioCityChange = (e) => {
    const value = e.target.value;
    setDomicilioCity(value);
    const found = LAGUNA_CITIES.find((c) => c.city === value);
    if (found) {
      setDomicilioState(found.state);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-20" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <div className="w-full max-w-3xl mx-auto px-4 pt-6 pb-2">
        {/* botón inicio */}
        <div className="mb-4">
          <a
            href="/"
            className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-slate-800 font-bold transition-colors"
          >
            <span>←</span> Volver a Inicio
          </a>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-8 gap-4">
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tight">Agenda tu entrega</h1>
            <p className="text-sm text-slate-500 font-medium mt-1">
              Productos originales y al mejor precio 🇺🇸
            </p>
          </div>
          {!clientProfile && (
            <a href="/login" className="bg-slate-900 hover:bg-slate-800 text-white shadow-lg shadow-slate-900/20 text-xs font-bold px-5 py-2.5 rounded-full transition-all flex items-center gap-2">
              <span>👤</span> Iniciar Sesión
            </a>
          )}
        </div>

        {/* SELECTOR DE MODO PREMIUM */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
          {BODEGA_ACTIVA && (
            <button
              onClick={() => setMode("bodega")}
              className={`py-4 px-4 rounded-3xl text-sm font-black transition-all flex items-center justify-center gap-3 border-2 ${
                mode === "bodega"
                  ? "bg-slate-900 border-slate-900 text-white shadow-xl scale-105"
                  : "bg-white border-slate-100 text-slate-400"
              }`}
            >
              <span className="text-xl">🏪</span> Bodega
            </button>
          )}
          <button
            onClick={() => setMode("domicilio")}
            className={`py-4 px-4 rounded-3xl text-sm font-black transition-all flex items-center justify-center gap-3 border-2 ${
              mode === "domicilio"
                ? "bg-sky-500 border-sky-500 text-white shadow-xl scale-105"
                : "bg-white border-slate-100 text-slate-400"
            }`}
          >
            <span className="text-xl">🛵</span> Domicilio
          </button>
          <button
            onClick={() => setMode("paqueteria")}
            className={`py-4 px-4 rounded-3xl text-sm font-black transition-all flex items-center justify-center gap-3 border-2 ${
              mode === "paqueteria"
                ? "bg-sky-500 border-sky-500 text-white shadow-xl scale-105"
                : "bg-white border-slate-100 text-slate-400"
            }`}
          >
            <span className="text-xl">📦</span> Paquetería
          </button>
        </div>

        {/* SELECCIÓN DE PRODUCTOS (INTERFAZ TÁCTIL) */}
        {clientProfile && clientSales.some(s => s.status !== 'cancelled' && s.sale_items?.some(i => i.delivery_status !== 'delivered')) && mode !== "paqueteria" && (
          <div className="mb-8 bg-white border-2 border-slate-100 rounded-[2.5rem] p-6 shadow-sm overflow-hidden relative">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-sky-500/10 text-sky-600 rounded-xl flex items-center justify-center text-xl">📦</div>
              <div>
                <h3 className="font-black text-slate-900 leading-tight">Tus artículos listos</h3>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Toca para seleccionar qué enviar</p>
              </div>
            </div>
            
            <div className="grid gap-3 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar">
              {clientSales.map(sale => {
                if (sale.status === 'cancelled') return null;
                const pendingItems = sale.sale_items?.filter(item => item.delivery_status !== 'delivered') || [];
                if (pendingItems.length === 0) return null;
                return pendingItems.map(item => {
                  const isItemSelected = selectedItems.some(i => i.id === item.id);
                  return (
                    <div 
                      key={item.id} 
                      onClick={() => {
                        if (isItemSelected) {
                          setSelectedItems(selectedItems.filter(i => i.id !== item.id));
                        } else {
                          setSelectedItems([...selectedItems, { ...item, sale_id: sale.id, product_name: item.products?.name }]);
                        }
                      }}
                      className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                        isItemSelected
                          ? "bg-sky-50 border-sky-500 shadow-md"
                          : "bg-slate-50/50 border-slate-100 hover:border-slate-200"
                      }`}
                    >
                      <div className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-colors ${
                        isItemSelected ? "bg-sky-500 border-sky-500 text-white" : "bg-white border-slate-200"
                      }`}>
                        {isItemSelected && <span className="text-xs font-black">✓</span>}
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm font-black ${isItemSelected ? "text-sky-900" : "text-slate-800"}`}>
                          {item.quantity}x {item.products?.name}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md ${
                            sale.status === 'credit' ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                          }`}>
                            {sale.status === 'credit' ? "A crédito" : "Pagado"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                });
              })}
            </div>
            
            <div className="mt-6 pt-5 border-t border-slate-100 flex justify-between items-center bg-white">
              <div>
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1">Total a liquidar</span>
                <span className="text-2xl font-black text-slate-900">${calculatingDebt.toFixed(2)}</span>
              </div>
              <div className="text-right">
                 <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] block mb-1">Seleccionados</span>
                 <span className="text-xl font-black text-emerald-500">{selectedItems.length} items</span>
              </div>
            </div>
          </div>
        )}

        {/* contenido */}
        {/* 🟢 AJUSTE: Contenido de Bodega solo si está activa */}
        {mode === "bodega" && BODEGA_ACTIVA ? (
          <div className="space-y-4 mb-4">
            <p className="text-sm text-slate-600">
              Las entregas en bodega son <b>de lunes a viernes</b> de{" "}
              <b>1:00 pm a 5:00 pm</b>. Debes agendar con al menos{" "}
              <b>1 día de anticipación (no mismo día)</b>.
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
              <p className="font-semibold mb-1">POLÍTICA ENTREGA EN BODEGA</p>
              <p>Entregas únicamente de 1:00 pm a 5:00 pm sin excepción.</p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Instagram *</label>
              <input
                value={insta}
                onChange={(e) => setInsta(e.target.value)}
                required
                placeholder="@tuusuario"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Nombre completo *
              </label>
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Nombre y apellidos"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Teléfono / WhatsApp *
              </label>
              <input
                type="tel"
                value={phone}
                onChange={handlePhoneChange}
                required
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="871..."
                inputMode="numeric"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              {bodegaCardDates.map(({ date: d, isExtra, start_time, end_time }) => {
                const dateStr = toInputDate(d);
                const blocked = isBlocked(dateStr, "bodega");

                const weekdayNum = d.getDay();
                const weekdayKey =
                  weekdayNum === 1
                    ? "monday"
                    : weekdayNum === 2
                    ? "tuesday"
                    : weekdayNum === 3
                    ? "wednesday"
                    : weekdayNum === 4
                    ? "thursday"
                    : weekdayNum === 5
                    ? "friday"
                    : null;

                const disabled =
                  blocked ||
                  isSubmitting ||
                  (weekdayKey &&
                    slots &&
                    slots[weekdayKey] &&
                    slots[weekdayKey].disabled === true);

                const weekdayLabel = capitalizeFirst(
                  d.toLocaleDateString("es-MX", { weekday: "long" })
                );

                return (
                  <button
                    key={dateStr}
                    onClick={() =>
                      handleBodegaBooking(weekdayKey, d, {
                        isExtra,
                        start_time,
                        end_time,
                      })
                    }
                    disabled={disabled}
                    className={`border rounded-xl p-3 text-left transition ${
                      blocked
                        ? "bg-red-100 border-red-200 text-red-700 cursor-not-allowed"
                        : disabled
                        ? "bg-slate-100 text-slate-500 cursor-not-allowed"
                        : "bg-white hover:border-emerald-400"
                    }`}
                  >
                    <p className="text-sm font-medium">{toNiceDate(d)}</p>
                    <p className="text-[11px] text-slate-500">{weekdayLabel}</p>

                    {isExtra && (
                      <p className="text-[11px] text-emerald-700 mt-1">
                        ✨ Día extra habilitado
                      </p>
                    )}

                    {isExtra && start_time && end_time && (
                      <p className="text-[11px] text-slate-600 mt-1">
                        🕒 Horario especial: {start_time} – {end_time}
                      </p>
                    )}

                    {blocked && (
                      <p className="text-[11px] text-red-600 mt-1">
                        ⛔ Este día no nos encontramos en bodega
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ) : mode === "domicilio" ? (
          <form onSubmit={handleDomicilioBooking} className="space-y-5 mb-8">
            {clientProfile && hasPendingFailedAttempt && (
              <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-4 shadow-sm">
                <p className="font-black text-rose-700 flex items-center gap-2 mb-1"><span>⚠️</span> Doble costo de envío aplicado</p>
                <p className="text-rose-600 text-xs leading-relaxed">
                  Tuvimos un intento de entrega fallido en tu dirección. Por política, el siguiente envío tiene un costo de <b>$90.00 MXN</b> en lugar de $45.00.
                </p>
              </div>
            )}

            <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10 text-4xl">🛵</div>
              <div className="relative z-10">
                {clientProfile && hasPendingFailedAttempt ? (
                  <div className="flex justify-between items-center mb-4">
                    <div>
                      <span className="font-bold text-sm tracking-wide text-slate-300 block">COSTO DE ENVÍO</span>
                      <span className="text-[10px] text-rose-400 font-bold uppercase">Penalización por intento fallido</span>
                    </div>
                    <div className="text-right">
                      <span className="font-black text-xl text-rose-400">$90.00 MXN</span>
                      <span className="text-slate-500 text-xs line-through block">$45.00</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-between items-center mb-4">
                    <span className="font-bold text-sm tracking-wide text-slate-300">COSTO DE ENVÍO</span>
                    <span className="font-black text-xl">$45.00 MXN</span>
                  </div>
                )}

                {clientProfile && selectedItems.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-white/10 space-y-2">
                    <div className="flex justify-between text-sm text-slate-300 font-medium">
                      <span>Adeudo de artículos:</span>
                      <span>${calculatingDebt.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-black text-lg text-emerald-400 pt-1">
                      <span>TOTAL A PAGAR:</span>
                      <span>${(calculatingDebt + (hasPendingFailedAttempt ? 90 : 45)).toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200/60 rounded-2xl p-4 text-sm text-amber-900 shadow-sm">
              <p className="font-bold mb-1 flex items-center gap-2"><span>⚠️</span> POLÍTICA DE ENTREGA</p>
              <p className="text-amber-800/80 leading-relaxed text-xs">
                Nuestro repartidor tiene una ruta optimizada, por lo que <b>no tenemos hora exacta</b>.
                Llamaremos 2 veces al llegar; en caso de no tener respuesta el envío deberá ser pagado nuevamente.
              </p>
            </div>

            <div className="grid gap-6 bg-white p-8 rounded-[2.5rem] border-2 border-slate-100 shadow-sm animate-in fade-in slide-in-from-bottom duration-500">
              <div className="grid grid-cols-1 gap-5">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Instagram de contacto</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 font-black">@</span>
                    <input
                      value={insta}
                      onChange={(e) => setInsta(e.target.value)}
                      required
                      placeholder="tu_usuario"
                      className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl pl-10 pr-4 py-4 text-sm font-bold focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Nombre</label>
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl px-4 py-4 text-sm font-bold focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
                    placeholder="Escribe tu nombre"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">WhatsApp de contacto</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={handlePhoneChange}
                    required
                    className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl px-4 py-4 text-sm font-bold focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
                    placeholder="10 dígitos sin espacios"
                    inputMode="numeric"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-50">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Calle *</label>
                    <input
                      value={street}
                      onChange={(e) => setStreet(e.target.value)}
                      required
                      placeholder="Nombre de la calle"
                      className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl px-4 py-4 text-sm font-bold focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Número (Ext/Int) *</label>
                    <input
                      value={houseNum}
                      onChange={(e) => setHouseNum(e.target.value)}
                      required
                      placeholder="Ej: 123 o 123-A"
                      className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl px-4 py-4 text-sm font-bold focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Colonia *</label>
                    <input
                      value={colonia}
                      onChange={(e) => setColonia(e.target.value)}
                      required
                      placeholder="Nombre de la colonia"
                      className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl px-4 py-4 text-sm font-bold focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Referencias *</label>
                    <input
                      value={references}
                      onChange={(e) => setReferences(e.target.value)}
                      required
                      placeholder="Color de casa, entre calles, etc."
                      className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl px-4 py-4 text-sm font-bold focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Ciudad</label>
                  <select
                    value={domicilioCity}
                    onChange={handleDomicilioCityChange}
                    className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl px-4 py-4 text-sm font-bold focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
                    required
                  >
                    <option value="">Selecciona</option>
                    {LAGUNA_CITIES.map((c) => (
                      <option key={c.city} value={c.city}>{c.city}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">C.P.</label>
                  <input
                    value={domicilioCP}
                    onChange={handleCPChange}
                    className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl px-4 py-4 text-sm font-bold focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
                    placeholder="35000"
                    inputMode="numeric"
                    maxLength={5}
                    required
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-50">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Ubicación Google Maps</label>
                  <button type="button" onClick={() => setShowLocationHelp(true)} className="text-[9px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">¿CÓMO HACERLO?</button>
                </div>
                <input
                  type="text"
                  value={locationUrl}
                  onChange={(e) => setLocationUrl(e.target.value)}
                  className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl px-4 py-4 text-sm font-bold focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
                  placeholder="Pega el enlace aquí"
                />
              </div>

              <div className="pt-6 border-t border-slate-100">
                <div className="flex items-center justify-between mb-4">
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Fecha de Entrega</label>
                  {deliveryDate && domicilioRemaining === 0 && (
                    <span className="text-[10px] font-black text-red-600 bg-red-50 px-3 py-1 rounded-full">
                      SIN CUPO
                    </span>
                  )}
                  {deliveryDate && domicilioRemaining > 0 && (
                    <span className={`text-[10px] font-black px-3 py-1 rounded-full animate-pulse ${
                      domicilioRemaining >= 10
                        ? "text-emerald-600 bg-emerald-50"
                        : domicilioRemaining >= 6
                        ? "text-lime-600 bg-lime-50"
                        : domicilioRemaining >= 3
                        ? "text-amber-600 bg-amber-50"
                        : "text-red-600 bg-red-50"
                    }`}>
                      ¡HAY CUPO! {domicilioRemaining} DISP.
                    </span>
                  )}
                </div>
                <div className="relative">
                  <DatePicker
                    selected={deliveryDate}
                    onChange={(date) => {
                      if (!date) { setDeliveryDate(null); return; }
                      const dateStr = toInputDate(date);
                      if (isBlocked(dateStr, "domicilio")) {
                        setError("Ese día no estamos entregando a domicilio.");
                        setDeliveryDate(null);
                        return;
                      }
                      setError("");
                      setDeliveryDate(date);
                    }}
                    filterDate={isWeekday}
                    minDate={minDate}
                    maxDate={maxDate}
                    excludeDates={blockedForDomicilio}
                    placeholderText="Toca para elegir fecha"
                    className="w-full bg-emerald-500 text-slate-900 border-none rounded-2xl px-4 py-5 text-base font-black text-center focus:outline-none shadow-lg shadow-emerald-500/20"
                    locale="es"
                    dateFormat="EEEE d 'de' MMMM"
                    inline
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100">
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 ml-1">Notas adicionales (Opcional)</label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full bg-slate-50 border-2 border-slate-50 rounded-2xl px-4 py-4 text-sm font-bold focus:outline-none focus:border-emerald-500 focus:bg-white transition-all"
                  placeholder="Timbres, color de casa, etc..."
                />
              </div>

              <div className="bg-indigo-600 rounded-3xl p-6 text-white shadow-xl shadow-indigo-600/20 relative overflow-hidden group">
                <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-150 transition-transform duration-700 text-4xl">🛵</div>
                <div className="flex justify-between items-center mb-4 relative z-10">
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] opacity-80">Resumen de Envío</span>
                  <span className="bg-white/20 px-3 py-1 rounded-full text-[10px] font-black">ENTREGA LOCAL</span>
                </div>
                <div className="flex justify-between items-end relative z-10">
                  <div>
                    <p className="text-[10px] font-bold opacity-60 uppercase mb-1">Costo de envío</p>
                    <p className="text-3xl font-black">$45.00</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-bold opacity-60 uppercase mb-1">Total a Pagar</p>
                    <p className="text-3xl font-black">${(calculatingDebt + 45).toFixed(2)}</p>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-black py-5 rounded-[2rem] shadow-2xl shadow-emerald-500/30 transition-all active:scale-[0.97] flex items-center justify-center gap-3 disabled:opacity-50 mt-2"
              >
                {isSubmitting ? (
                  <div className="w-6 h-6 border-4 border-slate-900 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <span>CONFIRMAR ENTREGA</span>
                    <span className="text-xl">🛵</span>
                  </>
                )}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handlePaqueteriaBooking} className="space-y-5 mb-8">
            <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10 text-4xl">📦</div>
              <div className="relative z-10">
                <p className="font-bold text-sm tracking-wide text-slate-300 mb-2">ENVÍOS FORÁNEOS</p>
                <p className="text-slate-300 text-sm leading-relaxed">
                  Envíos por paquetería para clientes fuera de la ciudad. Llena tus datos y te contactaremos por privado para <b>cotizar tu envío</b>.
                </p>
              </div>
            </div>

            <div className="grid gap-5 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Instagram *</label>
                <input
                  value={insta}
                  onChange={(e) => setInsta(e.target.value)}
                  required
                  placeholder="@tuusuario"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Nombre completo *</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all"
                  placeholder="Nombre y apellidos"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Teléfono / WhatsApp *</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={handlePhoneChange}
                  required
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all"
                  placeholder="871..."
                  inputMode="numeric"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Calle *</label>
                  <input
                    value={pkgStreet}
                    onChange={(e) => setPkgStreet(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all"
                    placeholder="Nombre de la calle"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Número exterior *</label>
                  <input
                    value={pkgNumExt}
                    onChange={(e) => setPkgNumExt(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all"
                    placeholder="Ej. 123"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Número interior <span className="normal-case font-normal opacity-60">(opcional)</span></label>
                  <input
                    value={pkgNumInt}
                    onChange={(e) => setPkgNumInt(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all"
                    placeholder="Ej. 4B"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Colonia *</label>
                  <input
                    value={pkgColonia}
                    onChange={(e) => setPkgColonia(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all"
                    placeholder="Nombre de la colonia"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Código postal *</label>
                  <input
                    value={pkgCP}
                    onChange={(e) => setPkgCP(e.target.value)}
                    required
                    inputMode="numeric"
                    maxLength={5}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all"
                    placeholder="Ej. 27000"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Referencias *</label>
                  <input
                    value={pkgRefs}
                    onChange={(e) => setPkgRefs(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all"
                    placeholder="Ej. Casa azul, entre calles..."
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Ciudad *</label>
                  <input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    required
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 transition-all"
                    placeholder="Ej. Monterrey"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Estado *</label>
                  <select
                    value={stateMx}
                    onChange={(e) => setStateMx(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                    required
                  >
                    <option value="">Selecciona un estado</option>
                    {MEX_STATES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className={`w-full py-4 rounded-2xl text-sm font-black uppercase tracking-widest shadow-lg transition-all active:scale-95 ${
                isSubmitting
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                  : "bg-slate-900 hover:bg-slate-800 text-white shadow-slate-900/30"
              }`}
            >
              {isSubmitting ? "Enviando..." : "COTIZAR"}
            </button>
          </form>
        )}

        {msg && (
          <p className="bg-emerald-50 text-emerald-700 rounded-lg px-3 py-2 text-sm mb-2">
            {msg}
          </p>
        )}
        {error && (
          <p className="bg-red-50 text-red-700 rounded-lg px-3 py-2 text-sm mb-2">
            {error}
          </p>
        )}
      </div>

      {/* 🟢 MODAL DE ÉXITO PREMIUM */}
      {successModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-[3rem] shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-300">
            <div className="bg-emerald-500 p-8 text-center relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10 text-6xl">✨</div>
              <div className="w-20 h-20 bg-white rounded-[2rem] flex items-center justify-center text-4xl shadow-xl mx-auto mb-4 relative z-10">
                {successBooking.type === "domicilio" ? "🛵" : successBooking.type === "bodega" ? "🏪" : "📦"}
              </div>
              <h2 className="text-2xl font-black text-slate-900 leading-tight relative z-10">¡Todo listo!</h2>
              <p className="text-[10px] font-black text-slate-900/60 uppercase tracking-widest mt-1 relative z-10">Tu entrega ha sido agendada</p>
            </div>

            <div className="p-8">
              <div className="space-y-4 mb-8">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-lg">👤</div>
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Cliente</p>
                    <p className="text-sm font-bold text-slate-900">{successBooking.fullName}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-lg">📅</div>
                  <div>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Fecha</p>
                    <p className="text-sm font-bold text-slate-900">{formatDateStringMX(successBooking.date)}</p>
                  </div>
                </div>

                {successBooking.address && (
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center text-lg shrink-0">📍</div>
                    <div>
                      <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Destino</p>
                      <p className="text-xs font-bold text-slate-900 leading-relaxed">{successBooking.address}, {successBooking.city}</p>
                    </div>
                  </div>
                )}

                {successBooking.type === "bodega" && successBooking.horario && (
                  <div className="bg-amber-50 rounded-2xl p-4 border-2 border-amber-100">
                    <p className="text-[9px] font-black text-amber-600 uppercase tracking-widest mb-1 text-center">Horario de Recolección</p>
                    <p className="text-xl font-black text-amber-900 text-center">{successBooking.horario}</p>
                  </div>
                )}
              </div>

              <div className="bg-slate-50 rounded-2xl p-4 mb-8 flex items-center justify-between">
                 <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">ID de Registro</p>
                 <p className="text-xs font-mono font-black text-slate-900">#AG-{Math.floor(1000 + Math.random() * 9000)}</p>
              </div>

              <button
                onClick={() => {
                  const { date, fullName, address, city } = successBooking;
                  const d = (date || "").replace(/-/g, "");
                  const nextDay = new Date(date);
                  nextDay.setDate(nextDay.getDate() + 1);
                  const dNext = nextDay.toISOString().split("T")[0].replace(/-/g, "");
                  const lines = [
                    "BEGIN:VCALENDAR",
                    "VERSION:2.0",
                    "PRODID:-//Noreste CM//Agendalo TRC//ES",
                    "BEGIN:VEVENT",
                    `UID:AG-${Date.now()}@trc.com`,
                    `DTSTAMP:${new Date().toISOString().replace(/[-:.]/g, "").slice(0, 15)}Z`,
                    `DTSTART;VALUE=DATE:${d}`,
                    `DTEND;VALUE=DATE:${dNext}`,
                    `SUMMARY:Entrega TRC - ${fullName}`,
                    `DESCRIPTION:Tu entrega de Noreste CM agendada para el ${formatDateStringMX(date)}`,
                    address ? `LOCATION:${address}\\, ${city}` : "",
                    "END:VEVENT",
                    "END:VCALENDAR",
                  ].filter(Boolean).join("\r\n");
                  const blob = new Blob([lines], { type: "text/calendar;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "entrega-trc.ics";
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="w-full mb-3 bg-emerald-500 hover:bg-emerald-400 text-white font-black py-3.5 rounded-2xl shadow-lg shadow-emerald-500/20 active:scale-[0.97] transition-all flex items-center justify-center gap-2"
              >
                📅 Agregar al Calendario
              </button>

              <button
                onClick={() => {
                  setSuccessModal(false);
                  router.push("/");
                }}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-black py-4 rounded-2xl shadow-xl active:scale-[0.97] transition-all"
              >
                CERRAR Y VOLVER
              </button>

              <p className="text-center text-[10px] font-bold text-slate-400 mt-4 uppercase tracking-widest">📸 ¡Toma una captura!</p>
            </div>
          </div>
        </div>
      )}

      {/* ℹ️ MODAL DE AYUDA PARA UBICACIÓN DE MAPS */}
      {showLocationHelp && (
        <div className="fixed inset-0 bg-slate-50/40 flex items-center justify-center z-40">
          <div className="bg-white rounded-2xl shadow-xl p-5 w-full max-w-md text-sm text-slate-700 space-y-3">
            <h2 className="text-base font-semibold text-slate-900">
              ¿Cómo copiar tu ubicación desde Google Maps?
            </h2>

            <ol className="list-decimal pl-5 space-y-1 text-xs sm:text-sm">
              <li>Abre la app de <b>Google Maps</b> en tu celular.</li>
              <li>Busca tu casa o la dirección donde quieres recibir la entrega.</li>
              <li>Mantén el dedo presionado unos segundos hasta que aparezca un pin rojo.</li>
              <li>En la parte de abajo se abrirá una tarjeta con la dirección. tócala.</li>
              <li>Busca la opción <b>Compartir</b> y tócala.</li>
              <li>Elige <b>Copiar enlace</b>.</li>
              <li>Pega el enlace en el campo de &quot;Ubicación de Google Maps&quot;.</li>
            </ol>

            <button
              type="button"
              onClick={() => setShowLocationHelp(false)}
              className="mt-2 w-full bg-emerald-500 hover:bg-emerald-600 text-slate-900 rounded-lg py-2 text-xs sm:text-sm font-semibold"
            >
              Entendido
            </button>
          </div>
        </div>
      )}
    </div>
  );
}






















