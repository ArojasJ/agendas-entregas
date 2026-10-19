-- Cuándo deja de estar apartada la pieza de una venta que espera pago en línea.
-- Nula en todo lo demás: los apartados de siempre no caducan.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_sales_reservas_vencidas
  ON public.sales (expires_at)
  WHERE status = 'pending_payment';

-- Devuelve el inventario de las ventas que esperaban pago y ya vencieron.
--
-- Todo ocurre dentro de una transacción y el cambio de estado va condicionado a que
-- la venta siga en 'pending_payment': si el pago entra justo mientras corre el barrido,
-- o si dos barridos coinciden, solo uno gana y el inventario se devuelve una sola vez.
-- SKIP LOCKED evita que dos corridas se esperen entre sí.
CREATE OR REPLACE FUNCTION liberar_reservas_vencidas()
RETURNS TABLE(venta uuid, piezas integer) AS $$
DECLARE
  v_venta  RECORD;
  v_item   RECORD;
  v_piezas integer;
BEGIN
  FOR v_venta IN
    SELECT id FROM sales
    WHERE status = 'pending_payment'
      AND expires_at IS NOT NULL
      AND expires_at < now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE sales SET status = 'cancelled'
    WHERE id = v_venta.id AND status = 'pending_payment';

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_piezas := 0;

    FOR v_item IN
      SELECT product_id, variant_id, quantity FROM sale_items WHERE sale_id = v_venta.id
    LOOP
      IF v_item.variant_id IS NOT NULL THEN
        UPDATE product_variants SET stock = stock + v_item.quantity
        WHERE id = v_item.variant_id;
      ELSIF v_item.product_id IS NOT NULL THEN
        UPDATE products SET stock = stock + v_item.quantity
        WHERE id = v_item.product_id;
      END IF;
      v_piezas := v_piezas + v_item.quantity;
    END LOOP;

    venta  := v_venta.id;
    piezas := v_piezas;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql;
