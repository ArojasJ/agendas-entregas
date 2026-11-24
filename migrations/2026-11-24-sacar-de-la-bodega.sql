-- Mercancía que hay que ir a sacar de una caja o del estante.
--
-- Al quitarle un producto a una venta, el renglón se borra y el producto vuelve a
-- existencias, pero la mercancía sigue dentro de la caja: queda apartada a nombre de
-- una clienta que ya no la compró, y como el sistema la da por disponible se le puede
-- vender a otra persona. El sistema no puede ir por ella; lo único que puede hacer es
-- no dejar que el recado se pierda.
--
-- Va en su propia tabla y no en bitacora_tareas por dos razones:
--
--   1. bitacora_tareas tiene un índice único por venta —una tarea de "guardar" por
--      compra— y lee el lugar en vivo de sales.ubicacion/caja. Aquí el lugar tiene que
--      quedar CONGELADO: el producto dejó de pertenecer a la venta, así que si después
--      esa compra se cambia de caja, el recado mandaría a la caja equivocada. Esto es
--      lo contrario de la regla de CLAUDE.md, y a propósito: ahí el lugar se le
--      pregunta al producto porque el producto sigue siendo de la venta. Este ya no.
--
--   2. Son dos trabajos opuestos. Uno es meter mercancía a la bodega y el otro es
--      sacarla. Mezclarlos en una lista que se llama "lo que hay que guardar" es
--      pedirle a quien llega temprano que lea con lupa.
--
-- Se puede correr varias veces sin hacer daño.

create table if not exists pendientes_sacar (
  id          uuid primary key default gen_random_uuid(),
  -- De dónde salió. Si la venta o la clienta se borran, el recado NO se borra: la
  -- mercancía sigue en la caja aunque el papel desaparezca.
  sale_id     uuid references sales (id)    on delete set null,
  client_id   uuid references clients (id)  on delete set null,
  product_id  uuid references products (id) on delete set null,
  -- El nombre se copia tal cual estaba: si después le cambian el nombre al producto en
  -- el catálogo, quien va a la caja busca lo que decía el día que se quitó.
  producto    text    not null,
  cantidad    integer not null default 1,
  -- Congelados a propósito. Ver arriba.
  ubicacion   text    not null check (ubicacion in ('caja', 'estante')),
  caja        integer,
  hecha       boolean not null default false,
  hecha_at    timestamptz,
  hecha_por   text,
  creada_por  text,
  created_at  timestamptz not null default now()
);

comment on table pendientes_sacar is
  'Mercancía que se quitó de una venta y sigue físicamente guardada. El lugar está congelado al momento en que se quitó, no se lee de la venta.';
comment on column pendientes_sacar.caja is
  'El número de caja tal como estaba ese día. Si la compra se mueve después, este recado NO se mueve con ella.';

create index if not exists idx_pendientes_sacar_abiertos
  on pendientes_sacar (created_at) where hecha = false;

create index if not exists idx_pendientes_sacar_por_venta
  on pendientes_sacar (sale_id);
