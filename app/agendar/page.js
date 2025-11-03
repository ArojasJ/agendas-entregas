"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { es } from "date-fns/locale";
import { registerLocale } from "react-datepicker";

registerLocale("es", es);

// 🔹 genera los siguientes martes y jueves válidos (siempre a partir de MAÑANA)
function getNextPickupDates(count = 6) {
  const result = [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // empezamos a contar desde mañana
  let d = new Date(today);
  d.setDate(d.getDate() + 1);

  while (result.length < count) {
    const day = d.getDay();
    // martes (2) o jueves (4)
    if (day === 2 || day === 4) {
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
  const [mode, setMode] = useState("bodega");
  const [slots, setSlots] = useState(null); // para bodega
  const [allBookings, setAllBookings] = useState([]); // para contar domicilio
  const [blockedDays, setBlockedDays] = useState([]); // 🆕 lo que viene de Supabase
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  // campos cliente
  const [insta, setInsta] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [city, setCity] = useState(""); // solo paquetería
  const [stateMx, setStateMx] = useState("Coahuila"); // paquetería
  const [deliveryDate, setDeliveryDate] = useState(null);

  // 👇 NUEVOS para DOMICILIO
  const [domicilioCity, setDomicilioCity] = useState("");
  const [domicilioState, setDomicilioState] = useState("");
  const [domicilioCP, setDomicilioCP] = useState("");

  // modal éxito
  const [successModal, setSuccessModal] = useState(false);
  const [successText, setSuccessText] = useState("");
  const [successBooking, setSuccessBooking] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // límite domicilio
  const DOMICILIO_LIMIT = 15;

  const pickupDates = getNextPickupDates(6);

  // traer bookings (para conteo) Y días bloqueados (públicos)
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch("/api/bookings");
        if (res.ok) {
          const data = await res.json();
          setSlots(data.slots || null);
          setAllBookings(data.bookings || []);
        }
      } catch (err) {
        console.error(err);
      }

      try {
        const res2 = await fetch("/api/blocked-days");
        const data2 = await res2.json();
        setBlockedDays(data2.blockedDays || []);
      } catch (err) {
        console.warn("No se pudieron leer los días bloqueados públicos", err);
      }
    };
    fetchData();
  }, []);

  // helpers de bloqueos
  const isBlocked = (dateStr, type) => {
    return blockedDays.some((bd) => bd.date === dateStr && bd.type === type);
  };

  // fechas válidas para domicilio (mínimo mañana, máximo 30 días)
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const minDate = new Date(today);
  minDate.setDate(minDate.getDate() + 1);

  const maxDate = new Date(today);
  maxDate.setDate(maxDate.getDate() + 30);

  // lista de fechas bloqueadas SOLO para domicilio (react-datepicker las pinta grises)
  const blockedForDomicilio = blockedDays
    .filter((b) => b.type === "domicilio")
    .map((b) => new Date(b.date + "T00:00:00"));

  const isWeekday = (date) => {
    const day = date.getDay();
    const dateStr = date.toISOString().split("T")[0];

    // día bloqueado en Supabase
    if (isBlocked(dateStr, "domicilio")) return false;

    // solo lunes a viernes
    if (day === 0 || day === 6) return false;

    return true;
  };

  // cuántos hay ya para la fecha seleccionada (solo domicilio)
  let domicilioCountForSelected = 0;
  if (deliveryDate && allBookings.length > 0) {
    const selectedStr = toInputDate(deliveryDate);
    domicilioCountForSelected = allBookings.filter(
      (b) => b.type === "domicilio" && b.date === selectedStr
    ).length;
  }
  const domicilioRemaining =
    deliveryDate != null
      ? Math.max(DOMICILIO_LIMIT - domicilioCountForSelected, 0)
      : DOMICILIO_LIMIT;

  // 🟢 BODEGA
  const handleBodegaBooking = async (day, date) => {
    if (isSubmitting) return;
    setMsg("");
    setError("");

    if (!insta || !fullName || !phone) {
      setError("Llena Instagram, nombre y teléfono.");
      return;
    }
    if (!date) {
      setError("Selecciona la fecha del martes/jueves.");
      return;
    }

    const dateStr = toInputDate(date);
    if (isBlocked(dateStr, "bodega")) {
      setError("Ese día no estamos entregando en bodega. Elige otro.");
      return;
    }

    // ❌ No permitir agendar para el mismo día
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
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "bodega",
          day,
          date: toInputDate(date),
          instagram: instaValue,
          fullName,
          phone,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || "No se pudo agendar.");
      } else {
        setSuccessText("✅ Tu entrega en bodega quedó registrada.");
        setSuccessBooking({
          type: "bodega",
          instagram: instaValue,
          date: toInputDate(date),
          fullName,
          phone,
        });
        setSuccessModal(true);

        setAllBookings((prev) => [
          ...prev,
          {
            id: data.booking?.id || Date.now(),
            type: "bodega",
            day,
            date: toInputDate(date),
            instagram: instaValue,
            fullName,
            phone,
          },
        ]);
      }
    } catch (err) {
      setError("Error de conexión.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 🟢 DOMICILIO
  const handleDomicilioBooking = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setMsg("");
    setError("");

    if (
      !insta ||
      !fullName ||
      !phone ||
      !address ||
      !domicilioCity ||
      !domicilioState ||
      !domicilioCP
    ) {
      setError("Llena todos los campos (incluye ciudad, estado y C.P.).");
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

    // ❌ No permitir agendar para el mismo día
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

    const alreadyForDay = allBookings.filter(
      (b) => b.type === "domicilio" && b.date === selectedStr
    ).length;
    if (alreadyForDay >= DOMICILIO_LIMIT) {
      setError("Ya no hay entregas disponibles para ese día.");
      return;
    }

    let instaValue = insta.trim();
    if (!instaValue.startsWith("@")) instaValue = "@" + instaValue;

    try {
      setIsSubmitting(true);
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "domicilio",
          instagram: instaValue,
          fullName,
          phone,
          address,
          notes,
          date: selectedStr,
          city: domicilioCity,
          state: domicilioState,
          postalCode: domicilioCP,
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
          address,
          notes,
          city: domicilioCity,
          state: domicilioState,
          postalCode: domicilioCP,
          price: 40,
        });
        setSuccessModal(true);

        // limpiar
        setInsta("");
        setFullName("");
        setPhone("");
        setAddress("");
        setNotes("");
        setDeliveryDate(null);
        setDomicilioCity("");
        setDomicilioState("");
        setDomicilioCP("");

        // actualizar lista
        setAllBookings((prev) => [
          ...prev,
          {
            id: data.booking?.id || Date.now(),
            type: "domicilio",
            date: selectedStr,
            instagram: instaValue,
            fullName,
            phone,
            address,
            notes,
            city: domicilioCity,
            state: domicilioState,
            postalCode: domicilioCP,
          },
        ]);
      }
    } catch (err) {
      setError("Error de conexión.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // 🟢 PAQUETERÍA
  const handlePaqueteriaBooking = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setMsg("");
    setError("");

    if (!insta || !fullName || !phone || !address || !city || !stateMx) {
      setError("Llena todos los campos de paquetería.");
      return;
    }

    let instaValue = insta.trim();
    if (!instaValue.startsWith("@")) instaValue = "@" + instaValue;

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
          address,
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
          address,
          city,
          state: stateMx,
        });
        setSuccessModal(true);

        // limpiar
        setInsta("");
        setFullName("");
        setPhone("");
        setAddress("");
        setCity("");
        setStateMx("Coahuila");

        setAllBookings((prev) => [
          ...prev,
          {
            id: data.booking?.id || Date.now(),
            type: "paqueteria",
            date: todayStr,
            instagram: instaValue,
            fullName,
            phone,
            address,
            city,
            state: stateMx,
          },
        ]);
      }
    } catch (err) {
      setError("Error de conexión.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // handler de teléfono: solo números y máximo 10 dígitos
  const handlePhoneChange = (e) => {
    const onlyNums = e.target.value.replace(/[^0-9]/g, "").slice(0, 10);
    setPhone(onlyNums);
  };

  // handler de CP: 5 dígitos
  const handleCPChange = (e) => {
    const onlyNums = e.target.value.replace(/[^0-9]/g, "").slice(0, 5);
    setDomicilioCP(onlyNums);
  };

  // handler ciudad domicilio: autollenar estado
  const handleDomicilioCityChange = (e) => {
    const value = e.target.value;
    setDomicilioCity(value);
    const found = LAGUNA_CITIES.find((c) => c.city === value);
    if (found) {
      setDomicilioState(found.state);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center py-10 px-4">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-lg p-6 md:p-8">
        {/* botón inicio */}
        <div className="mb-4">
          <a
            href="/"
            className="inline-flex items-center gap-2 text-sm text-emerald-600 hover:text-emerald-700 font-medium"
          >
            🏠 Inicio
          </a>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              Agenda tu entrega
            </h1>
            <p className="text-sm text-slate-500">
              Nuestros productos son ORIGINALES, de las mejores marcas y con
              precios justos 🇺🇸
            </p>
          </div>
        </div>

        {/* selector */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setMode("bodega")}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold ${
              mode === "bodega"
                ? "bg-emerald-500 text-white"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            Recoger en bodega
          </button>
          <button
            onClick={() => setMode("domicilio")}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold ${
              mode === "domicilio"
                ? "bg-emerald-500 text-white"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            Entrega a domicilio
          </button>
          <button
            onClick={() => setMode("paqueteria")}
            className={`flex-1 py-2 rounded-xl text-sm font-semibold ${
              mode === "paqueteria"
                ? "bg-emerald-500 text-white"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            Paquetería 📦
          </button>
        </div>

        {/* contenido */}
        {mode === "bodega" ? (
          <div className="space-y-4 mb-4">
            <p className="text-sm text-slate-600">
              Las entregas en bodega son <b>martes y jueves</b> de{" "}
              <b>6:00 pm a 8:00 pm</b>. Debes agendar con al menos{" "}
              <b>1 día de anticipación (no mismo día)</b>.
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
              <p className="font-semibold mb-1">POLÍTICA ENTREGA EN BODEGA</p>
              <p>Entregas únicamente de 6:00 pm a 8:00 pm sin excepción.</p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Instagram *
              </label>
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
              {pickupDates.map((d) => {
                const weekday = d.getDay() === 2 ? "tuesday" : "thursday";
                const dateStr = toInputDate(d);
                const blocked = isBlocked(dateStr, "bodega");
                const disabled =
                  blocked ||
                  isSubmitting ||
                  (slots &&
                    slots[weekday] &&
                    slots[weekday].disabled === true);

                return (
                  <button
                    key={d.toISOString()}
                    onClick={() => handleBodegaBooking(weekday, d)}
                    disabled={disabled}
                    className={`border rounded-xl p-3 text-left transition ${
                      blocked
                        ? "bg-red-100 border-red-200 text-red-700 cursor-not-allowed"
                        : disabled
                        ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                        : "bg-white hover:border-emerald-400"
                    }`}
                  >
                    <p className="text-sm font-medium">{toNiceDate(d)}</p>
                    <p className="text-[11px] text-slate-400">
                      {weekday === "tuesday" ? "Martes" : "Jueves"}
                    </p>
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
          <form onSubmit={handleDomicilioBooking} className="space-y-4 mb-4">
            <p className="text-sm text-slate-600">
              Entregamos de <b>lunes a viernes</b> (sin horario exacto). Debes
              agendar con al menos{" "}
              <b>1 día de anticipación (no mismo día)</b>.
            </p>

            <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-sm text-emerald-800">
              <p className="font-semibold mb-1">
                Costo de entrega a domicilio: <b>$40 MXN</b>
              </p>
              <p className="text-xs">
                Puedes pagar por transferencia o en efectivo.
              </p>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
              <p className="font-semibold mb-1">
                POLÍTICA DE ENTREGA DOMICILIO
              </p>
              <p className="mb-1">
                Nuestro repartidor tiene una ruta optimizada de entrega por lo
                que no tenemos hora exacta.
              </p>
              <p>
                Llamaremos 2 veces al llegar, en caso de no tener respuesta el
                envío deberá ser pagado nuevamente.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Instagram *
              </label>
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

            {/* dirección */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Dirección completa (calle, número, colonia) *
              </label>
              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Ej. Calle Zaragoza 124, col. Centro..."
              />
            </div>

            {/* ciudad + estado + cp */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Ciudad *
                </label>
                <select
                  value={domicilioCity}
                  onChange={handleDomicilioCityChange}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                  required
                >
                  <option value="">Selecciona ciudad</option>
                  {LAGUNA_CITIES.map((c) => (
                    <option key={c.city} value={c.city}>
                      {c.city}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Estado *
                </label>
                <select
                  value={domicilioState}
                  onChange={(e) => setDomicilioState(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                  required
                >
                  <option value="">Selecciona estado</option>
                  <option value="Coahuila">Coahuila</option>
                  <option value="Durango">Durango</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Código Postal *
                </label>
                <input
                  value={domicilioCP}
                  onChange={handleCPChange}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="35000"
                  inputMode="numeric"
                  maxLength={5}
                  required
                />
              </div>
            </div>

            {/* notas */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Referencia / notas para el repartidor
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Casa de portón negro, dejar con vecino, llamar antes..."
                rows={2}
              />
            </div>

            {/* fecha */}
            <div>
              <label className="block text-sm font-medium mb-1">
                Fecha de entrega (lunes a viernes) *
              </label>
              <DatePicker
                selected={deliveryDate}
                onChange={(date) => {
                  if (!date) {
                    setDeliveryDate(null);
                    return;
                  }
                  const dateStr = toInputDate(date);
                  if (isBlocked(dateStr, "domicilio")) {
                    setError("Ese día no estamos entregando a domicilio.");
                    setDeliveryDate(null);
                    return;
                  }
                  setError("");
                  setDeliveryDate(date);
                }}
                minDate={minDate}
                maxDate={maxDate}
                filterDate={isWeekday}
                excludeDates={blockedForDomicilio}
                locale="es"
                dateFormat="EEEE d 'de' MMMM"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>

            {deliveryDate && (
              <p
                className={`text-sm ${
                  domicilioRemaining > 0
                    ? "text-emerald-600"
                    : "text-red-500 font-medium"
                }`}
              >
                {domicilioRemaining > 0
                  ? `Quedan ${domicilioRemaining} lugar(es) para este día.`
                  : "Ya no hay lugares para este día."}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className={`w-full py-2 rounded-lg text-sm font-semibold ${
                isSubmitting
                  ? "bg-slate-300 cursor-not-allowed text-slate-600"
                  : "bg-emerald-500 hover:bg-emerald-600 text-white"
              }`}
            >
              {isSubmitting ? "Agendando..." : "Agendar entrega a domicilio"}
            </button>
          </form>
        ) : (
          // PAQUETERÍA
          <form onSubmit={handlePaqueteriaBooking} className="space-y-4 mb-4">
            <p className="text-sm text-slate-600">
              Envíos por paquetería 📦 para clientes fuera de la ciudad. Llena tus
              datos y te contactaremos por privado para <b>cotizar tu envío</b>.
            </p>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900">
              <p className="font-semibold mb-1">POLÍTICA PAQUETERÍA</p>
              <p>Agenda tu entrega para cotizar tu paquete.</p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Instagram *
              </label>
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
            <div>
              <label className="block text-sm font-medium mb-1">
                Dirección completa de envío *
              </label>
              <textarea
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
                className="w-full border rounded-lg px-3 py-2 text-sm"
                placeholder="Calle, número, colonia, referencias..."
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Ciudad *
                </label>
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="Torreón, Gómez, Durango..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">
                  Estado *
                </label>
                <select
                  value={stateMx}
                  onChange={(e) => setStateMx(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
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

            <button
              type="submit"
              disabled={isSubmitting}
              className={`w-full py-2 rounded-lg text-sm font-semibold ${
                isSubmitting
                  ? "bg-slate-300 cursor-not-allowed text-slate-600"
                  : "bg-emerald-500 hover:bg-emerald-600 text-white"
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

      {/* 🟢 MODAL DE ÉXITO */}
      {successModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm text-center space-y-4">
            <h2 className="text-xl font-semibold text-emerald-600">
              Entrega agendada
            </h2>
            <p className="text-sm text-slate-600">{successText}</p>

            {successBooking && (
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-left text-sm text-slate-700">
                <p className="text-xs uppercase text-slate-400 mb-1">
                  Detalles de tu entrega
                </p>
                <p>
                  <span className="font-medium">Tipo:</span>{" "}
                  {successBooking.type === "bodega"
                    ? "Entrega en bodega"
                    : successBooking.type === "domicilio"
                    ? "Entrega a domicilio"
                    : "Paquetería"}
                </p>
                {successBooking.instagram && (
                  <p>
                    <span className="font-medium">Instagram:</span>{" "}
                    {successBooking.instagram}
                  </p>
                )}
                {successBooking.fullName && (
                  <p>
                    <span className="font-medium">Cliente:</span>{" "}
                    {successBooking.fullName}
                  </p>
                )}
                {successBooking.phone && (
                  <p>
                    <span className="font-medium">Teléfono:</span>{" "}
                    {successBooking.phone}
                  </p>
                )}
                {successBooking.address && (
                  <p>
                    <span className="font-medium">Dirección:</span>{" "}
                    {successBooking.address}
                  </p>
                )}
                {successBooking.city && (
                  <p>
                    <span className="font-medium">Ciudad:</span>{" "}
                    {successBooking.city}
                  </p>
                )}
                {successBooking.state && (
                  <p>
                    <span className="font-medium">Estado:</span>{" "}
                    {successBooking.state}
                  </p>
                )}
                {successBooking.postalCode && (
                  <p>
                    <span className="font-medium">C.P.:</span>{" "}
                    {successBooking.postalCode}
                  </p>
                )}
                {successBooking.notes && (
                  <p>
                    <span className="font-medium">Notas:</span>{" "}
                    {successBooking.notes}
                  </p>
                )}
                {successBooking.date && (
                  <p>
                    <span className="font-medium">Fecha:</span>{" "}
                    {formatDateStringMX(successBooking.date)}
                  </p>
                )}
                {successBooking.price && (
                  <p>
                    <span className="font-medium">Costo envío:</span>{" "}
                    ${successBooking.price} MXN
                  </p>
                )}
              </div>
            )}

            <button
              onClick={() => {
                setSuccessModal(false);
                router.push("/");
              }}
              className="bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg w-full text-sm font-semibold"
            >
              Aceptar
            </button>
            <p className="text-[10px] text-slate-400">
              Puedes tomar captura de pantalla de estos datos 📸
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

















