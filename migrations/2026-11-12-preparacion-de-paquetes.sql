-- PREPARACIÓN DE PAQUETES
--
-- El paquete es la entrega: no hace falta inventar otra cosa. A la entrega solo le
-- faltaba saber qué productos lleva adentro y quién la armó.
--
-- El problema que resuelve: la caja se liberaba hasta que el producto se marcaba
-- entregado, pero físicamente queda libre desde que se arma el paquete. Por eso el
-- sistema cree ocupadas 12 cajas que ya están vacías. De aquí en adelante el producto
-- tiene un lugar más donde estar: ESTANTE, CAJA y ahora PAQUETE ARMADO.
--
-- Se puede correr varias veces sin hacer daño.

-- Quién armó el paquete y cuándo. Mismo criterio que la firma de entrega.
alter table bookings
  add column if not exists preparado_at           timestamptz,
  add column if not exists preparado_por_staff_id uuid,
  add column if not exists preparado_por_name     text;

-- En qué paquete va cada producto. Vacío = todavía está guardado en su lugar.
--
-- Va por PRODUCTO y no por venta porque de una misma compra a veces se entrega una
-- cosa y la otra se queda: la clienta pide solo lo que ya liquidó. Con el lugar
-- guardado por venta completa, eso era imposible de representar.
alter table sale_items
  add column if not exists paquete_booking_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sale_items_paquete_booking_id_fkey') then
    alter table sale_items
      add constraint sale_items_paquete_booking_id_fkey
      foreign key (paquete_booking_id) references bookings(id)
      -- Si se borra una entrega mal agendada, sus productos vuelven a estar guardados
      -- en su caja en vez de quedar apuntando a un paquete que ya no existe.
      on delete set null;
  end if;
end $$;

comment on column sale_items.paquete_booking_id is
  'Entrega en cuyo paquete va este producto. Mientras esté puesto, el producto ya no ocupa su caja: el paquete ya está armado y la caja quedó libre.';

create index if not exists idx_sale_items_paquete
  on sale_items (paquete_booking_id) where paquete_booking_id is not null;

create index if not exists idx_bookings_preparado
  on bookings (preparado_at) where preparado_at is not null;

-- Nada se marca como preparado hacia atrás: los paquetes que ya armaste antes de hoy
-- no dejaron registro, y suponerlo sería inventar. Las 12 cajas descuadradas se
-- revisan contigo una por una, no por decreto.
