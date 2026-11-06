import { createClient } from "@supabase/supabase-js";
import { getPanelSession } from "@/lib/panelAuth";
import { supabase as supabaseAnon } from "@/lib/supabaseClient";
import { cajasDeTexto, cajasATexto } from "@/lib/constants";
import { duenosDeCajas } from "@/lib/ubicaciones";

const supabase = process.env.SUPABASE_SERVICE_ROLE_KEY
  ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : supabaseAnon;


export async function PATCH(req, { params }) {
  const session = getPanelSession(req);
  if (!session) {
    return Response.json({ message: "No autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  const allowed = ["box_1", "box_2", "name", "instagram", "phone", "balance", "needs_review"];
  const updates = {};
  for (const key of allowed) {
    if (key in body) updates[key] = body[key];
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ message: "Sin campos para actualizar" }, { status: 400 });
  }

  // Por aquí guarda las cajas el punto de venta. Se normalizan y se revisan los choques
  // igual que en el alta: si no, una caja escrita de otra forma volvería a quedar
  // invisible, y se le podría dar a dos clientas sin que nadie se enterara.
  if ("box_1" in updates || "box_2" in updates) {
    const cajas = cajasDeTexto(updates.box_1, updates.box_2);
    const duenos = await duenosDeCajas(cajas, id);
    if (duenos.size > 0) {
      const choques = [...duenos.entries()]
        .map(([n, c]) => `La caja ${n} ya la usa ${c.instagram || c.name || "otra clienta"}`);
      return Response.json({ message: choques.join(" · ") }, { status: 409 });
    }
    updates.box_1 = cajasATexto(cajas);
    updates.box_2 = null;
  }

  const { data, error } = await supabase
    .from("clients")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error(error);
    return Response.json({ message: "Error al actualizar cliente" }, { status: 500 });
  }

  return Response.json({ client: data });
}
