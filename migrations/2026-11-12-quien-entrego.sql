-- Quién entregó cada producto, qué día y a qué hora.
--
-- Hasta ahora el sistema solo guardaba que un producto estaba "entregado", no cuándo
-- ni quién lo marcó. Al preguntar por los tenis de Adriana Hernandez no hubo forma de
-- saberlo: ni en auditoría, ni en bitácora, ni en entregas.
--
-- Se puede correr varias veces sin hacer daño.

alter table sale_items
  add column if not exists delivered_at          timestamptz,
  add column if not exists delivered_by_staff_id uuid,
  add column if not exists delivered_by_name     text;

comment on column sale_items.delivered_at is
  'Cuándo se marcó entregado. Lo pone solo el disparador de abajo.';
comment on column sale_items.delivered_by_name is
  'Quién lo marcó. Lo escribe la aplicación; queda null si se marcó por fuera.';

-- Los productos que YA estaban entregados antes de este cambio se quedan en null a
-- propósito: inventarles una fecha sería peor que decir "no se registró".

-- La fecha la pone la base, no la aplicación. Hay diez lugares distintos que marcan
-- entregado; si dependiera de que cada uno se acuerde, tarde o temprano uno se olvida
-- y volvemos a no saber. Aquí no se puede escapar ninguno.
create or replace function marcar_cuando_se_entrego()
returns trigger as $$
begin
  if new.delivery_status is distinct from old.delivery_status then
    if new.delivery_status = 'delivered' then
      -- Solo la primera vez: volver a guardar el renglón no debe mover la fecha real.
      if old.delivery_status is distinct from 'delivered' then
        new.delivered_at := now();
      end if;
    else
      -- Se revirtió la entrega: el dato deja de ser cierto y se borra.
      new.delivered_at          := null;
      new.delivered_by_staff_id := null;
      new.delivered_by_name     := null;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_marcar_cuando_se_entrego on sale_items;
create trigger trg_marcar_cuando_se_entrego
  before update on sale_items
  for each row execute function marcar_cuando_se_entrego();

-- Para buscar "qué se entregó tal día" sin recorrer toda la tabla.
create index if not exists idx_sale_items_delivered_at
  on sale_items (delivered_at desc) where delivered_at is not null;
