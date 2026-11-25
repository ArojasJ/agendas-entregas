-- El valor por defecto de `bookings.delivery_status` estaba escrito con comillas
-- DENTRO del texto:
--
--     column_default = '''pendiente'''::text
--
-- Es decir, una entrega que nace sin que nadie le ponga estado no queda en
-- `pendiente` sino en `'pendiente'`, con los apóstrofos pegados. Y Preparación de
-- paquetes busca así:
--
--     .or("delivery_status.eq.pendiente,delivery_status.is.null")
--
-- `'pendiente'` no es `pendiente`, así que esa entrega no sale en la pantalla: no se
-- puede armar su paquete y nadie se entera de que existe.
--
-- Hoy no hay ni una sola fila con ese valor —se revisaron las 3,478— porque todas
-- las altas pasan por la aplicación y la aplicación sí escribe el estado a mano. Por
-- eso nunca se notó. Pero es una trampa puesta: la pisa el primer alta que no ponga
-- la columna, y eso incluye los scripts y cualquier carga hecha a mano.
--
-- Se corrige el default. No se toca ninguna fila porque no hay ninguna que tocar.

alter table bookings
  alter column delivery_status set default 'pendiente';
