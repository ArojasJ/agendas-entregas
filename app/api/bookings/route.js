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

// 👉 helper para asegurarnos de que la fecha venga en formato YYYY-MM-DD
function normalizeDateString(date) {
  if (!date) return null;
  const base = date.split("T")[0];
  return base;
}

// 👉 helper para crear Date local a partir de YYYY-MM-DD (para comparaciones)
function makeLocalDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// máximo de domicilios por día
const DOMICILIO_LIMIT = 15;

// slots fijos solo para la UI (no vienen de la DB aún)
let SLOTS = {
  tuesday: { used: 0, capacity: 12, disabled: false },
  thursday: { used: 0, capacity: 12, disabled: false },
};

// 🟢 GET → obtener todas las agendas, los slots y los días bloqueados
export async function GET(req) {
  // 🔒 solo el panel puede leer
  if (!validatePanelToken(req)) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  // 1) bookings
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("*")
    .order("createdAt", { ascending: false });

  // 2) blocked_days
  const { data: blockedDays, error: blockedErr } = await supabase
    .from("blocked_days")
    .select("*")
    .order("date", { ascending: true });

  if (error || blockedErr) {
    console.error(error || blockedErr);
    return Response.json(
      {
        message: "Error al leer",
        bookings: bookings || [],
        slots: SLOTS,
        blockedDays: blockedDays || [],
      },
      { status: 500 }
    );
  }

  return Response.json({
    bookings: bookings || [],
    slots: SLOTS,
    blockedDays: blockedDays || [],
  });
}

