import { LegalLayout, Seccion, Lista, NEGOCIO } from "../legal/LegalLayout";

export const metadata = {
  title: "Aviso de Privacidad — Noreste CM",
  description:
    "Cómo Noreste Clothes & More recaba, usa y protege los datos personales de sus clientes.",
};

export default function AvisoPrivacidad() {
  return (
    <LegalLayout titulo="Aviso de Privacidad" actualizado="19 de octubre de 2026">
      <p>
        <strong>{NEGOCIO.responsable}</strong>, persona física con actividad empresarial que opera
        bajo la marca <strong>{NEGOCIO.marca}</strong>, con domicilio en {NEGOCIO.domicilio}, es
        responsable del tratamiento de tus datos personales conforme a la Ley Federal de Protección
        de Datos Personales en Posesión de los Particulares.
      </p>

      <Seccion titulo="Qué datos recabamos">
        <p>Según cómo nos compres, podemos pedirte:</p>
        <Lista items={[
          "Nombre completo.",
          "Teléfono o WhatsApp.",
          "Usuario de Instagram.",
          "Domicilio de entrega, cuando eliges envío a domicilio o paquetería.",
          "Correo electrónico, si creas una cuenta en el sitio.",
          "Historial de tus compras, entregas y pagos con nosotros.",
        ]} />
      </Seccion>

      <Seccion titulo="Nunca recibimos los datos de tu tarjeta">
        <p>
          Los pagos en línea se procesan íntegramente en la plataforma de Mercado Pago. El número de
          tu tarjeta, su fecha de vencimiento y su código de seguridad se capturan en los sistemas de
          Mercado Pago y <strong>nunca pasan por nuestro sitio ni se almacenan en nuestras bases de
          datos</strong>. De una compra pagada en línea solo conservamos el monto, la fecha y una
          referencia de la operación.
        </p>
      </Seccion>

      <Seccion titulo="Para qué los usamos">
        <p>Finalidades necesarias para darte el servicio:</p>
        <Lista items={[
          "Procesar tu pedido, cobrarlo y entregártelo.",
          "Coordinar contigo la fecha y el lugar de entrega.",
          "Contactarte por WhatsApp o Instagram sobre tu pedido.",
          "Llevar el control de apartados, abonos y saldos pendientes.",
          "Cumplir obligaciones fiscales y contables.",
        ]} />
        <p className="pt-1">Finalidades que no son necesarias y a las que puedes negarte:</p>
        <Lista items={[
          "Enviarte avisos de nuevos productos, promociones o descuentos.",
        ]} />
        <p className="text-sm text-slate-500">
          Si no quieres recibir avisos promocionales, escríbenos por WhatsApp al {NEGOCIO.whatsapp} y
          dejamos de enviártelos. Negarte no afecta tus compras ni tus entregas.
        </p>
      </Seccion>

      <Seccion titulo="Con quién los compartimos">
        <p>
          No vendemos ni rentamos tus datos. Los compartimos únicamente con quienes hacen falta para
          cumplir tu pedido:
        </p>
        <Lista items={[
          "Mercado Pago, para procesar tu pago en línea.",
          "Empresas de paquetería (Estafeta, DHL, Paquetexpress, Sendex, Afimex u otras), cuando eliges ese método de envío y necesitan tu domicilio para entregarte.",
          "Nuestro proveedor de servicios de nube, donde se aloja la información del sistema.",
          "Autoridades competentes, cuando la ley lo exija.",
        ]} />
        <p>
          Estas transferencias son las necesarias para darte el servicio que contrataste, por lo que
          no requieren tu consentimiento adicional conforme al artículo 37 de la Ley.
        </p>
      </Seccion>

      <Seccion titulo="Tus derechos ARCO">
        <p>
          En cualquier momento puedes pedirnos <strong>acceder</strong> a los datos que tenemos de ti,{" "}
          <strong>rectificarlos</strong> si están equivocados, <strong>cancelarlos</strong> cuando
          consideres que no los necesitamos, u <strong>oponerte</strong> a que los usemos para fines
          específicos. También puedes revocar el consentimiento que nos diste.
        </p>
        <p>
          Escríbenos por WhatsApp al <strong>{NEGOCIO.whatsapp}</strong> o por Instagram a{" "}
          <strong>{NEGOCIO.instagram}</strong> indicando qué quieres hacer y cómo podemos
          identificarte. Te responderemos en un plazo máximo de 20 días hábiles.
        </p>
        <p className="text-sm text-slate-500">
          Ten en cuenta que hay datos que debemos conservar aunque pidas su cancelación, como los de
          compras ya facturadas, por obligaciones fiscales.
        </p>
      </Seccion>

      <Seccion titulo="Cuánto tiempo los conservamos">
        <p>
          Conservamos tus datos mientras seas cliente y durante el tiempo que la ley nos obligue a
          guardar los registros de operaciones. Después los eliminamos o los anonimizamos.
        </p>
      </Seccion>

      <Seccion titulo="Cambios a este aviso">
        <p>
          Si modificamos este aviso, publicaremos la versión actualizada en{" "}
          <strong>{NEGOCIO.sitio}/aviso-de-privacidad</strong> con la fecha del cambio. Te
          recomendamos revisarlo de vez en cuando.
        </p>
      </Seccion>

      <Seccion titulo="Si no estás conforme">
        <p>
          Si consideras que tu derecho a la protección de datos fue vulnerado, puedes acudir ante el
          Instituto Nacional de Transparencia, Acceso a la Información y Protección de Datos
          Personales (INAI).
        </p>
      </Seccion>
    </LegalLayout>
  );
}
