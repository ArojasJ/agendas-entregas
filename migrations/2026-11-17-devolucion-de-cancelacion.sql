-- Cuándo se le devolvió a la clienta lo que pagó de más al cancelarle un apartado.
--
-- Al cancelar, el negocio se queda el 15% y lo demás se le devuelve EN EFECTIVO. Hasta
-- ahora eso se le apuntaba como saldo a favor; el saldo se quitó, pero quedaba el otro
-- lado del problema: el detalle de una venta cancelada enseña cuánto hay que devolver
-- y no había forma de decir "ya se le dio". Pedía lo mismo para siempre.
--
-- El monto NO se guarda: se calcula de la venta —lo pagado menos la penalización— y
-- así se queda. Guardarlo en cero para "cerrarlo" habría significado cambiar lo que la
-- clienta pagó, que es falsificar el registro, y además los abonos entran al corte.
-- Lo que se guarda es CUÁNDO se devolvió y QUIÉN lo entregó.
--
-- Se puede correr varias veces sin hacer daño.

alter table sales
  add column if not exists devuelto_at          timestamptz,
  add column if not exists devuelto_por_staff_id uuid,
  add column if not exists devuelto_por_name     text;

comment on column sales.devuelto_at is
  'Cuándo se le devolvió en efectivo lo que pagó de más al cancelarle esta venta. Null = todavía se le debe.';
comment on column sales.devuelto_por_name is
  'Quién se lo entregó. En las que se cerraron al arrancar dice que fue un ajuste, no una persona: decir que alguien lo entregó sería inventar.';

-- Las cancelaciones viejas se cierran todas: el negocio arranca en cero y lo que
-- quedara de antes se resuelve fuera del sistema. Se marcan con la fecha de la propia
-- cancelación, no con la de hoy, y con un nombre que dice la verdad sobre cómo se
-- cerraron, para que dentro de un año nadie lea esto como que alguien pagó ese día.
update sales
   set devuelto_at      = created_at,
       devuelto_por_name = 'Cerrado al quitar el saldo a favor'
 where status = 'cancelled'
   and devuelto_at is null;

create index if not exists idx_sales_por_devolver
  on sales (status) where status = 'cancelled' and devuelto_at is null;
