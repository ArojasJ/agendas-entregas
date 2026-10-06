-- Rollback temporal: el código que migra las rutas a service_role todavía no está
-- desplegado, así que RLS dejaba el catálogo público vacío. Reaplicar 002_enable_rls.sql
-- en cuanto el deploy esté en vivo.
ALTER TABLE public.app_settings       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_days       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bodega_extra_days  DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashbox_cuts       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients            DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_location    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.estados_resultados DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_cuts           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.products           DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.special_days       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_logs         DISABLE ROW LEVEL SECURITY;
