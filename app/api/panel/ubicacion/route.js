import { getPanelSession } from "@/lib/panelAuth";
import { proponerUbicacion, guardarUbicacion, loQueTieneGuardado } from "@/lib/ubicaciones";

export const dynamic = "force-dynamic";

// Qué proponerle a quien está cobrando: dónde guardar lo de esta venta y qué tiene
// ya guardado la clienta, para poder juntarlo.
export async function GET(req) {
  const session = getPanelSession(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get("clientId");
  const productos = Number(searchParams.get("productos")) || 1;

  const propuesta = await proponerUbicacion(clientId || null, productos);
  return Response.json(propuesta);
}

// Mover de lugar lo que una clienta ya tiene guardado, desde su ficha.
export async function PATCH(req) {
  const session = getPanelSession(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });

  const { saleIds = [], tipo, caja } = await req.json();
  if (saleIds.length === 0) {
    return Response.json({ message: "No se indicó qué mover" }, { status: 400 });
  }
  if (tipo === "caja" && !caja) {
    return Response.json({ message: "Falta el número de caja" }, { status: 400 });
  }

  await guardarUbicacion({ saleId: saleIds[0], tipo, caja, aMover: saleIds.slice(1) });
  return Response.json({ ok: true });
}

// Lo que tiene guardado una clienta, para mostrarlo en su ficha.
export async function POST(req) {
  const session = getPanelSession(req);
  if (!session) return Response.json({ message: "No autorizado" }, { status: 401 });

  const { clientId } = await req.json();
  if (!clientId) return Response.json({ message: "Falta el cliente" }, { status: 400 });

  return Response.json({ guardado: await loQueTieneGuardado(clientId) });
}
