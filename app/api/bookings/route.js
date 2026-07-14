// app/api/bookings/route.js — CACHE BUST v2 (23-04-2026 11:35)
import { supabase as supabaseAnon } from "@/lib/supabaseClient";
import { createClient } from "@supabase/supabase-js";

// Creamos un cliente con Service Role para saltar RLS si la llave existe
const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY 
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : supabaseAnon;

// 🔐 helper para validar token del panel
function getPanelSession(req) {
  const headerToken = req.headers.get("x-panel-token");
  const secret = process.env.PANEL_TOKEN_SECRET || "agenda_super_secreta_123";
  if (!headerToken) return null;
  try {
    const decoded = Buffer.from(headerToken, "base64").toString("utf8");
    const [json, sig] = decoded.split("|");
    if (sig !== secret) return null;
    return JSON.parse(json);
  } catch (err) {
    return null;
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

// ✅ slots fijos solo para la UI (no vienen de la DB aún)
// BODEGA ahora es LUNES a VIERNES
let SLOTS = {
  monday: { used: 0, capacity: 12, disabled: false },
  tuesday: { used: 0, capacity: 12, disabled: false },
  wednesday: { used: 0, capacity: 12, disabled: false },
  thursday: { used: 0, capacity: 12, disabled: false },
  friday: { used: 0, capacity: 12, disabled: false },
};

// 🟢 GET → obtener todas las agendas, los slots, los días bloqueados y días extra de bodega
export async function GET(req) {
  // 🔒 solo el panel puede leer
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  // 1) bookings (paginado para superar el límite de 1000 filas de PostgREST)
  const allBookings = [];
  let bFrom = 0;
  const bPage = 500;
  let bookingsError = null;
  while (true) {
    const { data: bData, error: bErr } = await supabase
      .from("bookings")
      .select("*")
      .order("createdAt", { ascending: false })
      .range(bFrom, bFrom + bPage - 1);
    if (bErr) { bookingsError = bErr; break; }
    if (!bData || bData.length === 0) break;
    allBookings.push(...bData);
    if (bData.length < bPage) break;
    bFrom += bPage;
  }
  const bookings = allBookings;
  const error = bookingsError;

  // 2) blocked_days
  const { data: blockedDays, error: blockedErr } = await supabase
    .from("blocked_days")
    .select("*")
    .order("date", { ascending: true });

  // 3) bodega_extra_days
  const { data: extraBodegaDays, error: extraErr } = await supabase
    .from("bodega_extra_days")
    .select("*")
    .order("date", { ascending: true });

  // 4) special_days
  const { data: specialDays } = await supabase
    .from("special_days")
    .select("*")
    .order("date", { ascending: true });

  if (error || blockedErr || extraErr) {
    console.error(error || blockedErr || extraErr);
    return Response.json(
      {
        message: "Error al leer",
        bookings: bookings || [],
        slots: SLOTS,
        blockedDays: blockedDays || [],
        extraBodegaDays: extraBodegaDays || [],
        specialDays: specialDays || [],
      },
      { status: 500 }
    );
  }

  return Response.json({
    bookings: bookings || [],
    slots: SLOTS,
    blockedDays: blockedDays || [],
    extraBodegaDays: extraBodegaDays || [],
    specialDays: specialDays || [],
  });
}

// 🟢 POST → crear agenda o bloquear día o agregar día extra (según venga)
export async function POST(req) {
  try {
    const body = await req.json();

    // 0️⃣ agregar DÍA ESPECIAL de domicilio (solo panel)
    if (body.action === "add-special-day") {
      const session = getPanelSession(req);
      if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });

      const { date, reason } = body;
      if (!date) return Response.json({ message: "Falta la fecha." }, { status: 400 });

      const { data, error } = await supabase
        .from("special_days")
        .insert([{ date: normalizeDateString(date), reason: reason || null }])
        .select()
        .single();

      if (error) {
        if (error.code === "23505") return Response.json({ message: "Ese día ya está habilitado como día especial." }, { status: 400 });
        return Response.json({ message: "No se pudo agregar el día especial." }, { status: 500 });
      }
      return Response.json({ message: "Día especial agregado.", specialDay: data });
    }

    // 0️⃣ agregar día EXTRA de bodega (solo panel)
    if (body.action === "add-bodega-extra-day") {
      const session = getPanelSession(req);
  if (!session) {
        return Response.json({ message: "No autorizado" }, { status: 401 });
      }

      const { date, reason, start_time, end_time } = body;

      if (!date) {
        return Response.json(
          { message: "Falta la fecha del día extra." },
          { status: 400 }
        );
      }

      if (start_time && end_time && start_time >= end_time) {
        return Response.json(
          { message: "La hora inicial debe ser menor a la hora final." },
          { status: 400 }
        );
      }

      const dateToSave = normalizeDateString(date);

      const { data, error } = await supabase
        .from("bodega_extra_days")
        .insert([
          {
            date: dateToSave,
            reason: reason || null,
            start_time: start_time || null,
            end_time: end_time || null,
          },
        ])
        .select()
        .single();

      if (error) {
        // unique violation
        if (error.code === "23505") {
          return Response.json(
            { message: "Ese día ya está habilitado como bodega." },
            { status: 400 }
          );
        }

        console.error(error);
        return Response.json(
          { message: "No se pudo agregar el día extra." },
          { status: 500 }
        );
      }

      return Response.json({
        message: "Día extra de bodega agregado.",
        extraDay: data,
      });
    }

    // 1️⃣ si viene desde el panel para BLOQUEAR un día
    if (body.action === "block-day") {
      const session = getPanelSession(req);
  if (!session) {
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
      // 🆕 campos nuevos
      products,
      amountDue,
      deliveryStatus,
      paymentMethod,
      sale_item_ids,
      // 🆕 URL de ubicación de Google Maps
      locationUrl,
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
      const { data: blockedForThatDay, error: blockedCheckErr } = await supabase
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
      const session = getPanelSession(req);
  if (!session) {
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
            products: productsToSave,
            amount_due: amountDueToSave,
            delivery_status: deliveryStatusToSave,
            payment_method: paymentMethodToSave,
            delivered_at: deliveredAtToSave,
            location_url: locationUrl || null,
            sale_item_ids: sale_item_ids || []
          },
        ])
        .select()
        .single();

      if (error) {
        console.error(error);
        return Response.json(
          { message: "No se pudo registrar la entrega manual." },
          { status: 500 }
        );
      }

      // --- LÓGICA DE POST-ENTREGA (Vaciado, marcado de items y gestión de deuda) ---
      if (deliveryStatusToSave === "entregado") {
        try {
          const igNorm = instagram ? instagram.trim() : "";
          const igToSearch = igNorm.replace(/^@/, '');
          let sItemIds = sale_item_ids || [];
          if (typeof sItemIds === 'string') { try { sItemIds = JSON.parse(sItemIds); } catch(e) { sItemIds = []; } }

          if (igNorm) {
            // 1. Marcar items por ID
            if (Array.isArray(sItemIds) && sItemIds.length > 0) {
              await supabase.from("sale_items").update({ delivery_status: "delivered" }).in("id", sItemIds);
            } 
            
            // 2. Respaldo por nombre
            if (productsToSave) {
              const { data: client } = await supabase.from("clients").select("id")
                .or(`instagram.ilike.${igToSearch},instagram.ilike.@${igToSearch}`).single();
              if (client) {
                const pLines = productsToSave.split('\n');
                for (const line of pLines) {
                  const match = line.match(/(?:\d+x\s+)?(.+)/i);
                  if (match) {
                    const pName = match[1].trim().toLowerCase();
                    const { data: sales } = await supabase.from("sales").select("id").eq("client_id", client.id);
                    if (sales?.length > 0) {
                      const sIds = sales.map(s => s.id);
                      const { data: items } = await supabase.from("sale_items").select("id, products(name)").in("sale_id", sIds).neq("delivery_status", "delivered");
                      const matched = items?.find(it => it.products?.name?.toLowerCase().trim() === pName);
                      if (matched) await supabase.from("sale_items").update({ delivery_status: "delivered" }).eq("id", matched.id);
                    }
                  }
                }
              }
            }

            // 3. Liquidar deudas
            const { data: clientForDebt } = await supabase.from("clients").select("id")
              .or(`instagram.ilike.${igToSearch},instagram.ilike.@${igToSearch}`).single();
            if (clientForDebt) {
              const { data: activeSales } = await supabase.from("sales").select("id, total").eq("client_id", clientForDebt.id).eq("status", "credit");
              for (const s of activeSales || []) {
                const { data: pItems } = await supabase.from("sale_items").select("id").eq("sale_id", s.id).neq("delivery_status", "delivered");
                if (!pItems || pItems.length === 0) {
                  await supabase.from("sales").update({ status: 'paid', down_payment: s.total }).eq("id", s.id);
                }
              }
            }
          }
        } catch (err) { console.error("Error en post-entrega (POST):", err); }
      }
      // ------------------------------------------------------------------

      return Response.json({
        message: "Entrega manual registrada exitosamente.",
        booking: data,
      });
    }

    // 🔸 validaciones normales de fecha → NO paquetería
    if (type === "bodega" || type === "domicilio") {
      const now = new Date();
      const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
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

    // 🟣 BODEGA → LUN-VIE O día extra en bodega_extra_days
    let dayToSave = day || null;

    if (type === "bodega") {
      const { data: extraDay, error: extraCheckErr } = await supabase
        .from("bodega_extra_days")
        .select("id")
        .eq("date", dateToSave)
        .maybeSingle();

      if (extraCheckErr) {
        console.error(extraCheckErr);
        return Response.json(
          { message: "No se pudo validar el día extra de bodega." },
          { status: 500 }
        );
      }

      const isNormalDay =
        day === "monday" ||
        day === "tuesday" ||
        day === "wednesday" ||
        day === "thursday" ||
        day === "friday";

      const isExtraDay = !!extraDay;

      if (!isNormalDay && !isExtraDay) {
        return Response.json(
          { message: "Ese día no está habilitado para entregas en bodega." },
          { status: 400 }
        );
      }

      // ✅ si es día extra: day = null, si es normal: day = monday..friday
      dayToSave = isExtraDay ? null : day;
    }

    // 🟣 DOMICILIO → validar máximo por día + validar ciudad/estado/CP
    if (type === "domicilio") {
      if (!city || !state || !postalCode) {
        return Response.json(
          {
            message: "Faltan datos de ubicación: ciudad, estado o código postal.",
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
          day: type === "bodega" ? dayToSave : (day || null),
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
          // 🆕 ubicación de Google Maps
          location_url: locationUrl || null,
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

// 🟠 DELETE → eliminar una agenda por id (solo panel) o quitar bloqueo o quitar día extra
export async function DELETE(req) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const blockedId = searchParams.get("blockedId");
  const extraDayId = searchParams.get("extraDayId");
  const specialDayId = searchParams.get("specialDayId");

  if (blockedId) {
    const { error } = await supabase.from("blocked_days").delete().eq("id", blockedId);
    if (error) return Response.json({ message: "No se pudo quitar el bloqueo." }, { status: 500 });
    return Response.json({ message: "Bloqueo eliminado." });
  }

  if (extraDayId) {
    const { error } = await supabase.from("bodega_extra_days").delete().eq("id", extraDayId);
    if (error) return Response.json({ message: "No se pudo quitar el día extra." }, { status: 500 });
    return Response.json({ message: "Día extra de bodega eliminado." });
  }

  if (specialDayId) {
    const { error } = await supabase.from("special_days").delete().eq("id", specialDayId);
    if (error) return Response.json({ message: "No se pudo quitar el día especial." }, { status: 500 });
    return Response.json({ message: "Día especial eliminado." });
  }

  if (!id) {
    return Response.json({ message: "Falta id" }, { status: 400 });
  }

  try {
    // 1. Obtener la entrega antes de borrar para revertir estados si estaba entregada
    const { data: existing } = await supabase.from("bookings").select("*").eq("id", id).single();
    
    if (existing) {
      let sItemIds = existing.sale_item_ids || [];
      if (typeof sItemIds === 'string') { try { sItemIds = JSON.parse(sItemIds); } catch(e) { sItemIds = []; } }
      
      if (existing.delivery_status === 'entregado' && Array.isArray(sItemIds) && sItemIds.length > 0) {
        // Revertir items a pending
        await supabase.from("sale_items").update({ delivery_status: "pending" }).in("id", sItemIds);
        
        // Revertir ventas a credit
        const { data: items } = await supabase.from("sale_items").select("sale_id").in("id", sItemIds);
        const uIds = [...new Set(items?.map(it => it.sale_id) || [])];
        for (const sid of uIds) {
          await supabase.from("sales").update({ status: 'credit' }).eq("id", sid);
        }
      }
    }

    // 2. Borrar la entrega definitivamente
    const { error } = await supabase.from("bookings").delete().eq("id", id);
    if (error) throw error;

    return Response.json({ message: "Entrega eliminada y estados revertidos correctamente." });
  } catch (err) {
    console.error(err);
    return Response.json({ message: "Error al eliminar la entrega." }, { status: 500 });
  }
}

// 🟣 PATCH → reagendar, marcar paquetería como cotizada o actualizar info de entrega
export async function PATCH(req) {
  const session = getPanelSession(req);
  if (!session) {
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
      address,
      city,
      state,
    } = body;

    // 0) ACTUALIZAR DIRECCIÓN
    if (action === "update-address") {
      if (!id) return Response.json({ message: "Falta id" }, { status: 400 });
      const updateData = {};
      if (address !== undefined) updateData.address = address || null;
      if (city !== undefined) updateData.city = city || null;
      if (state !== undefined) updateData.state = state || null;
      const { data, error } = await supabase
        .from("bookings")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();
      if (error) {
        console.error(error);
        return Response.json({ message: "No se pudo actualizar la dirección." }, { status: 500 });
      }
      return Response.json({ booking: data });
    }

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
      const weekday = d.getDay(); // 0 dom, 1 lun, 2 mar, 3 mié, 4 jue, 5 vie...

      const updateData = {
        date: normalizedDate,
      };

      // ✅ BODEGA ahora maneja lunes a viernes
      if (weekday === 1) updateData.day = "monday";
      else if (weekday === 2) updateData.day = "tuesday";
      else if (weekday === 3) updateData.day = "wednesday";
      else if (weekday === 4) updateData.day = "thursday";
      else if (weekday === 5) updateData.day = "friday";
      else updateData.day = null;

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

      // leemos el registro actual para decidir qué hacer con delivered_at y obtener IDs de items
      const { data: existing, error: existingErr } = await supabase
        .from("bookings")
        .select("*")
        .eq("id", id)
        .single();

      if (existingErr) {
        console.error("Error leyendo booking:", existingErr.message, existingErr.code, existingErr.details);
        return Response.json(
          { message: "No se pudo leer la entrega: " + existingErr.message + " (code:" + existingErr.code + ")" },
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

      // lógica de delivered_at
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
        console.error("[UDI-UPDATE-ERR]", error.message, error.code);
        return Response.json(
          { message: "[UDI] Error al guardar booking: " + error.message },
          { status: 500 }
        );
      }

      // --- LÓGICA DE POST-ENTREGA (Vaciado, marcado de items y gestión de deuda) ---
      const igNorm = existing.instagram ? existing.instagram.trim() : "";
      let sItemIds = existing.sale_item_ids || [];
      if (typeof sItemIds === 'string') { try { sItemIds = JSON.parse(sItemIds); } catch(e) { sItemIds = []; } }

      if (finalStatus === "entregado") {
        try {
          const igToSearch = igNorm.replace(/^@/, '');
          if (igNorm) {
            // 1. Vaciar cajas si no hay más pendientes
            const { data: pCount } = await supabase.from("bookings").select("id", { count: 'exact', head: true })
              .eq("instagram", existing.instagram).neq("id", id).or('delivery_status.eq.pendiente,delivery_status.is.null');
            if (!pCount || pCount.length === 0) {
              await supabase.from("clients").update({ box_1: null, box_2: null })
                .or(`instagram.ilike.${igToSearch},instagram.ilike.@${igToSearch}`);
            }

            // 2. Marcar items como 'delivered' (Por ID + Respaldo por nombre)
            let itemsUpdatedCount = 0;
            if (Array.isArray(sItemIds) && sItemIds.length > 0) {
              const { error: updErr } = await supabase.from("sale_items").update({ delivery_status: "delivered" }).in("id", sItemIds);
              if (!updErr) itemsUpdatedCount += sItemIds.length;
            } 
            
            if (existing.products) {
              const { data: client } = await supabase.from("clients").select("id")
                .or(`instagram.ilike.${igToSearch},instagram.ilike.@${igToSearch}`).single();
              if (client) {
                const pLines = existing.products.split('\n');
                for (const line of pLines) {
                  const match = line.match(/(?:\d+x\s+)?(.+)/i);
                  if (match) {
                    const pName = match[1].trim().toLowerCase();
                    // Buscamos en todas las ventas de este cliente que estén pendientes
                    const { data: sales } = await supabase.from("sales").select("id").eq("client_id", client.id);
                    if (sales?.length > 0) {
                      const sIds = sales.map(s => s.id);
                      const { data: items } = await supabase.from("sale_items").select("id, products(name)").in("sale_id", sIds).neq("delivery_status", "delivered");
                      // Buscamos coincidencia exacta de nombre
                      const matchedItems = items?.filter(it => it.products?.name?.toLowerCase().trim() === pName) || [];
                      for (const m of matchedItems) {
                        const { error: updErr } = await supabase.from("sale_items").update({ delivery_status: "delivered" }).eq("id", m.id);
                        if (!updErr) itemsUpdatedCount++;
                      }
                    }
                  }
                }
              }
            }

            // 3. Liquidar deudas de las ventas involucradas
            const { data: cDebt } = await supabase.from("clients").select("id")
              .or(`instagram.ilike.${igToSearch},instagram.ilike.@${igToSearch}`).single();
            if (cDebt) {
              const { data: activeS } = await supabase.from("sales").select("id, total").eq("client_id", cDebt.id).eq("status", "credit");
              for (const s of activeS || []) {
                const { data: pending } = await supabase.from("sale_items").select("id").eq("sale_id", s.id).neq("delivery_status", "delivered");
                if (!pending || pending.length === 0) {
                  await supabase.from("sales").update({ status: 'paid', down_payment: s.total }).eq("id", s.id);
                }
              }
            }
            
            return Response.json({
              message: `Entrega actualizada. Se marcaron ${itemsUpdatedCount} productos como entregados.`,
              booking: data,
            });
          }
        } catch (err) { console.error("Error entregando:", err); }
      } else if (finalStatus === "pendiente" || !finalStatus) {
        // REVERSIÓN: Si vuelve a pendiente, regresar items a pending y venta a credit
        try {
          if (Array.isArray(sItemIds) && sItemIds.length > 0) {
            await supabase.from("sale_items").update({ delivery_status: "pending" }).in("id", sItemIds);
            const { data: items } = await supabase.from("sale_items").select("sale_id").in("id", sItemIds);
            const uIds = [...new Set(items?.map(it => it.sale_id) || [])];
            for (const sid of uIds) { await supabase.from("sales").update({ status: 'credit' }).eq("id", sid); }
          }
        } catch (err) { console.error("Error revirtiendo:", err); }
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
      console.error("[GENERIC-PATCH-ERR]", error.message, error.code);
      return Response.json(
        { message: "[GENERIC] Error paquetería: " + error.message },
        { status: 500 }
      );
    }

    return Response.json({ message: "Actualizado.", booking: data });
  } catch (err) {
    console.error(err);
    return Response.json({ message: "Error en el servidor." }, { status: 500 });
  }
}






















