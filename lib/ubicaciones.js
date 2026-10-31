import { supabaseAdmin as supabase } from "./supabaseAdmin";

const CAJAS_POR_CLIENTA = 2;

export async function estanEnBodega() {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "en_bodega").maybeSingle();
  // Si el ajuste no existe, se asume que sí: no inventar trabajo pendiente
  return data?.value !== "false";
}

// Fuera de la bodega no se puede tomar el producto ni meterlo a la caja, así que
// la venta deja anotado el movimiento físico para hacerlo al llegar.
export async function anotarEnBitacora({ saleId, clientId }) {
  // El resumen se arma desde la base: lo que manda el POS trae ids, no nombres
  const { data: items } = await supabase
    .from("sale_items")
    .select("quantity, products ( name )")
    .eq("sale_id", saleId);

  const resumen = (items || [])
    .map((i) => `${i.quantity}x ${i.products?.name || "producto"}`)
    .join(", ");

  const { error } = await supabase
    .from("bitacora_tareas")
    .insert([{ sale_id: saleId, client_id: clientId || null, productos: resumen || null }]);

  // El índice único evita duplicar si el alta se reintenta; ese choque no es un error
  if (error && error.code !== "23505") throw error;
}

async function totalCajas() {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "cajas_total").maybeSingle();
  return Number(data?.value) || 120;
}

// Qué tiene guardado una clienta ahora mismo, agrupado por lugar.
export async function loQueTieneGuardado(clientId) {
  const { data: ventas } = await supabase
    .from("sales")
    .select("id, created_at, ubicacion, caja, sale_items ( id, quantity, delivery_status, products ( name ) )")
    .eq("client_id", clientId)
    .not("status", "in", '("cancelled","pending_payment")')
    .order("created_at", { ascending: false });

  const lugares = [];
  for (const v of ventas || []) {
    const pendientes = (v.sale_items || []).filter((i) => i.delivery_status !== "delivered");
    if (pendientes.length === 0 || !v.ubicacion) continue;
    lugares.push({
      saleId: v.id,
      ubicacion: v.ubicacion,
      caja: v.caja,
      compradoEl: v.created_at,
      productos: pendientes.map((i) => ({
        nombre: i.products?.name || "producto",
        cantidad: i.quantity,
      })),
    });
  }

  // Cajas de antes de que existiera la ubicación por compra: se sabe la caja pero no
  // qué hay dentro. Sin esto la ficha se vería vacía para casi todas las clientas.
  const { data: cliente } = await supabase
    .from("clients").select("box_1, box_2").eq("id", clientId).single();

  const yaListadas = new Set(lugares.filter((l) => l.ubicacion === "caja").map((l) => Number(l.caja)));
  for (const b of [cliente?.box_1, cliente?.box_2]) {
    if (b == null || !/^\d+$/.test(String(b).trim())) continue;
    const n = Number(b);
    if (yaListadas.has(n)) continue;
    lugares.push({ saleId: null, ubicacion: "caja", caja: n, sinDetalle: true, productos: [] });
  }

  return lugares;
}

// Las cajas libres, de la más baja a la más alta. Se consulta lo que hay guardado,
// no clients.box_1/box_2, para que la ocupación salga de un solo lugar.
export async function cajasLibres(limite = 10) {
  const total = await totalCajas();
  const ocupadas = new Set();

  // Hay que paginar: Supabase corta en 1000 filas y hay más clientas que eso.
  // Sin esto, las cajas de las últimas clientas parecían libres y se asignaban
  // dos veces, metiendo productos de dos personas en la misma caja.
  const PAGINA = 1000;

  for (let desde = 0; ; desde += PAGINA) {
    const { data } = await supabase
      .from("clients").select("box_1, box_2").range(desde, desde + PAGINA - 1);
    if (!data || data.length === 0) break;
    for (const c of data) {
      for (const b of [c.box_1, c.box_2]) {
        if (b != null && /^\d+$/.test(String(b).trim())) ocupadas.add(Number(b));
      }
    }
    if (data.length < PAGINA) break;
  }

  for (let desde = 0; ; desde += PAGINA) {
    const { data } = await supabase
      .from("sales").select("caja").eq("ubicacion", "caja").not("caja", "is", null)
      .range(desde, desde + PAGINA - 1);
    if (!data || data.length === 0) break;
    for (const v of data) ocupadas.add(Number(v.caja));
    if (data.length < PAGINA) break;
  }

  const libres = [];
  for (let n = 1; n <= total && libres.length < limite; n++) {
    if (!ocupadas.has(n)) libres.push(n);
  }
  return { libres, ocupadas: ocupadas.size, total };
}

