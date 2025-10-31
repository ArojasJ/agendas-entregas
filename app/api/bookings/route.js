// app/api/bookings/route.js
import { supabase } from "@/lib/supabaseClient";

// 🔐 helper para validar token del panel
function validatePanelToken(req) {
  const headerToken = req.headers.get("x-panel-token");
  const secret = process.env.PANEL_TOKEN_SECRET || "agenda_super_secreta_123";

  if (!headerToken) return false;

  try {
    const decoded = Buffer.from(headerToken, "base64").toString("utf8");
    const [json, sig] = decoded.split("|");

    if (sig !== secret) return false;

    return true;
  } catch (err) {
    console.error("Error al validar token:", err);
    return false;
  }
}

// máximo de domicilios por día
const DOMICILIO_LIMIT = 15;

// slots fijos solo para la UI (no vienen de la DB aún)
let SLOTS = {
  tuesday: { used: 0, capacity: 12, disabled: false },
  thursday: { used: 0, capacity: 12, disabled: false },
};

// 🟢 GET → obtener todas las agendas y los slots
export async function GET(req) {
  // 🔒 solo el panel puede leer
  if (!validatePanelToken(req)) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .order("createdAt", { ascending: false });

  if (error) {
    console.error(error);
    return Response.json(
      { message: "Error al leer", bookings: [], slots: SLOTS },
      { status: 500 }
    );
  }

  return Response.json({ bookings: data || [], slots: SLOTS });
}

// 🟢 POST → crear agenda
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
      state,
      notes,      // 👈 nuevo
      override,
    } = body;

    if (!type || !instagram || !fullName || !phone || !date) {
      return Response.json(
        { message: "Faltan campos obligatorios." },
        { status: 400 }
      );
    }

    // 🔸 si viene con override (desde panel), lo guardamos directo PERO pidiendo token
    if (override) {
      if (!validatePanelToken(req)) {
        return Response.json({ message: "No autorizado" }, { status: 401 });
      }

      const { data, error } = await supabase
        .from("bookings")
        .insert([
          {
            type,
            day: day || null,
            date,
            instagram,
            fullName,
            phone,
            address: address || null,
            city: city || null,
            state: state || null,
            notes: notes || null, // 👈 lo guardamos
            override: true,
            status: type === "paqueteria" ? "pendiente" : null,
            createdAt: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (error) {
        console.error(error);
        return Response.json(
          { message: "No se pudo registrar." },
          { status: 500 }
        );
      }

      return Response.json({
        message: "Entrega manual registrada (override).",
        booking: data,
      });
    }

    // 🔸 validaciones normales (24h) → pero NO para paquetería
    if (type !== "paqueteria") {
      const now = new Date();
      const selectedDate = new Date(date);
      const diffHours = (selectedDate - now) / (1000 * 60 * 60);
      if (diffHours < 24) {
        return Response.json(
          { message: "Debes agendar con al menos 24 horas de anticipación." },
          { status: 400 }
        );
      }
    }

    // 🟣 BODEGA
    if (type === "bodega") {
      if (!day || (day !== "tuesday" && day !== "thursday")) {
        return Response.json(
          { message: "Día de bodega inválido." },
          { status: 400 }
        );
      }
      // aquí después puedes validar capacidad
    }

    // 🟣 DOMICILIO → validar máximo por día (solo cuando NO es override)
    if (type === "domicilio") {
      const { data: domicilios, error: errCount } = await supabase
        .from("bookings")
        .select("id")
        .eq("type", "domicilio")
        .eq("date", date);

      if (errCount) {
        console.error(errCount);
        return Response.json(
          { message: "No se pudo validar el cupo." },
          { status: 500 }
        );
      }

      if ((domicilios?.length || 0) >= DOMICILIO_LIMIT) {
        return Response.json(
          { message: "Ya no hay entregas disponibles para ese día." },
          { status: 400 }
        );
      }
    }

    // 🟣 PAQUETERÍA
    const isPaqueteria = type === "paqueteria";

    const { data: inserted, error: insertError } = await supabase
      .from("bookings")
      .insert([
        {
          type,
          day: day || null,
          date,
          instagram,
          fullName,
          phone,
          address: address || null,
          city: city || null,
          state: state || null,
          notes: notes || null, // 👈 también aquí
          createdAt: new Date().toISOString(),
          status: isPaqueteria ? "pendiente" : null,
          override: false,
        },
      ])
      .select()
      .single();

    if (insertError) {
      console.error(insertError);
      return Response.json(
        { message: "Error al crear la entrega." },
        { status: 500 }
      );
    }

    return Response.json({
      message: "Entrega registrada correctamente.",
      booking: inserted,
    });
  } catch (err) {
    console.error(err);
    return Response.json({ message: "Error en el servidor." }, { status: 500 });
  }
}

// 🟠 DELETE → eliminar una agenda por id (solo panel)
export async function DELETE(req) {
  // 🔒 solo panel
  if (!validatePanelToken(req)) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) {
    return Response.json({ message: "Falta id" }, { status: 400 });
  }

  const { error } = await supabase.from("bookings").delete().eq("id", id);

  if (error) {
    console.error(error);
    return Response.json({ message: "No se pudo eliminar." }, { status: 500 });
  }

  return Response.json({ message: "Entrega eliminada correctamente." });
}

// 🟣 PATCH → para marcar paquetería como cotizada (solo panel)
export async function PATCH(req) {
  // 🔒 solo panel
  if (!validatePanelToken(req)) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, status } = body;

    if (!id) {
      return Response.json({ message: "Falta id" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("bookings")
      .update({ status })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error(error);
      return Response.json(
        { message: "No se pudo actualizar." },
        { status: 500 }
      );
    }

    return Response.json({ message: "Actualizado.", booking: data });
  } catch (err) {
    console.error(err);
    return Response.json({ message: "Error en el servidor." }, { status: 500 });
  }
}









