import { supabaseAdmin as supabase } from "./supabaseAdmin";
import { cajasDeTexto, cajasATexto } from "./constants";

// No hay tope de cajas por clienta: si ocupa tres, se le recuerdan las tres. El que
// había no limitaba nada, solo recortaba la ficha y hacía perder la última.

export async function estanEnBodega() {
  const { data } = await supabase
    .from("app_settings").select("value").eq("key", "en_bodega").maybeSingle();
  // Si el ajuste no existe, se asume que sí: no inventar trabajo pendiente
  return data?.value !== "false";
}

// Fuera de la bodega no se puede tomar el producto ni meterlo a la caja, así que
// la venta deja anotado el movimiento físico para hacerlo al llegar.
export async function anotarEnBitacora({ saleId, clientId }) {
  // Una venta de mostrador se la lleva puesta quien la compró: no hay nada que guardar
  // ni nombre con el cual etiquetar una caja, así que no se anota.
  if (!clientId) return;

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
    .insert([{ sale_id: saleId, client_id: clientId, productos: resumen || null }]);

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
  for (const n of cajasDeTexto(cliente?.box_1, cliente?.box_2)) {
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
      for (const n of cajasDeTexto(c.box_1, c.box_2)) ocupadas.add(n);
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

  // 4. No quedan cajas libres.
  // Aquí había además un tope de cajas por clienta, pero era letra muerta: la regla 1
  // ya regresó si tiene aunque sea una, así que nunca se alcanzaba. Lo único que de
  // verdad aplicaba el tope era el recorte al sincronizar, y ese no impedía la tercera
  // caja: la borraba de la ficha después, perdiendo dónde quedó la mercancía.
  if (libres.length === 0) {
    return {
      tipo: "estante",
      motivo: "No quedan cajas libres",
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

// ¿Le queda mercancía pendiente de la que no se sabe dónde está? Mientras la haya, una
// caja anotada en la ficha puede ser justo donde está guardada, y no se puede soltar.
async function quedaAlgoSinUbicar(clientId) {
  const { data: ventas } = await supabase
    .from("sales")
    .select("id, sale_items ( delivery_status )")
    .eq("client_id", clientId)
    .is("ubicacion", null)
    .not("status", "in", '("cancelled","pending_payment")');

  return (ventas || []).some((v) =>
    (v.sale_items || []).some((i) => i.delivery_status !== "delivered")
  );
}

// Deja box_1 y box_2 reflejando las cajas que la clienta ocupa de verdad.
export async function sincronizarCajasDelCliente(clientId) {
  const guardado = await loQueTieneGuardado(clientId);

  // Las cajas donde hay una venta metida: de esas consta qué tienen dentro.
  const deVentas = guardado
    .filter((g) => g.ubicacion === "caja" && g.saleId)
    .map((g) => Number(g.caja));

  // Las que solo salen de la ficha no prueban nada: loQueTieneGuardado las arma a
  // partir de box_1/box_2, así que contarlas aquí hacía que la ficha se confirmara a
  // sí misma y la caja no se liberara nunca, ni vaciándola. Se conservan solo mientras
  // quede mercancía sin ubicar que pudiera ser la que está ahí.
  const deLaFicha = (await quedaAlgoSinUbicar(clientId))
    ? guardado.filter((g) => g.ubicacion === "caja" && !g.saleId).map((g) => Number(g.caja))
    : [];

  // Sin recortar: aquí se recortaba al tope de cajas, y una clienta con tres acababa
  // perdiendo una de la ficha sin que nadie se enterara de dónde quedó su mercancía.
  // El tope decide cuándo dejar de llenarle cajas, no cuántas se le pueden recordar.
  const cajas = [...new Set([...deVentas, ...deLaFicha])].sort((a, b) => a - b);

  await supabase
    .from("clients")
    // Todas van al primer campo. El segundo se sigue leyendo por las fichas viejas,
    // pero tener la lista en un solo lugar evita que una caja se pierda al repartirla.
    .update({ box_1: cajasATexto(cajas), box_2: null })
    .eq("id", clientId);
}

// Quién tiene cada una de estas cajas, para avisar antes de asignarla dos veces.
// Se comparan números ya interpretados y no texto: preguntando por igualdad exacta, el
// campo "19, 42" no coincidía con "19" y el choque pasaba de largo, así que la misma
// caja podía quedar a nombre de dos clientas y su mercancía acabar revuelta.
export async function duenosDeCajas(numeros, exceptoClientId = null) {
  const buscadas = new Set(numeros);
  if (buscadas.size === 0) return new Map();

  const encontrados = new Map();
  const PAGINA = 1000;
  for (let desde = 0; ; desde += PAGINA) {
    const { data } = await supabase
      .from("clients")
      .select("id, name, instagram, box_1, box_2")
      .range(desde, desde + PAGINA - 1);
    if (!data || data.length === 0) break;
    for (const c of data) {
      if (exceptoClientId && c.id === exceptoClientId) continue;
      for (const n of cajasDeTexto(c.box_1, c.box_2)) {
        if (buscadas.has(n) && !encontrados.has(n)) encontrados.set(n, c);
      }
    }
    if (data.length < PAGINA) break;
  }
  return encontrados;
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
