export const DOMICILIO_LIMIT = 15;

// Parada del repartidor en una paquetería que no recoge a domicilio. Es un tipo
// aparte a propósito: el cupo de DOMICILIO_LIMIT solo cuenta 'domicilio', así que
// estas paradas no le quitan lugar a las entregas de clientas.
export const TIPO_PARADA_PAQUETERIA = "parada_paqueteria";

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

export const NOMBRE_DIA = { 1: "Lunes", 2: "Martes", 3: "Miércoles", 4: "Jueves", 5: "Viernes" };

// "los jueves" / "los lunes, miércoles y viernes" — los cinco nombres son invariables
// en plural, así que basta anteponer "los".
export function textoDiasBodega(dias) {
  const nombres = [...dias].sort().map((d) => NOMBRE_DIA[d].toLowerCase());
  if (nombres.length === 1) return `los ${nombres[0]}`;
  return `los ${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
}
