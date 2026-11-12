// Las entregas de prueba NUNCA se crean en la fecha de hoy.
//
// Una prueba creó un paquete a domicilio con la fecha del día y se le movió la ruta a
// la repartidora que estaba trabajando. Aunque el script limpie al terminar, mientras
// corre la entrega falsa existe de verdad y sale en el panel y en la ruta.
//
// Por eso todo lo de prueba se agenda a más de un año: nunca se cruza con un día de
// trabajo real, y si algún script muriera a medias, la basura queda en un rincón del
// calendario donde no estorba a nadie.

const DIAS_ADELANTE = 400;

export function fechaDePrueba(sumar = 0) {
  const d = new Date();
  d.setDate(d.getDate() + DIAS_ADELANTE + sumar);
  return d;
}

// En formato AAAA-MM-DD, que es como la guarda la base y como la lee la pantalla.
export function isoDePrueba(sumar = 0) {
  const d = fechaDePrueba(sumar);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
