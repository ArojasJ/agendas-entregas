// Cuánto se le cobra de envío a una clienta que agenda a domicilio.
//
// Si quedó un intento de entrega fallido sin saldar, el siguiente envío se cobra
// doble: el repartidor ya hizo ese viaje hasta su casa y se perdió.
//
// Dos reglas que parecen detalles y no lo son:
//
// 1. Solo cuentan los DOMICILIOS fallidos. Lo que se vuelve a cobrar es el viaje, y
//    una recolección en bodega que la clienta no pasó a recoger, o un paquete que no
//    salió, no le costó un viaje a nadie. Antes contaban todos los tipos, así que a
//    quien no pasó por bodega en enero le aparecían $90 al pedir a domicilio en
//    noviembre, sin haber hecho nada.
//
// 2. No caduca con el tiempo. Se queda hasta que haya una entrega exitosa, y ésa sí
//    cuenta de cualquier tipo: si ya recibió lo suyo por donde sea, el intento
//    perdido quedó saldado.

export const ENVIO_NORMAL = 45;
export const ENVIO_DOBLE = 90;

// ¿Le quedó un intento fallido sin saldar? `entregas` son las bookings de la clienta.
export function tieneIntentoFallidoSinSaldar(entregas) {
  const lista = entregas || [];

  const ultimoFallido = lista
    .filter((e) => e?.delivery_status === "no_entregado" && e?.type === "domicilio")
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];

  if (!ultimoFallido) return false;

  return !lista.some(
    (e) => e?.delivery_status === "entregado" && new Date(e.date) > new Date(ultimoFallido.date)
  );
}

export function costoDeEnvio(entregas) {
  return tieneIntentoFallidoSinSaldar(entregas) ? ENVIO_DOBLE : ENVIO_NORMAL;
}