// 🟢 POST → crear agenda o bloquear día (según venga)
export async function POST(req) {
  try {
    const body = await req.json();

    // 1️⃣ si viene desde el panel para BLOQUEAR un día
    if (body.action === "block-day") {
      if (!validatePanelToken(req)) {
        return Response.json({ message: "No autorizado" }, { status: 401 });
      }

      const { date, type, reason } = body;
      if (!date || !type) {
        return Response.json(
          { message: "Faltan date o type." },
          { status: 400 }
        );
      }

      const dateToSave = normalizeDateString(date);

      const { data, error } = await supabase
        .from("blocked_days")
        .insert([
          {
            date: dateToSave,
            type,
            reason: reason || null,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error(error);
        return Response.json(
          { message: "No se pudo bloquear el día." },
          { status: 500 }
        );
      }

      return Response.json({ message: "Día bloqueado.", blocked: data });
    }

    // 2️⃣ flujo normal de crear booking
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
      notes,
      override,
      postalCode,
      // 🆕 campos nuevos (pueden venir vacíos)
      products,
      amountDue,
      deliveryStatus,
      paymentMethod,
    } = body;

    if (!type || !instagram || !fullName || !phone || !date) {
      return Response.json(
        { message: "Faltan campos obligatorios." },
        { status: 400 }
      );
    }

    const dateToSave = normalizeDateString(date);

    // valores por defecto para los nuevos campos
    const productsToSave = products || null;
    const amountDueNumber = Number(
      amountDue !== undefined && amountDue !== null ? amountDue : 0
    );
    const amountDueToSave = isNaN(amountDueNumber) ? 0 : amountDueNumber;
    const deliveryStatusToSave = (deliveryStatus || "pendiente").toLowerCase();
    const paymentMethodToSave = (paymentMethod || "efectivo").toLowerCase();

    // calculamos delivered_at inicial (solo si ya está entregado en efectivo desde la creación)
    let deliveredAtToSave = null;
    if (
      deliveryStatusToSave === "entregado" &&
      paymentMethodToSave === "efectivo"
    ) {
      deliveredAtToSave = new Date().toISOString();
    }

    // 🆕 2.a) si NO es override y es bodega o domicilio → checamos si está bloqueado
    if (!override && (type === "bodega" || type === "domicilio")) {
      const { data: blockedForThatDay, error: blockedCheckErr } =
        await supabase
          .from("blocked_days")
          .select("id")
          .eq("date", dateToSave)
          .eq("type", type);

      if (blockedCheckErr) {
        console.error(blockedCheckErr);
        return Response.json(
          { message: "No se pudo validar disponibilidad." },
          { status: 500 }
        );
      }

      if (blockedForThatDay && blockedForThatDay.length > 0) {
        return Response.json(
          {
            message:
              "Ese día no estamos entregando ese tipo de servicio. Por favor elige otra fecha.",
          },
          { status: 400 }
        );
      }
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
            date: dateToSave,
            instagram,
            fullName,
            phone,
            address: address || null,
            city: city || null,
            state: state || null,
            notes: notes || null,
            postal_code: postalCode || null,
            override: true,
            status: type === "paqueteria" ? "pendiente" : null,
            createdAt: new Date().toISOString(),
            // 🆕 campos nuevos
            products: productsToSave,
            amount_due: amountDueToSave,
            delivery_status: deliveryStatusToSave,
            payment_method: paymentMethodToSave,
            delivered_at: deliveredAtToSave,
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

    // 🔸 validaciones normales de fecha → NO paquetería
    if (type === "bodega" || type === "domicilio") {
      const now = new Date();
      const todayLocal = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );
      const selectedLocalDate = makeLocalDate(dateToSave);

      if (selectedLocalDate <= todayLocal) {
        return Response.json(
          {
            message:
              "Solo puedes agendar a partir del día siguiente (no mismo día).",
          },
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
    }

    // 🟣 DOMICILIO → validar máximo por día + validar ciudad/estado/CP
    if (type === "domicilio") {
      if (!city || !state || !postalCode) {
        return Response.json(
          {
            message:
              "Faltan datos de ubicación: ciudad, estado o código postal.",
          },
          { status: 400 }
        );
      }

      if (typeof postalCode === "string" && postalCode.trim().length !== 5) {
        return Response.json(
          { message: "El código postal debe tener 5 dígitos." },
          { status: 400 }
        );
      }

      const { data: domicilios, error: errCount } = await supabase
        .from("bookings")
        .select("id")
        .eq("type", "domicilio")
        .eq("date", dateToSave);

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

    const isPaqueteria = type === "paqueteria";

    const { data: inserted, error: insertError } = await supabase
      .from("bookings")
      .insert([
        {
          type,
          day: day || null,
          date: dateToSave,
          instagram,
          fullName,
          phone,
          address: address || null,
          city: city || null,
          state: state || null,
          notes: notes || null,
          postal_code: postalCode || null,
          createdAt: new Date().toISOString(),
          status: isPaqueteria ? "pendiente" : null,
          override: false,
          // 🆕 campos nuevos
          products: productsToSave,
          amount_due: amountDueToSave,
          delivery_status: deliveryStatusToSave,
          payment_method: paymentMethodToSave,
          delivered_at: deliveredAtToSave,
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
  if (!validatePanelToken(req)) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const blockedId = searchParams.get("blockedId");

  if (blockedId) {
    const { error } = await supabase
      .from("blocked_days")
      .delete()
      .eq("id", blockedId);

    if (error) {
      console.error(error);
      return Response.json(
        { message: "No se pudo quitar el bloqueo." },
        { status: 500 }
      );
    }

    return Response.json({ message: "Bloqueo eliminado." });
  }

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

// 🟣 PATCH → reagendar, marcar paquetería como cotizada o actualizar info de entrega
export async function PATCH(req) {
  if (!validatePanelToken(req)) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      id,
      status,
      action,
      date,
      products,
      amountDue,
      deliveryStatus,
      paymentMethod,
    } = body;

    // 1) REAGENDAR
    if (action === "reschedule") {
      if (!id || !date) {
        return Response.json(
          { message: "Falta id o fecha para reagendar." },
          { status: 400 }
        );
      }

      const normalizedDate = normalizeDateString(date);
      const d = makeLocalDate(normalizedDate);
      const weekday = d.getDay(); // 0 dom, 1 lun, 2 mar, 3 mié, 4 jue...

      const updateData = {
        date: normalizedDate,
      };

      if (weekday === 2) {
        updateData.day = "tuesday";
      } else if (weekday === 4) {
        updateData.day = "thursday";
      } else {
        updateData.day = null;
      }

      const { data, error } = await supabase
        .from("bookings")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        console.error(error);
        return Response.json(
          { message: "No se pudo reagendar.", error: error.message },
          { status: 500 }
        );
      }

      return Response.json({ message: "Reagendado.", booking: data });
    }

    // 2) Actualizar info de entrega (productos / adeudo / estado / forma de pago)
    if (action === "update-delivery-info") {
      if (!id) {
        return Response.json({ message: "Falta id" }, { status: 400 });
      }

      // leemos el registro actual para decidir qué hacer con delivered_at
      const { data: existing, error: existingErr } = await supabase
        .from("bookings")
        .select("delivery_status, payment_method, delivered_at")
        .eq("id", id)
        .single();

      if (existingErr) {
        console.error(existingErr);
        return Response.json(
          { message: "No se pudo leer la entrega para actualizar." },
          { status: 500 }
        );
      }

      const updateData = {};

      if (products !== undefined) {
        updateData.products = products || null;
      }

      if (amountDue !== undefined) {
        const num = Number(amountDue);
        updateData.amount_due = isNaN(num) ? 0 : num;
      }

      // estado entrega
      let finalStatus = existing.delivery_status || "pendiente";
      if (deliveryStatus !== undefined) {
        const allowed = ["pendiente", "entregado", "no_entregado"];
        const normalized = String(deliveryStatus).toLowerCase();
        finalStatus = allowed.includes(normalized) ? normalized : "pendiente";
        updateData.delivery_status = finalStatus;
      } else {
        // si no viene en el body, mantenemos el actual
        updateData.delivery_status = finalStatus;
      }

      // forma de pago
      let finalPayment = existing.payment_method || "efectivo";
      if (paymentMethod !== undefined) {
        const allowedPay = ["efectivo", "transferencia"];
        const val = String(paymentMethod).toLowerCase();
        finalPayment = allowedPay.includes(val) ? val : "efectivo";
        updateData.payment_method = finalPayment;
      } else {
        updateData.payment_method = finalPayment;
      }

      // lógica de delivered_at:
      // - si queda ENTREGADO + EFECTIVO:
      //    - si ya tenía delivered_at, lo dejamos igual
      //    - si no tenía, lo ponemos ahora
      // - si no, lo ponemos en null
      let newDeliveredAt = existing.delivered_at || null;

      const isDeliveredCash =
        finalStatus === "entregado" && finalPayment === "efectivo";

      if (isDeliveredCash) {
        if (!existing.delivered_at) {
          newDeliveredAt = new Date().toISOString();
        }
      } else {
        newDeliveredAt = null;
      }

      updateData.delivered_at = newDeliveredAt;

      const { data, error } = await supabase
        .from("bookings")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        console.error(error);
        return Response.json(
          { message: "No se pudo actualizar la info de entrega." },
          { status: 500 }
        );
      }

      return Response.json({
        message: "Información de entrega actualizada.",
        booking: data,
      });
    }

    // 3) marcar paquetería como cotizada
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
















