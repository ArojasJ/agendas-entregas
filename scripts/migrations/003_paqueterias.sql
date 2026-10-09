-- Catálogo de paqueterías a las que el repartidor va a dejar paquetes.
-- Las coordenadas se capturan una sola vez para que la ruta no dependa de
-- geocodificar texto, que ya nos mandó un marcador a España.
CREATE TABLE IF NOT EXISTS public.paqueterias (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     text NOT NULL,
  direccion  text NOT NULL,
  lat        double precision,
  lng        double precision,
  activa     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.paqueterias ENABLE ROW LEVEL SECURITY;

-- Coordenadas exactas de la parada. Nulas en las entregas normales, que siguen
-- resolviéndose por dirección.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS lng double precision;
