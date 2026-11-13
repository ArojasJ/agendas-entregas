-- Por qué salió un producto, además de "se entregó".
--
-- En Chequeo solo había dos salidas: estante o ya entregado. Pero hay casos que no
-- son ninguna de las dos: un apartado que no se pagó y el producto se REVENDIÓ, o un
-- producto que simplemente se PERDIÓ.
--
-- Son etiquetas y nada más: no mueven inventario, no crean ventas y no tocan dinero.
-- Lo único que hacen es que el producto deje de aparecer como pendiente, porque ya no
-- está esperando a nadie.
--
-- Se guarda aparte, no dentro de delivery_status, a propósito: hay diecinueve lugares
-- que preguntan "¿sigue pendiente?" mirando delivery_status, y cambiarle el
-- significado a todos sería la forma más fácil de romper algo. Así el producto queda
-- resuelto para el sistema y el motivo real vive en su propia columna.
--
-- Se puede correr varias veces sin hacer daño.

alter table sale_items
  add column if not exists resolucion text;

comment on column sale_items.resolucion is
  'Por qué dejó de estar pendiente, cuando no fue por entregarse: revendido o perdido. Vacío = se entregó normal.';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sale_items_resolucion_valida') then
    alter table sale_items
      add constraint sale_items_resolucion_valida
      check (resolucion is null or resolucion in ('revendido', 'perdido'));
  end if;
end $$;

create index if not exists idx_sale_items_resolucion
  on sale_items (resolucion) where resolucion is not null;