// Qué se le propone al cobrar. Las reglas, en orden.
export async function proponerUbicacion(clientId, cantidadProductos) {
  const { libres, ocupadas, total } = await cajasLibres();

  if (!clientId) {
    return { tipo: "ninguna", motivo: "Venta sin cliente asignado", libres, ocupadas, total, guardado: [] };
  }

  const guardado = await loQueTieneGuardado(clientId);
  const cajasDeLaClienta = [...new Set(guardado.filter((g) => g.ubicacion === "caja").map((g) => g.caja))];

  // 1. Ya tiene caja: se reutiliza y se junta ahí lo que esté en estante
  if (cajasDeLaClienta.length > 0) {
    const caja = Math.min(...cajasDeLaClienta);
    return {
      tipo: "juntar",
      caja,
      aMover: guardado.filter((g) => g.ubicacion === "estante").map((g) => g.saleId),
      motivo: `Ya tiene la caja ${caja}`,
      libres, ocupadas, total, guardado,
    };
  }

  // 4. Dos cajas llenas, o no quedan cajas libres
  if (cajasDeLaClienta.length >= CAJAS_POR_CLIENTA || libres.length === 0) {
    return {
      tipo: "estante",
      motivo: libres.length === 0 ? "No quedan cajas libres" : "Ya tiene sus dos cajas",
      libres, ocupadas, total, guardado,
    };
  }

  // 1b. Tiene cosas pero solo en estante: se juntan en una caja nueva
  if (guardado.length > 0) {
    return {
      tipo: "caja",
      caja: libres[0],
      aMover: guardado.map((g) => g.saleId),
      motivo: "Tiene cosas en estante: conviene juntarlas en una caja",
      libres, ocupadas, total, guardado,
    };
  }

  // 2. Nada guardado y un solo producto: no vale la pena quemar una caja
  if (cantidadProductos <= 1) {
    return { tipo: "estante", motivo: "Un solo producto", libres, ocupadas, total, guardado };
  }

  // 3. Nada guardado y varios productos
  return { tipo: "caja", caja: libres[0], motivo: "Varios productos", libres, ocupadas, total, guardado };
}

// Aplica la ubicación elegida a la venta nueva, y arrastra lo anterior si se juntó.
export async function guardarUbicacion({ saleId, tipo, caja, aMover = [] }) {
  if (tipo !== "caja" && tipo !== "estante") return;

  const destino = tipo === "caja"
    ? { ubicacion: "caja", caja: Number(caja) }
    : { ubicacion: "estante", caja: null };

  const ids = [saleId, ...aMover.filter(Boolean)];
  await supabase.from("sales").update(destino).in("id", ids);

  // clients.box_1/box_2 sigue siendo lo que leen las pantallas de clientes y el POS
  const { data: venta } = await supabase.from("sales").select("client_id").eq("id", saleId).single();
  if (venta?.client_id) await sincronizarCajasDelCliente(venta.client_id);
}

// Deja box_1 y box_2 reflejando las cajas que la clienta ocupa de verdad.
export async function sincronizarCajasDelCliente(clientId) {
  const guardado = await loQueTieneGuardado(clientId);
  const cajas = [...new Set(guardado.filter((g) => g.ubicacion === "caja").map((g) => Number(g.caja)))]
    .sort((a, b) => a - b)
    .slice(0, CAJAS_POR_CLIENTA);

  await supabase
    .from("clients")
    .update({
      box_1: cajas[0] != null ? String(cajas[0]) : null,
      box_2: cajas[1] != null ? String(cajas[1]) : null,
    })
    .eq("id", clientId);
}

// Una clienta deja de ocupar su lugar solo cuando ya no le queda nada guardado:
// ni entregas agendadas, ni productos comprados que todavía no se entregan.
export async function liberarSiYaNoQuedaNada(clientId) {
  const { data: cliente } = await supabase
    .from("clients")
    .select("id, instagram")
    .eq("id", clientId)
    .single();
  if (!cliente) return false;

  const { data: ventas } = await supabase
    .from("sales")
    .select("id")
    .eq("client_id", clientId)
    .not("status", "in", '("cancelled","pending_payment")');

  const ids = (ventas || []).map((v) => v.id);
  let productosPendientes = 0;
  if (ids.length > 0) {
    const { count } = await supabase
      .from("sale_items")
      .select("id", { count: "exact", head: true })
      .in("sale_id", ids)
      .or("delivery_status.neq.delivered,delivery_status.is.null");
    productosPendientes = count || 0;
  }

  let entregasPendientes = 0;
  if (cliente.instagram) {
    const ig = cliente.instagram.replace(/^@/, "");
    const { count } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .or(`instagram.ilike.${ig},instagram.ilike.@${ig}`)
      .or("delivery_status.eq.pendiente,delivery_status.is.null");
    entregasPendientes = count || 0;
  }

  if (productosPendientes > 0 || entregasPendientes > 0) return false;

  await supabase.from("clients").update({ box_1: null, box_2: null }).eq("id", clientId);
  if (ids.length > 0) {
    await supabase
      .from("sales")
      .update({ ubicacion: null, caja: null })
      .in("id", ids)
      .not("ubicacion", "is", null);
  }
  return true;
}

// Una venta a crédito cuyos productos ya salieron todos queda liquidada, igual que
// cuando se marca la entrega desde el panel de entregas.
export async function liquidarSiYaSalioTodo(saleId) {
  const { data: venta } = await supabase
    .from("sales")
    .select("id, total, status")
    .eq("id", saleId)
    .single();
  if (!venta || venta.status !== "credit") return false;

  const { count } = await supabase
    .from("sale_items")
    .select("id", { count: "exact", head: true })
    .eq("sale_id", saleId)
    .or("delivery_status.neq.delivered,delivery_status.is.null");

  if ((count || 0) > 0) return false;

  await supabase
    .from("sales")
    .update({ status: "paid", down_payment: venta.total })
    .eq("id", saleId);
  return true;
}
