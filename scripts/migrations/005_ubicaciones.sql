-- Dónde quedó guardada físicamente cada compra.
-- Antes solo existían clients.box_1 y box_2, que dicen qué cajas ocupa una clienta pero
-- no qué hay en cada una, y el estante no era registrable: se deducía por ausencia.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS ubicacion text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS caja smallint;

-- 'caja' lleva número; 'estante' no. Nulo es una compra que todavía no se guarda.
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_ubicacion_valida;
ALTER TABLE public.sales ADD CONSTRAINT sales_ubicacion_valida CHECK (
  (ubicacion IS NULL  AND caja IS NULL)
  OR (ubicacion = 'estante' AND caja IS NULL)
  OR (ubicacion = 'caja'    AND caja IS NOT NULL AND caja >= 1)
);

-- Para encontrar rápido qué hay en una caja y qué le queda pendiente a una clienta
CREATE INDEX IF NOT EXISTS idx_sales_ubicacion ON public.sales (ubicacion, caja);

-- La Caja 2 quedó como texto vacío en vez de nula en 11 clientas que solo usan una caja.
-- Las hace ver como si tuvieran una segunda caja asignada.
UPDATE public.clients SET box_2 = NULL WHERE box_2 = '';
UPDATE public.clients SET box_1 = NULL WHERE box_1 = '';
