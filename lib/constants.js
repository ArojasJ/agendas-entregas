export const DOMICILIO_LIMIT = 15;

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
