// /app/api/bookings/route.js (o como lo tengas)
let BOOKINGS = [];
let SLOTS = {
  tuesday: { used: 0, capacity: 12, disabled: false },
  thursday: { used: 0, capacity: 12, disabled: false },
};

// 🟢 GET → obtener todas las agendas y los cupos
export async function GET() {
  return Response.json({ bookings: BOOKINGS, slots: SLOTS });
}

// 🟢 POST → registrar una nueva agenda
export async function POST(req) {
  try {
    const body = await req.json();
    const {
      type,
      day,
      date,
      instagram,
      fullName,
      phone,
      address,
      city,
      override,
    } = body;

    // validaciones básicas
    if (!type || !instagram || !fullName || !phone || !date) {
      return Response.json(
        { message: "Faltan campos obligatorios." },
        { status: 400 }
      );
    }

    // 🔹 Si viene con override, omitimos casi todas las validaciones
    if (override) {
      const newBooking = {
        id: Date.now(),
        type,
        day: day || null,
        date,
        instagram,
        fullName,
        phone,
        address: address || null,
        city: city || null,
        createdAt: new Date().toISOString(),
        override: true,
        // si es paquetería lo dejamos pendiente
        status: type === "paqueteria" ? "pending" : null,
      };
      BOOKINGS.push(newBooking);
      return Response.json({
        message: "Entrega manual registrada (override).",
        booking: newBooking,
      });
    }

    // 🔸 Validaciones normales (NO para paquetería)
    const now = new Date();
    const selectedDate = new Date(date);
    const diffHours = (selectedDate - now) / (1000 * 60 * 60);

    // paquetería no necesita las 24h, las otras sí
    if (type !== "paqueteria" && diffHours < 24) {
      return Response.json(
        { message: "Debes agendar con al menos 24 horas de anticipación." },
        { status: 400 }
      );
    }

    // 🟣 Validar bodega (tuesday / thursday) — tú dijiste que bodega no tenga límite,
    // así que aquí solo respetamos disabled, no el capacity
    if (type === "bodega") {
      if (!day || (day !== "tuesday" && day !== "thursday")) {
        return Response.json(
          { message: "Día de bodega inválido." },
          { status: 400 }
        );
      }

      const slot = SLOTS[day];
      if (slot.disabled) {
        return Response.json(
          { message: "Las entregas están deshabilitadas este día." },
          { status: 400 }
        );
      }

      // ❗ si quisieras volver a poner límite, aquí va:
      // if (slot.used >= slot.capacity) { ... }

      // aunque no haya límite, podemos seguir contando
      slot.used += 1;
    }

    // 🟣 Validar domicilio (el límite de 15 lo estás haciendo en el front,
    // pero igual podrías validarlo aquí más adelante)
    // Por ahora dejamos que pase

    const newBooking = {
      id: Date.now(),
      type,
      day: day || null,
      date,
      instagram,
      fullName,
      phone,
      address: address || null,
      city: city || null,
      createdAt: new Date().toISOString(),
      override: false,
      // solo paquetería tiene status
      status: type === "paqueteria" ? "pending" : null,
    };

    BOOKINGS.push(newBooking);
    return Response.json({
      message: "Entrega registrada correctamente.",
      booking: newBooking,
    });
  } catch (err) {
    console.error(err);
    return Response.json({ message: "Error en el servidor." }, { status: 500 });
  }
}

// 🟠 PATCH → actualizar una agenda (ej. paquetería = cotizado)
export async function PATCH(req) {
  try {
    const body = await req.json();
    const { id, status } = body;

    if (!id) {
      return Response.json({ message: "Falta id" }, { status: 400 });
    }

    const idx = BOOKINGS.findIndex((b) => String(b.id) === String(id));
    if (idx === -1) {
      return Response.json({ message: "No existe esa agenda." }, { status: 404 });
    }

    // solo actualizamos lo que nos manden
    if (typeof status !== "undefined") {
      BOOKINGS[idx].status = status;
    }

    return Response.json({
      message: "Agenda actualizada.",
      booking: BOOKINGS[idx],
    });
  } catch (err) {
    console.error(err);
    return Response.json({ message: "Error en el servidor." }, { status: 500 });
  }
}

// 🟠 DELETE → eliminar una agenda por id
export async function DELETE(req) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ message: "Falta id" }, { status: 400 });
  }

  const index = BOOKINGS.findIndex((b) => String(b.id) === String(id));
  if (index === -1) {
    return Response.json({ message: "No existe esa agenda." }, { status: 404 });
  }

  const bookingToDelete = BOOKINGS[index];

  // si era bodega, liberar conteo
  if (
    bookingToDelete.type === "bodega" &&
    bookingToDelete.day &&
    (bookingToDelete.day === "tuesday" || bookingToDelete.day === "thursday")
  ) {
    const slot = SLOTS[bookingToDelete.day];
    if (slot && slot.used > 0) slot.used -= 1;
  }

  BOOKINGS.splice(index, 1);

  return Response.json({
    message: "Entrega eliminada correctamente.",
    deleted: bookingToDelete,
  });
}






