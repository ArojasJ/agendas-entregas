import { createClient } from "@supabase/supabase-js";
import { supabase as supabaseAnon } from "./supabaseClient";

// Cliente de servidor que ignora RLS. Las tablas tienen RLS con denegación total para
// que el anon key —que viaja en el bundle del navegador— no sirva para leer ni escribir
// datos; el acceso real pasa solo por las rutas de API, que ya validan sesión y rol.
// Nunca importar esto desde un componente de navegador.
export const supabaseAdmin = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
  : supabaseAnon;
