import { LegalLayout, Seccion, Lista, NEGOCIO } from "../legal/LegalLayout";

export const metadata = {
  title: "Términos y Condiciones — Noreste CM",
  description:
    "Condiciones de compra, pago, entrega y apartado de Noreste Clothes & More.",
};

export default function Terminos() {
  return (
    <LegalLayout titulo="Términos y Condiciones" actualizado="19 de octubre de 2026">
      <p>
        Estas condiciones aplican a toda compra hecha en <strong>{NEGOCIO.sitio}</strong> o por
        nuestros canales de mensajería. Al realizar un pedido las aceptas. Vendemos{" "}
        <strong>{NEGOCIO.responsable}</strong>, persona física con actividad empresarial, bajo la
        marca <strong>{NEGOCIO.marca}</strong>.
      </p>

      <Seccion titulo="Productos y precios">
        <Lista items={[
          "Todos los precios están en pesos mexicanos (MXN) e incluyen impuestos.",
          "Las fotografías son de los productos reales. Puede haber variaciones mínimas de color según la pantalla desde la que los veas.",
          "La disponibilidad se actualiza en tiempo real, pero una pieza puede agotarse mientras preparas tu pedido. Si eso pasa antes de que pagues, te avisamos y no se te cobra.",
          "Podemos corregir un precio publicado por error. Si tu pedido ya estaba pagado, respetamos el precio al que compraste o te devolvemos tu dinero.",
        ]} />
      </Seccion>

      <Seccion titulo="Formas de pago">
        <p><strong>Pago en línea.</strong> Se procesa con Mercado Pago. Al elegirlo:</p>
        <Lista items={[
          "Tus productos quedan apartados 30 minutos mientras completas el pago.",
          "Si no lo completas en ese tiempo, el pedido se cancela y las piezas vuelven a estar disponibles para otras clientas.",
          "Tu compra se confirma cuando Mercado Pago nos notifica el pago, no antes.",
        ]} />
        <p className="pt-1"><strong>Apartado.</strong> Puedes apartar con el 15% del total y liquidar en un plazo de 15 días.</p>
        <Lista items={[
          "Si no liquidas dentro del plazo, el apartado se cancela y se retiene el 15% como penalización.",
          "Los productos vuelven a venta pública una vez vencido el plazo.",
        ]} />
        <p className="pt-1"><strong>Al recibir.</strong> En entregas a domicilio puedes pagar en efectivo o por transferencia antes de la entrega.</p>
      </Seccion>

      <Seccion titulo="Entregas">
        <p><strong>A domicilio</strong> en Torreón, Gómez Palacio y Lerdo:</p>
        <Lista items={[
          "Costo de $45 por entrega.",
          "Se agenda con al menos un día de anticipación; no hay entregas el mismo día.",
          "El repartidor espera un máximo de 10 minutos en el domicilio. Pasado ese tiempo tendrás que agendar una nueva entrega.",
          "Si no estuviste en una entrega previa, la siguiente tiene un costo de $90, que cubre el viaje perdido.",
          "Hay un cupo limitado de entregas por día; al llenarse, el día deja de aparecer disponible.",
        ]} />
        <p className="pt-1"><strong>Recolección en bodega</strong>, en el horario y los días publicados en la página de agendar. La dirección se comparte al confirmar tu cita.</p>
        <p className="pt-1"><strong>Recolección en nuestra florería</strong> de Gómez Palacio, de lunes a viernes de 9:00 am a 5:00 pm, agendando con al menos dos días hábiles de anticipación. Tu pedido te espera el día que agendaste; pasada esa fecha no podemos hacernos responsables de su resguardo, por lo que te pedimos considerarlo al elegir tu día.</p>
        <p className="pt-1"><strong>Paquetería</strong> a todo México. Los tiempos dependen de la empresa transportista y no están bajo nuestro control. Una vez entregado el paquete a la paquetería, los retrasos, extravíos o daños en tránsito se gestionan directamente con ella.</p>
      </Seccion>

      <Seccion titulo="Cambios y devoluciones">
        <p>
          <strong>Revisa tus productos al recibirlos, frente al repartidor o antes de salir del punto
          de recolección.</strong> Una vez que aceptas la entrega no hay cambios ni devoluciones.
        </p>
        <p>
          Si al momento de recibir detectas que el producto no corresponde a lo que pediste o tiene un
          defecto de fábrica, señálalo en ese instante y lo resolvemos sin costo para ti.
        </p>
        <p className="text-sm text-slate-500">
          Esta política no limita los derechos que la Ley Federal de Protección al Consumidor te
          otorga frente a productos defectuosos.
        </p>
      </Seccion>

      <Seccion titulo="Cancelaciones">
        <Lista items={[
          "Un pedido pagado en línea puede cancelarse mientras no haya sido entregado; se devuelve el monto por la misma vía de pago, dentro de los plazos que maneje Mercado Pago.",
          "Un apartado cancelado por vencimiento del plazo retiene el 15% pagado.",
          "Podemos cancelar un pedido si el producto resultó no disponible o si no logramos contactarte para coordinar la entrega. En esos casos devolvemos el total.",
        ]} />
      </Seccion>

      <Seccion titulo="Tu cuenta">
        <p>
          Si creas una cuenta, eres responsable de mantener segura tu contraseña y de lo que ocurra
          desde ella. Avísanos si crees que alguien más tiene acceso.
        </p>
      </Seccion>

      <Seccion titulo="Datos personales">
        <p>
          El tratamiento de tus datos se rige por nuestro{" "}
          <a href="/aviso-de-privacidad" className="font-bold underline">Aviso de Privacidad</a>.
        </p>
      </Seccion>

      <Seccion titulo="Contacto y aclaraciones">
        <p>
          Para cualquier duda, reclamación o aclaración sobre tu pedido, escríbenos por WhatsApp al{" "}
          <strong>{NEGOCIO.whatsapp}</strong> o por Instagram a <strong>{NEGOCIO.instagram}</strong>.
          Respondemos en horario laboral.
        </p>
      </Seccion>

      <Seccion titulo="Cambios a estas condiciones">
        <p>
          Podemos actualizar estos términos. La versión vigente es siempre la publicada en esta
          página, y aplica la que estuviera vigente al momento de tu compra.
        </p>
      </Seccion>
    </LegalLayout>
  );
}
