import { supabaseAdmin as supabase } from "@/lib/supabaseAdmin";
import { cajasDeTexto, cajasATexto } from "@/lib/constants";
import { sincronizarCajasDelCliente } from "@/lib/ubicaciones";

// PREPARACIÓN DE PAQUETES
//
// El paquete ES la entrega. Preparar un paquete es decidir qué productos van adentro,
// y eso resuelve dos cosas que estaban rotas:
//
// 1. Casi ninguna entrega traía los productos ligados (307 de 310), porque la clienta
//    que agenda no siempre tiene cuenta o escribe mal su usuario. La empleada los
//    anotaba a mano, y al marcar entregado el producto nunca se enteraba. Aquí se
//    ligan de verdad.
// 2. La caja se liberaba hasta la entrega, pero físicamente queda libre al armar el
//    paquete. Por eso había 12 cajas vacías que el sistema creía ocupadas.

// Un usuario de Instagram comparable: sin arroba, sin espacios, sin mayúsculas.
export function igLimpio(valor) {
  return String(valor || "").trim().replace(/^@+/, "").toLowerCase();
}

// Qué productos tiene esta clienta esperando, y dónde está cada uno.
export async function productosEsperando(clientId) {
  const { data: ventas } = await supabase
    .from("sales")
    .select(`
      id, created_at, total, down_payment, status, ubicacion, caja,
      payments ( amount ),
      sale_items ( id, quantity, unit_price, delivery_status, paquete_booking_id,
                   products ( name, image_url ) )
    `)
    .eq("client_id", clientId)
    .not("status", "in", '("cancelled","pending_payment")')
    .order("created_at", { ascending: true });

  const productos = [];
  for (const v of ventas || []) {
    const pagado = Number(v.down_payment || 0)
      + (v.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
    const debe = Math.round((Number(v.total || 0) - pagado) * 100) / 100;

    for (const i of v.sale_items || []) {
      if (i.delivery_status === "delivered") continue;
      productos.push({
        itemId: i.id,
        saleId: v.id,
        nombre: i.products?.name || "producto",
        foto: i.products?.image_url || null,
        cantidad: i.quantity,
        compradoEl: v.created_at,
        // Dónde está ahora: en un paquete ya armado, en su caja, en el estante, o
        // sin lugar anotado (la mayoría de lo viejo).
        ubicacion: i.paquete_booking_id ? "paquete" : (v.ubicacion || null),
        caja: i.paquete_booking_id ? null : v.caja,
        enPaqueteId: i.paquete_booking_id || null,
        // Lo que falta por pagar de la compra de la que viene este producto. Sirve
        // para lo que pediste: a veces solo quiere que le entreguen lo liquidado.
        deLaCompra: { total: Number(v.total || 0), pagado, debe, liquidada: debe <= 0 },
      });
    }
  }
  return productos;
}

// A quién se parece esta entrega. Busca por usuario de Instagram, y si no, por
// nombre o teléfono, porque muchas escriben mal su usuario o no tienen cuenta.
export async function clientasPosibles({ instagram, nombre, telefono }) {
  const ig = igLimpio(instagram);
  const encontradas = new Map();

  const agregar = (c, razon, seguro) => {
    if (!c || encontradas.has(c.id)) return;
    encontradas.set(c.id, { ...c, razon, seguro });
  };

  // 1. El usuario exacto. Es la única coincidencia de la que se puede estar seguro.
  if (ig) {
    const { data } = await supabase
      .from("clients").select("id, name, instagram, phone, box_1, box_2")
      .or(`instagram.eq.${ig},instagram.eq.@${ig}`);
    for (const c of data || []) agregar(c, `su usuario es @${igLimpio(c.instagram)}`, true);
  }

  // 2. Parecidos: se escribió a medias, con un punto de más, con un número menos.
  if (ig && ig.length >= 4) {
    const { data } = await supabase
      .from("clients").select("id, name, instagram, phone, box_1, box_2")
      .ilike("instagram", `%${ig.slice(0, Math.max(4, ig.length - 2))}%`)
      .limit(20);
    for (const c of data || []) agregar(c, `su usuario se parece: @${igLimpio(c.instagram)}`, false);
  }

  // 3. Por nombre y por teléfono, para cuando de plano no hay usuario.
  if (nombre && String(nombre).trim().length >= 3) {
    const { data } = await supabase
      .from("clients").select("id, name, instagram, phone, box_1, box_2")
      .ilike("name", `%${String(nombre).trim()}%`).limit(20);
    for (const c of data || []) agregar(c, `se llama ${c.name}`, false);
  }
  if (telefono && String(telefono).replace(/\D/g, "").length >= 7) {
    const tel = String(telefono).replace(/\D/g, "");
    const { data } = await supabase
      .from("clients").select("id, name, instagram, phone, box_1, box_2")
      .ilike("phone", `%${tel.slice(-7)}%`).limit(20);
    for (const c of data || []) agregar(c, `su teléfono termina en ${tel.slice(-4)}`, false);
  }

  // Con productos esperando primero: es casi siempre la que se busca.
  const lista = [];
  for (const c of encontradas.values()) {
    const productos = await productosEsperando(c.id);
    lista.push({ ...c, pendientes: productos.length, cajas: cajasDeTexto(c.box_1, c.box_2) });
  }
  lista.sort((a, b) =>
    (b.seguro ? 1 : 0) - (a.seguro ? 1 : 0) || b.pendientes - a.pendientes);
  return lista;
}

// Buscar a la clienta a mano, en TODAS las fichas, no solo entre las que el sistema
// alcanzó a proponer. Cuando el usuario de la entrega no empata con ninguna ficha la
// lista de propuestas sale vacía, y es justo ahí donde hace falta buscarla por nombre:
// filtrar la lista propuesta dejaba ese caso sin salida más que borrar la entrega.
export async function buscarClientas(texto) {
  // Las comas y los paréntesis parten el filtro de PostgREST, así que no viajan.
  const q = String(texto || "").replace(/[(),]/g, " ").trim();
  if (q.length < 3) return [];

  const ig = igLimpio(q);
  const tel = q.replace(/\D/g, "");
  const filtros = [`name.ilike.%${q}%`];
  if (ig) filtros.push(`instagram.ilike.%${ig}%`);
  if (tel.length >= 7) filtros.push(`phone.ilike.%${tel.slice(-7)}%`);

  const { data } = await supabase
    .from("clients").select("id, name, instagram, phone, box_1, box_2")
    .or(filtros.join(",")).limit(20);

  const lista = [];
  for (const c of data || []) {
    const productos = await productosEsperando(c.id);
    lista.push({
      ...c,
      razon: c.instagram ? `la buscaste · @${igLimpio(c.instagram)}` : "la buscaste",
      // Ninguna búsqueda a mano es "segura": la elige ella, no el sistema.
      seguro: false,
      pendientes: productos.length,
      cajas: cajasDeTexto(c.box_1, c.box_2),
    });
  }
  // Con productos esperando primero: es casi siempre la que se busca.
  lista.sort((a, b) => b.pendientes - a.pendientes);
  return lista;
}

// Las cajas de las que se sacó mercancía y lo que quedó adentro después de armar.
// Con esto la pantalla puede avisar "le quedó el collar en la caja 42" o preguntar
// en cuál dejar lo que sobra cuando se vació de dos cajas distintas.
export async function comoQuedanLasCajas(clientId, itemIdsQueSeVan) {
  const seVan = new Set(itemIdsQueSeVan || []);
  const todos = await productosEsperando(clientId);

  const sacadoDe = new Set();
  const queda = [];
  for (const p of todos) {
    if (seVan.has(p.itemId)) {
      if (p.ubicacion === "caja" && p.caja != null) sacadoDe.add(Number(p.caja));
    } else if (p.ubicacion !== "paquete") {
      queda.push(p);
    }
  }

  const quedaEnCaja = queda.filter((p) => p.ubicacion === "caja" && p.caja != null);
  const cajasConRestos = [...new Set(quedaEnCaja.map((p) => Number(p.caja)))].sort((a, b) => a - b);

  return {
    sacadoDe: [...sacadoDe].sort((a, b) => a - b),
    // Cajas que se vacían del todo con este paquete.
    seLiberan: [...sacadoDe].filter((n) => !cajasConRestos.includes(n)).sort((a, b) => a - b),
    quedaGuardado: queda,
    cajasConRestos,
    // Si lo que sobra quedó repartido en más de una caja, conviene juntarlo.
    hayQueJuntar: cajasConRestos.length > 1,
  };
}

// Qué se le va a cobrar al entregar este paquete.
//
// La deuda se cuenta POR COMPRA y una sola vez, aunque del mismo ticket vayan dos
// productos: se debe el ticket, no cada cosa. El envío no sale de ninguna venta —
// lo pone quien prepara— y por eso va aparte en vez de adivinarlo.
export async function resumenDeCobro(clientId, itemIds, envio = 0) {
  const seVan = new Set(itemIds || []);
  const todos = await productosEsperando(clientId);

  const compras = new Map();
  const lista = [];
  for (const p of todos) {
    if (!seVan.has(p.itemId)) continue;
    lista.push(p);
    if (!compras.has(p.saleId)) compras.set(p.saleId, p.deLaCompra);
  }

  const debeMercancia = Math.round(
    [...compras.values()].reduce((s, c) => s + Math.max(0, c.debe), 0) * 100) / 100;
  const envioNum = Math.max(0, Number(envio) || 0);

  return {
    productos: lista,
    compras: compras.size,
    debeMercancia,
    envio: envioNum,
    aCobrar: Math.round((debeMercancia + envioNum) * 100) / 100,
    // Así queda escrito en la tarjeta de la entrega, para que la repartidora lea lo
    // que de verdad lleva y no lo que la clienta tecleó al agendar.
    texto: lista.map((p) => `${p.cantidad}x ${p.nombre}`).join("\n"),
  };
}

// Armar el paquete: los productos elegidos entran, la entrega queda ligada a ellos y
// las cajas que se vaciaron se sueltan solas (la ocupación se calcula por lo que
// queda dentro, así que no hay que ir a liberarlas a mano).
export async function armarPaquete({ bookingId, clientId, itemIds, juntarRestosEn, envio, session }) {
  const elegidos = (itemIds || []).filter(Boolean);
  if (!bookingId) throw new Error("Falta la entrega");
  if (elegidos.length === 0) throw new Error("No se eligió ningún producto");

  // Que no se cuele un producto de otra clienta ni uno ya entregado.
  const { data: validos } = await supabase
    .from("sale_items")
    .select("id, delivery_status, paquete_booking_id, sales!inner ( client_id )")
    .in("id", elegidos);

  const buenos = (validos || []).filter(
    (i) =>
      i.delivery_status !== "delivered" &&
      (!i.paquete_booking_id || i.paquete_booking_id === bookingId) &&
      (!clientId || i.sales?.client_id === clientId)
  );
  if (buenos.length === 0) throw new Error("Ninguno de esos productos se puede empacar");

  await supabase
    .from("sale_items")
    .update({ paquete_booking_id: bookingId })
    .in("id", buenos.map((i) => i.id));

  // La entrega guarda a quién pertenece y qué lleva: esto es lo que faltaba para que
  // marcarla entregada alcanzara a los productos. Y de paso se rellena sola la
  // tarjeta —qué productos y cuánto cobrar— que hasta hoy se escribía a mano y por
  // eso decía cosas como cobrar $335 de unos aretes que ya estaban pagados.
  const cobro = clientId ? await resumenDeCobro(clientId, buenos.map((i) => i.id), envio) : null;

  await supabase
    .from("bookings")
    .update({
      sale_item_ids: buenos.map((i) => i.id),
      preparado_at: new Date().toISOString(),
      preparado_por_staff_id: session?.staffId ? String(session.staffId) : null,
      preparado_por_name: session?.displayName || session?.username || null,
      ...(cobro ? { products: cobro.texto, amount_due: cobro.aCobrar } : {}),
    })
    .eq("id", bookingId);

  // Juntar en una sola caja lo que quedó repartido, si así se pidió.
  if (clientId && juntarRestosEn) {
    await juntarLoQueQueda(clientId, Number(juntarRestosEn));
  }

  if (clientId) await sincronizarCajasDelCliente(clientId);

  return { empacados: buenos.length, cobro };
}

// Deshacer: los productos vuelven a estar guardados donde estaban. No se borra la
// caja de la venta al armar justamente para que esto sea posible.
export async function deshacerPaquete(bookingId, clientId) {
  if (!bookingId) return 0;
  const { data } = await supabase
    .from("sale_items").select("id").eq("paquete_booking_id", bookingId);
  const ids = (data || []).map((i) => i.id);

  await supabase.from("sale_items").update({ paquete_booking_id: null }).eq("paquete_booking_id", bookingId);
  await supabase.from("bookings")
    .update({
      sale_item_ids: [],
      preparado_at: null, preparado_por_staff_id: null, preparado_por_name: null,
      // La tarjeta también se limpia. Lo que decía lo había escrito el propio
      // armado del paquete, no la clienta, así que dejarlo sería mentir sobre un
      // paquete que ya no existe.
      products: null,
      amount_due: 0,
    })
    .eq("id", bookingId);

  if (clientId) await sincronizarCajasDelCliente(clientId);
  return ids.length;
}

// Cómo quedan las cajas de una clienta después de cancelar una venta.
//
// Cancelar devolvía el inventario pero no tocaba las cajas: la de @dominnik.s se
// quedó anotada en su ficha aunque la mercancía ya había vuelto a la tienda. Y no
// basta con soltarla: en esa misma caja, o en otras suyas, puede quedar mercancía de
// compras que NO se cancelaron. Por eso esto devuelve qué quedó y dónde, para
// preguntarlo en vez de decidirlo solo.
export async function comoQuedanTrasCancelar(clientId, cajaDeLaVenta) {
  if (!clientId) return null;
  const quedan = await comoQuedanLasCajas(clientId, []);
  const n = cajaDeLaVenta == null ? null : Number(cajaDeLaVenta);

  return {
    caja: n,
    // La caja de la venta cancelada se vació del todo.
    seLibero: n != null && !quedan.cajasConRestos.includes(n),
    // Quedó mercancía de otras compras ahí mismo.
    quedaEnLaMisma: n != null && quedan.cajasConRestos.includes(n),
    cajasConRestos: quedan.cajasConRestos,
    quedaGuardado: quedan.quedaGuardado,
    hayQueJuntar: quedan.hayQueJuntar,
  };
}

// Mover a una sola caja todo lo que a la clienta le quedó guardado suelto.
export async function juntarLoQueQueda(clientId, caja) {
  if (!caja) return;
  const todos = await productosEsperando(clientId);
  const ventas = [...new Set(
    todos.filter((p) => p.ubicacion !== "paquete").map((p) => p.saleId)
  )];
  if (ventas.length === 0) return;
  await supabase.from("sales").update({ ubicacion: "caja", caja }).in("id", ventas);
}

// Los paquetes por preparar de un día, por tipo de entrega.
export async function paquetesDelDia(fecha, tipo) {
  let q = supabase
    .from("bookings")
    .select("*")
    .eq("date", fecha)
    .or("delivery_status.eq.pendiente,delivery_status.is.null");
  if (tipo) q = q.eq("type", tipo);

  const { data } = await q;
  const lista = [];
  for (const b of data || []) {
    const { count } = await supabase
      .from("sale_items")
      .select("id", { count: "exact", head: true })
      .eq("paquete_booking_id", b.id);
    lista.push({
      ...b,
      listo: !!b.preparado_at,
      productosEnPaquete: count || 0,
    });
  }
  // Los que faltan por preparar primero.
  lista.sort((a, b) => (a.listo ? 1 : 0) - (b.listo ? 1 : 0));
  return lista;
}

export { cajasATexto };
