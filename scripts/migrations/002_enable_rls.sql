-- Denegación total para anon/authenticated en todas las tablas de datos.
-- El anon key viaja en el bundle del navegador, así que sin RLS cualquiera podía leer
-- clientes, ventas y staff —y escribir— hablándole directo a PostgREST.
-- Sin políticas, RLS deniega por defecto. service_role ignora RLS, y todas las rutas
-- de API ya lo usan, así que el panel y el sitio público siguen funcionando igual.
ALTER TABLE public.app_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_days       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bodega_extra_days  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cashbox_cuts       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_location    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estados_resultados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pos_cuts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.special_days       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_logs         ENABLE ROW LEVEL SECURITY;
