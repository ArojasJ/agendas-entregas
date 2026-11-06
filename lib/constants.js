export const DOMICILIO_LIMIT = 15;

// Parada del repartidor en una paquetería que no recoge a domicilio. Es un tipo
// aparte a propósito: el cupo de DOMICILIO_LIMIT solo cuenta 'domicilio', así que
// estas paradas no le quitan lugar a las entregas de clientas.
export const TIPO_PARADA_PAQUETERIA = "parada_paqueteria";

// Qué checkout ve la clienta en el catálogo. "apartado" es el de siempre: registra el
// pedido y el cobro se acuerda aparte. "tienda" es el de pago en línea.
// Se guarda en app_settings.checkout_modo para poder cambiarlo sin desplegar y, sobre
// todo, para poder regresarlo de inmediato si algo sale mal.
export const CHECKOUT_APARTADO = "apartado";
export const CHECKOUT_TIENDA = "tienda";

export function parseCheckoutModo(valor) {
  return valor === CHECKOUT_TIENDA ? CHECKOUT_TIENDA : CHECKOUT_APARTADO;
}

// Venta creada que espera el pago en línea. Su inventario está apartado pero vence:
// si el pago no llega, un barrido lo devuelve. Distinto de un apartado, que no caduca.
export const VENTA_ESPERANDO_PAGO = "pending_payment";

// Cuánto se le guarda la pieza a quien se fue a pagar. Suficiente para buscar la
// tarjeta y volver, sin dejar inventario congelado media tarde.
export const MINUTOS_RESERVA_PAGO = 30;

// La florería pide 2 días hábiles de anticipación y solo abre de lunes a viernes:
// quien agenda el viernes recoge el martes, porque el fin de semana no cuenta.
export const FLORERIA_DIAS_HABILES = 2;

export function esDiaHabil(d) {
  const dow = d.getDay();
  return dow >= 1 && dow <= 5;
}

export function primeraFechaFloreria(desde = new Date()) {
  const d = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  let habiles = 0;
  while (habiles < FLORERIA_DIAS_HABILES) {
    d.setDate(d.getDate() + 1);
    if (esDiaHabil(d)) habiles++;
  }
  return d;
}

export function fechasFloreria(cantidad = 6, desde = new Date()) {
  const fechas = [];
  const d = primeraFechaFloreria(desde);
  while (fechas.length < cantidad) {
    if (esDiaHabil(d)) fechas.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return fechas;
}

// Días de la semana en que se puede recoger en bodega (1=lunes … 5=viernes).
// El valor real vive en app_settings.bodega_dias para poder cambiarlo desde el panel
// sin desplegar; esto solo aplica si el ajuste no existe todavía.
export const BODEGA_DIAS_DEFAULT = [4];

export function parseBodegaDias(value) {
  if (!value) return BODEGA_DIAS_DEFAULT;
  const dias = String(value)
    .split(",")
    .map((d) => parseInt(d.trim(), 10))
    .filter((d) => d >= 1 && d <= 5);
  return dias.length > 0 ? dias : BODEGA_DIAS_DEFAULT;
}

// Las cajas de una clienta se escriben a mano, y las trabajadoras anotan varias en el
// mismo campo: "19, 42". Antes se exigía un número solo y cualquier otra cosa se
// ignoraba ENTERA, así que esa caja quedaba invisible: el sistema la daba por libre y
// podía ofrecérsela a otra clienta, sin avisar del choque. Aquí se lee cualquier
// número que aparezca, en el orden en que está escrito y sin repetir.
export function cajasDeTexto(...valores) {
  const cajas = [];
  for (const valor of valores) {
    if (valor == null) continue;
    for (const encontrado of String(valor).matchAll(/\d+/g)) {
      const n = Number(encontrado[0]);
      // La caja 0 no existe; aparece por dedazos viejos y no debe apartar nada
      if (n > 0 && !cajas.includes(n)) cajas.push(n);
    }
  }
  return cajas;
}

// Cómo se guardan de vuelta: todas en el primer campo, que es el que manda. El segundo
// se sigue leyendo por las fichas viejas, pero ya no se escribe.
export function cajasATexto(cajas) {
  return cajas.length > 0 ? cajas.join(", ") : null;
}

export const NOMBRE_DIA = { 1: "Lunes", 2: "Martes", 3: "Miércoles", 4: "Jueves", 5: "Viernes" };

// "los jueves" / "los lunes, miércoles y viernes" — los cinco nombres son invariables
// en plural, así que basta anteponer "los".
export function textoDiasBodega(dias) {
  const nombres = [...dias].sort().map((d) => NOMBRE_DIA[d].toLowerCase());
  if (nombres.length === 1) return `los ${nombres[0]}`;
  return `los ${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}

// La bodega está en Torreón. El servidor de Vercel corre en UTC, así que sin fijar la
// zona una venta de las 7 de la noche se agrupaba en el día siguiente, y el filtro por
// fecha no la encontraba.
export const ZONA = "America/Monterrey";

// El día tal como lo vive la tienda: "2026-10-30".
export function diaLocal(fecha = new Date()) {
  return new Date(fecha).toLocaleDateString("en-CA", { timeZone: ZONA });
}

// El rango UTC que cubre ese día en Torreón, para filtrar created_at (timestamptz).
// El desfase se pregunta a Intl y no se deduce comparando fechas, porque eso daba cero
// en una máquina que ya está en esa zona y solo fallaba en el servidor.
function offsetMinutos(instante) {
  const etiqueta = new Intl.DateTimeFormat("en-US", { timeZone: ZONA, timeZoneName: "longOffset" })
    .formatToParts(instante)
    .find((p) => p.type === "timeZoneName")?.value || "";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(etiqueta);
  if (!m) return 0;
  const minutos = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -minutos : minutos;
}

export function rangoDelDia(dia) {
  const mediodia = new Date(dia + "T12:00:00Z");
  const inicio = new Date(Date.parse(dia + "T00:00:00Z") - offsetMinutos(mediodia) * 60000);
  const fin = new Date(inicio.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { desde: inicio.toISOString(), hasta: fin.toISOString() };
}
