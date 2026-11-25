-- El envío deja de adivinarse.
--
-- `bookings.amount_due` es UN SOLO número: la deuda de la mercancía más el envío,
-- congelada en el momento de armar el paquete. Nadie guardó nunca cuánto de ese
-- número era envío, así que la pantalla de Preparación de paquetes lo recuperaba
-- restándole la deuda de hoy:
--
--     envío = amount_due - lo que debe ahora
--
-- Esa resta se equivoca de dos maneras, y las dos salieron en producción:
--
-- 1. En un paquete SIN armar, `amount_due` es lo que la clienta (o quien la atendió)
--    anotó a cobrar por su MERCANCÍA, no un envío. A Monica Luna le aparecieron
--    $900.00 en la casilla del envío, que era el precio de su ropa.
--
-- 2. En un paquete YA armado, la deuda se mueve después: la clienta abona o liquida.
--    A Katia se le armó el paquete debiendo $1,100 + $45 de envío = $1,145 anotados.
--    Pagó los $1,100. Como hoy debe $0, la resta devuelve $1,145 de "envío".
--
-- De ahí que la pantalla dijera "Nada, todo liquidado" y en el total $900: la deuda
-- sí estaba bien en cero, y el envío se había llevado el resto.
--
-- El envío es el único dato del cobro que no vive en ninguna venta —lo pone quien
-- prepara—, así que es el único que hay que guardar. La deuda nunca se guarda: se le
-- pregunta a la venta cada vez, que es la misma regla que ya seguimos para saber
-- dónde está la mercancía.
--
-- Los paquetes que ya estaban armados se quedan en cero a propósito. Su envío real
-- no se puede saber sin adivinar, y adivinarlo encima de una tarjeta que el
-- repartidor ya trae en la mano es justo lo que causó este problema.

alter table bookings
  add column if not exists envio numeric not null default 0;

comment on column bookings.envio is
  'Solo el envío de esta entrega, sin la mercancía. Lo escribe quien arma el paquete. La deuda NO se guarda aquí: se le pregunta a la venta. No entra a las finanzas ni al corte de caja.';
