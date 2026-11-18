// El mensaje de confirmación que se le manda a la clienta antes de que salga su
// paquete. Vivía dentro de la pantalla de Entregas, pero ahora también se copia desde
// Preparación de paquetes: tenerlo dos veces habría hecho que un día dijeran cosas
// distintas, y es la voz del negocio hablándole a la clienta.
//
// El texto NO se tocó al mudarlo. Es palabra por palabra el que ya se mandaba.

function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Los nombres van escritos aquí y no por toLocaleDateString porque el mensaje se copia
// desde el celular de quien atiende, y el idioma de ese navegador no lo controlamos.
const DIAS_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
               "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function formatDiaLargoMX(dateStr) {
  const d = parseLocalDate(dateStr);
  if (!d || Number.isNaN(d.getTime())) return null;
  return `${DIAS_SEMANA[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}`;
}

export function buildConfirmationMessage(bk, floreria) {
  const products = (bk.products && bk.products.trim()) || "— (sin productos capturados)";
  const adeudo = bk.amount_due !== undefined && bk.amount_due !== null ? bk.amount_due : 0;

  if (bk.type === "domicilio") {
    return `Hola, sólo para confirmar lo que se te entregará:

${products}

Aún queda pendiente $${adeudo}, puedes realizar transferencia (antes de tu entrega) o pagar en efectivo al recibir tu paquete 🖤

Tu entrega será después de la 1pm✨

Recuerda revisar tus productos al recibirlos con el repartidor ya que una vez entregados no hay cambios ni devoluciones. Solo podemos permanecer 10 min en el domicilio en caso de exceder este tiempo deberás agendar tu entrega nuevamente 🚚 🖤

Es correcto?✨`;
  }

  if (bk.type === "bodega") {
    return `Hola, sólo para confirmar lo que se te entregará:

${products}

Aún queda pendiente $${adeudo}, puedes realizar transferencia (antes de tu entrega) o pagar en efectivo al recibir tu paquete 🖤

Puedes pasar a recoger tus productos de 4 a 6pm✨

Recuerda revisar tus productos al recibirlos ya que una vez entregados no hay cambios ni devoluciones 🖤

Es correcto?✨`;
  }

  if (bk.type === "floreria") {
    const horario = floreria?.horario ? `de ${floreria.horario}` : "en nuestro horario de atención";
    const donde = floreria?.direccion ? `\n\n📍 ${floreria.direccion}` : "";
    // El día no se calcula: es el que la clienta eligió al agendar. La primera opción
    // que le ofrece el calendario ya son 2 días hábiles después (primeraFechaFloreria),
    // pero puede escoger uno más lejano y el mensaje tiene que decir ese, no el mínimo.
    const dia = formatDiaLargoMX(bk.date);
    // El día entra entre "Gómez Palacio" y el horario, que es su lugar natural y no
    // obliga a mover ninguna otra palabra del mensaje. Sin fecha, la frase queda
    // exactamente como era antes.
    const cuando = dia ? `el ${dia} ` : "";
    return `Hola, sólo para confirmar lo que se te entregará:

${products}

Aún queda pendiente $${adeudo}, puedes realizar transferencia (antes de pasar) o pagar en efectivo al recoger 🖤

Puedes pasar a recoger tus productos a nuestra florería en Gómez Palacio ${cuando}${horario}✨${donde}

Tu paquete te espera únicamente el día que agendaste. Pasada esa fecha no podemos hacernos responsables de su resguardo, así que te pedimos considerarlo al elegir tu día 🖤

Recuerda revisar tus productos al recibirlos ya que una vez entregados no hay cambios ni devoluciones 🖤

Es correcto?✨`;
  }

  if (bk.type === "paqueteria") {
    const destino = [bk.address, bk.city].filter(Boolean).join(", ");
    return `Hola, sólo para confirmar lo que se te enviará:

${products}

Aún queda pendiente $${adeudo}, puedes realizar transferencia antes de que salga tu paquete 🖤
${destino ? `\n📦 Se envía a: ${destino}\n` : ""}
En cuanto salga tu paquete te compartimos el número de rastreo✨

Recuerda revisar tus productos al recibirlos ya que una vez entregados no hay cambios ni devoluciones 🖤

Es correcto?✨`;
  }

  return "";
}
