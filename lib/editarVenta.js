import { supabaseAdmin as supabase } from "./supabaseAdmin";
import { comoNaceElProducto } from "./entregadoPor";

const pesos = (n) => Math.round(Number(n || 0) * 100) / 100;
const llave = (it) => `${it.product_id}|${it.variant_id || ""}`;

export class ErrorDeEdicion extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Corregir una venta en lugar de borrarla y rehacerla. Ajusta solo la diferencia:
// lo que se quita regresa al inventario, lo que se agrega se descuenta, y el dinero
// que sobra o falta se resuelve como lo haya indicado quien cobra.
export async function editarVenta({ saleId, items, discount, resolucion = {}, session }) {
  const { data: venta, error: errVenta } = await supabase
    .from("sales")
    .select("*, sale_items ( *, products ( name ) ), payments ( id, amount, created_at, pos_cut_id )")
    .eq("id", saleId)
    .single();

  if (errVenta || !venta) throw new ErrorDeEdicion("Venta no encontrada", 404);

  // Venta cortada, venta cerrada: ese dinero ya se contó y no se vuelve a tocar.
  if (venta.pos_cut_id) {
    throw new ErrorDeEdicion("Esta venta ya entró a un corte de caja. Las ventas cortadas no se editan.", 409);
  }
  if (venta.status === "cancelled") {
    throw new ErrorDeEdicion("Una venta cancelada no se edita. Primero revierte la cancelación.", 409);
  }
  if (venta.status !== "paid" && venta.status !== "credit") {
    throw new ErrorDeEdicion("Solo se editan ventas pagadas o a crédito.", 409);
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new ErrorDeEdicion("La venta no puede quedarse sin productos. Si ya no va, cancélala.", 400);
  }

  const antes = JSON.parse(JSON.stringify(venta));
  const viejos = venta.sale_items || [];
  const porId = new Map(viejos.map((i) => [i.id, i]));
  const entregados = new Set(viejos.filter((i) => i.delivery_status === "delivered").map((i) => i.id));

  // ── Revisar lo que llega ──
  const limpios = [];
  for (const it of items) {
    const cantidad = Number(it.quantity);
    const precio = Number(it.unit_price);
    if (!it.product_id) throw new ErrorDeEdicion("Un renglón llegó sin producto.", 400);
    if (!Number.isInteger(cantidad) || cantidad < 1) {
      throw new ErrorDeEdicion("Las cantidades tienen que ser números enteros de 1 para arriba.", 400);
    }
    if (!Number.isFinite(precio) || precio < 0) {
      throw new ErrorDeEdicion("Hay un precio que no es válido.", 400);
    }
    if (it.id && !porId.has(it.id)) {
      throw new ErrorDeEdicion("Un renglón de la venta ya no existe. Vuelve a abrir la venta.", 409);
    }
    limpios.push({
      id: it.id || null,
      product_id: it.product_id,
      variant_id: it.variant_id || null,
      quantity: cantidad,
      unit_price: pesos(precio),
    });
  }

  const sobreviven = new Set(limpios.filter((i) => i.id).map((i) => i.id));
  const quitados = viejos.filter((i) => !sobreviven.has(i.id));

  // ── Lo que ya salió por la puerta no se quita del papel ──
  for (const q of quitados) {
    if (entregados.has(q.id)) {
      throw new ErrorDeEdicion(
        `"${q.products?.name || "Un producto"}" ya se entregó: no se puede quitar de la venta. Eso sería una devolución.`,
        409
      );
    }
    const { data: reserva } = await supabase
      .from("bookings")
      .select("id")
      .contains("sale_item_ids", [q.id])
      .limit(1)
      .maybeSingle();
    if (reserva) {
      throw new ErrorDeEdicion(
        `"${q.products?.name || "Un producto"}" está en una entrega agendada: quítalo primero de la entrega.`,
        409
      );
    }
  }
  for (const n of limpios) {
    if (!n.id || !entregados.has(n.id)) continue;
    if (n.quantity < porId.get(n.id).quantity) {
      throw new ErrorDeEdicion(
        `"${porId.get(n.id).products?.name || "Un producto"}" ya se entregó: no se puede bajar la cantidad.`,
        409
      );
    }
  }

  // ── Cuánto inventario hay que mover, por producto ──
  const delta = new Map();
  for (const v of viejos) delta.set(llave(v), (delta.get(llave(v)) || 0) - v.quantity);
  for (const n of limpios) delta.set(llave(n), (delta.get(llave(n)) || 0) + n.quantity);

  for (const [k, d] of delta) {
    if (d <= 0) continue;
    const [productId, variantId] = k.split("|");
    const { data: fila } = variantId
      ? await supabase.from("product_variants").select("stock, name").eq("id", variantId).single()
      : await supabase.from("products").select("stock, name").eq("id", productId).single();
    const disponible = Number(fila?.stock || 0);
    if (disponible < d) {
      throw new ErrorDeEdicion(
        `No alcanzan las existencias de "${fila?.name || "un producto"}": quedan ${disponible} y hacen falta ${d}.`,
        409
      );
    }
  }

  // ── El dinero ──
  const subtotal = pesos(limpios.reduce((s, i) => s + i.unit_price * i.quantity, 0));
  const descuento = pesos(Math.max(0, Number(discount) || 0));
  if (descuento > subtotal) {
    throw new ErrorDeEdicion("El descuento no puede ser mayor que la suma de los productos.", 400);
  }
  const nuevoTotal = pesos(Math.max(0, subtotal - descuento));

  const abonos = [...(venta.payments || [])].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
  const sumaAbonos = pesos(abonos.reduce((s, a) => s + Number(a.amount), 0));

  // Una venta pagada con saldo a favor guarda el total completo pero en down_payment
  // solo el efectivo que entró: el hueco es justamente el saldo que se le descontó al
  // cliente. Sin contarlo, al corregirla el sistema la leería como "falta dinero" y al
  // cobrarlo metería al corte pesos que nunca entraron al cajón.
  const saldoCubierto =
    venta.status === "paid"
      ? Math.max(0, pesos(Number(venta.total) - Number(venta.down_payment || 0) - sumaAbonos))
      : 0;

  const pagadoAntes = pesos(Number(venta.down_payment || 0) + sumaAbonos + saldoCubierto);
  const diferencia = pesos(pagadoAntes - nuevoTotal);

  const cambiosDeVenta = { total: nuevoTotal, discount: descuento };
  const abonosARecortar = [];
  let saldoAcreditado = 0;
  let saldoDevuelto = 0;
  let devuelto = 0;
  let cobrado = 0;

  if (diferencia > 0) {
    // Pagó de más. Se le devuelve en el orden en que entró: primero el efectivo del
    // enganche, luego el de los abonos, y hasta el final el saldo a favor que se le
    // había aplicado, que no es efectivo y por tanto no sale del cajón.
    const tipo = resolucion.tipo === "saldo" ? "saldo" : "devolver";
    let nuevoEnganche = pesos(venta.down_payment);
    let porDevolver = diferencia;

    const delEnganche = Math.min(nuevoEnganche, porDevolver);
    nuevoEnganche = pesos(nuevoEnganche - delEnganche);
    porDevolver = pesos(porDevolver - delEnganche);

    for (const a of abonos) {
      if (porDevolver <= 0) break;
      if (a.pos_cut_id) {
        throw new ErrorDeEdicion(
          "Un abono de esta venta ya entró a un corte de caja. No se puede bajar tanto el total.",
          409
        );
      }
      const quita = Math.min(pesos(Number(a.amount)), porDevolver);
      abonosARecortar.push({ id: a.id, nuevoMonto: pesos(Number(a.amount) - quita) });
      porDevolver = pesos(porDevolver - quita);
    }

    saldoDevuelto = Math.min(saldoCubierto, porDevolver);
    porDevolver = pesos(porDevolver - saldoDevuelto);
    if (porDevolver > 0) {
      throw new ErrorDeEdicion("No se pudo cuadrar lo ya pagado con el total nuevo.", 409);
    }

    const efectivoQueSale = pesos(diferencia - saldoDevuelto);
    cambiosDeVenta.down_payment = nuevoEnganche;
    saldoAcreditado = pesos(saldoDevuelto + (tipo === "saldo" ? efectivoQueSale : 0));
    devuelto = tipo === "saldo" ? 0 : efectivoQueSale;
  } else if (diferencia < 0) {
    // Falta dinero
    const falta = pesos(-diferencia);
    const tipo = resolucion.tipo === "credito" ? "credito" : "cobrar";
    if (tipo === "cobrar") {
      cambiosDeVenta.down_payment = pesos(Number(venta.down_payment || 0) + falta);
      cobrado = falta;
    } else if (!venta.due_date) {
      const d = new Date();
      d.setDate(d.getDate() + 14);
      cambiosDeVenta.due_date = d.toISOString().split("T")[0];
    }
  }

  const abonosDespues = pesos(
    abonos.reduce((s, a) => {
      const recorte = abonosARecortar.find((x) => x.id === a.id);
      return s + (recorte ? recorte.nuevoMonto : Number(a.amount));
    }, 0)
  );
  const engancheDespues =
    cambiosDeVenta.down_payment != null ? cambiosDeVenta.down_payment : pesos(venta.down_payment);
  const pagadoDespues = pesos(engancheDespues + abonosDespues + saldoCubierto - saldoDevuelto);
  cambiosDeVenta.status = pagadoDespues >= nuevoTotal ? "paid" : "credit";

  // ── A partir de aquí se escribe ──
  for (const n of limpios) {
    if (n.id) {
      const v = porId.get(n.id);
      if (v.quantity === n.quantity && pesos(v.unit_price) === n.unit_price) continue;
      const { error } = await supabase
        .from("sale_items")
        .update({ quantity: n.quantity, unit_price: n.unit_price })
        .eq("id", n.id);
      if (error) throw new ErrorDeEdicion("No se pudo guardar un renglón: " + error.message, 500);
    } else {
      const { error } = await supabase.from("sale_items").insert([{
        sale_id: saleId,
        product_id: n.product_id,
        variant_id: n.variant_id,
        quantity: n.quantity,
        unit_price: n.unit_price,
        // Un producto agregado a una venta de mostrador nace entregado igual que los
        // demás: si se le agrega algo a la venta, también se lo llevó.
        ...comoNaceElProducto(venta.client_id, session),
      }]);
      if (error) throw new ErrorDeEdicion("No se pudo agregar un producto: " + error.message, 500);
    }
  }
  if (quitados.length > 0) {
    await supabase.from("sale_items").delete().in("id", quitados.map((q) => q.id));
  }

  for (const [k, d] of delta) {
    if (d === 0) continue;
    const [productId, variantId] = k.split("|");
    const tabla = variantId ? "product_variants" : "products";
    const id = variantId || productId;
    const { data: fila } = await supabase.from(tabla).select("stock").eq("id", id).single();
    if (!fila) continue;
    await supabase.from(tabla).update({ stock: Math.max(0, Number(fila.stock) - d) }).eq("id", id);
  }

  for (const a of abonosARecortar) {
    if (a.nuevoMonto <= 0) await supabase.from("payments").delete().eq("id", a.id);
    else await supabase.from("payments").update({ amount: a.nuevoMonto }).eq("id", a.id);
  }

  const { error: errUpd } = await supabase.from("sales").update(cambiosDeVenta).eq("id", saleId);
  if (errUpd) throw new ErrorDeEdicion("No se pudo guardar la venta: " + errUpd.message, 500);

  if (saldoAcreditado > 0 && venta.client_id) {
    const { data: cliente } = await supabase
      .from("clients").select("saldo_favor").eq("id", venta.client_id).single();
    if (cliente) {
      await supabase
        .from("clients")
        .update({ saldo_favor: pesos(Number(cliente.saldo_favor || 0) + saldoAcreditado) })
        .eq("id", venta.client_id);
    }
  }

  // La tarea de bitácora pendiente dice qué guardar: si cambió la venta, cambió la tarea.
  try {
    const { data: tarea } = await supabase
      .from("bitacora_tareas").select("id, hecha").eq("sale_id", saleId).maybeSingle();
    if (tarea && !tarea.hecha) {
      const { data: frescos } = await supabase
        .from("sale_items").select("quantity, products ( name )").eq("sale_id", saleId);
      const resumen = (frescos || [])
        .map((i) => `${i.quantity}x ${i.products?.name || "producto"}`)
        .join(", ");
      await supabase.from("bitacora_tareas").update({ productos: resumen || null }).eq("id", tarea.id);
    }
  } catch (e) {
    console.error("No se pudo refrescar la tarea de bitácora de la venta " + saleId + ":", e);
  }

  const { data: despues } = await supabase
    .from("sales")
    .select("*, sale_items ( *, products ( name ) ), payments ( id, amount )")
    .eq("id", saleId)
    .single();

  await supabase.from("audit_logs").insert([{
    action: "edit_sale",
    entity_type: "sale",
    entity_id: String(saleId),
    entity_snapshot: { antes, despues, resolucion: { devuelto, saldoAcreditado, cobrado } },
    staff_id: session?.staffId ? String(session.staffId) : null,
    staff_name: session?.displayName || session?.username || null,
    staff_role: session?.role || null,
  }]);

  return {
    ok: true,
    total: nuevoTotal,
    status: cambiosDeVenta.status,
    devuelto,
    saldoAcreditado,
    cobrado,
  };
}
