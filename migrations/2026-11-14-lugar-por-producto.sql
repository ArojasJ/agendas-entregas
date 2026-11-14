-- El lugar de la mercancía, ahora también en el producto.
--
-- Hasta hoy el lugar vive en la venta (sales.ubicacion, sales.caja) y el paquete
-- armado en el producto (sale_items.paquete_booking_id). Esas dos reglas distintas ya
-- hicieron equivocarse a tres pantallas —Clientes, el punto de venta y Chequeo—, las
-- tres preguntándole el lugar a la venta cuando el dato había bajado al producto.
--
-- Este paso NO cambia nada de lo que se ve. Hoy no hay ninguna compra repartida entre
-- dos lugares ni ninguna a medio entregar, así que copiar el lugar de cada venta a sus
-- productos da exactamente el mismo resultado. Es el momento más barato para hacerlo:
-- el día que haya una compra en dos cajas distintas, ya no será así de limpio.
--
-- sales.ubicacion NO se toca y sigue siendo lo que escribe toda la aplicación. Los dos
-- campos se mantienen solos con los disparadores de abajo, para no depender de que
-- seis lugares distintos se acuerden de escribir en ambos. Mismo criterio que
-- trg_marcar_cuando_se_entrego: donde hay muchos escritores, la base lo garantiza.
--
-- Se puede correr varias veces sin hacer daño.

alter table sale_items
  add column if not exists ubicacion text,
  add column if not exists caja      integer;

comment on column sale_items.ubicacion is
  'Dónde está guardado ESTE producto: caja, estante o null. Lo mantiene el disparador desde sales mientras la venta siga siendo quien manda. Si está en un paquete armado, paquete_booking_id gana sobre esto.';

-- ── Relleno: lo que dice la venta, a cada uno de sus productos ──
update sale_items i
   set ubicacion = s.ubicacion,
       caja      = s.caja
  from sales s
 where s.id = i.sale_id
   and i.ubicacion is distinct from s.ubicacion;

-- ── Que se mantenga solo: la venta manda, el producto obedece ──
--
-- OJO para el futuro: este disparador existe mientras la venta sea la fuente de la
-- verdad. El día que una pantalla guarde el lugar de UN producto por su cuenta, este
-- disparador se lo borraría en la siguiente escritura de la venta; ese día hay que
-- quitarlo y dejar de escribir sales.ubicacion. Hoy ninguna pantalla lo hace.
create or replace function bajar_lugar_a_los_productos()
returns trigger as $$
begin
  if new.ubicacion is distinct from old.ubicacion
     or new.caja is distinct from old.caja then
    update sale_items
       set ubicacion = new.ubicacion,
           caja      = new.caja
     where sale_id = new.id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_bajar_lugar_a_los_productos on sales;
create trigger trg_bajar_lugar_a_los_productos
  after update on sales
  for each row execute function bajar_lugar_a_los_productos();

-- Un producto que se agrega después hereda el lugar de su compra, que es donde se va
-- a guardar junto con lo demás.
create or replace function heredar_lugar_de_la_compra()
returns trigger as $$
begin
  if new.ubicacion is null then
    select s.ubicacion, s.caja into new.ubicacion, new.caja
      from sales s where s.id = new.sale_id;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_heredar_lugar_de_la_compra on sale_items;
create trigger trg_heredar_lugar_de_la_compra
  before insert on sale_items
  for each row execute function heredar_lugar_de_la_compra();

-- Para buscar "qué hay en la caja 54" sin recorrer toda la tabla.
create index if not exists idx_sale_items_caja
  on sale_items (caja) where caja is not null;
