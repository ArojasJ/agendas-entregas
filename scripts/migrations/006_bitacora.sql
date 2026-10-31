-- Trabajo físico que quedó pendiente por vender fuera de la bodega.
-- La ubicación no se copia aquí: se lee de la venta al mostrar la tarea, para que
-- si algo se mueve de caja entre la venta y el momento de guardarlo, la bitácora
-- diga dónde está ahora y no dónde estaba.
CREATE TABLE IF NOT EXISTS public.bitacora_tareas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id    uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  client_id  uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  productos  text,
  hecha      boolean NOT NULL DEFAULT false,
  hecha_at   timestamptz,
  hecha_por  text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bitacora_tareas ENABLE ROW LEVEL SECURITY;

-- Una venta genera una sola tarea, aunque el alta se reintente
CREATE UNIQUE INDEX IF NOT EXISTS idx_bitacora_una_por_venta
  ON public.bitacora_tareas (sale_id);

-- Lo pendiente, de lo más viejo a lo más nuevo
CREATE INDEX IF NOT EXISTS idx_bitacora_pendientes
  ON public.bitacora_tareas (created_at)
  WHERE hecha = false;

-- Arranca en bodega: así, si nadie toca el interruptor, nada cambia.
INSERT INTO app_settings (key, value) VALUES ('en_bodega', 'true')
ON CONFLICT (key) DO NOTHING;
