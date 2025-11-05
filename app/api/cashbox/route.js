import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// 👇 USA LAS MISMAS ENV QUE YA USAS EN /api/bookings
// (normalmente NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    "Faltan variables de entorno NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY"
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

// GET  /api/cashbox
// Devuelve el último corte de caja (o null si no hay)
export async function GET() {
  try {
    const { data, error } = await supabase
      .from("cashbox_cuts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("Error leyendo cashbox_cuts:", error);
      return NextResponse.json(
        { message: "No se pudo leer la caja.", lastCut: null },
        { status: 500 }
      );
    }

    const lastCut = data && data.length > 0 ? data[0] : null;

    return NextResponse.json({ lastCut }, { status: 200 });
  } catch (err) {
    console.error("Error inesperado en GET /api/cashbox:", err);
    return NextResponse.json(
      { message: "Error interno al leer la caja." },
      { status: 500 }
    );
  }
}

// POST /api/cashbox
// Crea un nuevo corte de caja
export async function POST(request) {
  try {
    const body = await request.json();

    const {
      route = "noreste",
      initialCash,      // dinero inicial (normalmente 300)
      deliveriesAmount, // lo que se cobró en efectivo desde el último corte (solo lo usamos para calcular)
      expectedCash,     // total esperado (inicial + deliveriesAmount)
      countedCash,      // lo que realmente contó el repartidor
      note = "",
    } = body;

    const initial = Number(initialCash ?? 0);
    const deliveries = Number(deliveriesAmount ?? 0);
    const expected =
      expectedCash !== undefined && expectedCash !== null
        ? Number(expectedCash)
        : initial + deliveries;
    const counted = Number(countedCash ?? 0);
    const difference = counted - expected;

    // buscamos el último corte para llenar from_datetime
    const { data: lastData, error: lastError } = await supabase
      .from("cashbox_cuts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1);

    if (lastError) {
      console.error("Error leyendo último corte:", lastError);
    }

    const lastCut = lastData && lastData.length > 0 ? lastData[0] : null;
    const from_datetime = lastCut ? lastCut.created_at : null;

    const { data, error } = await supabase
      .from("cashbox_cuts")
      .insert([
        {
          route,
          from_datetime,
          initial_cash: initial,
          expected_cash: expected,
          counted_cash: counted,
          difference,
          note,
        },
      ])
      .select("*")
      .single();

    if (error) {
      console.error("Error insertando corte:", error);
      return NextResponse.json(
        { message: "No se pudo guardar el corte de caja." },
        { status: 500 }
      );
    }

    return NextResponse.json({ cut: data }, { status: 200 });
  } catch (err) {
    console.error("Error inesperado en POST /api/cashbox:", err);
    return NextResponse.json(
      { message: "Error interno al guardar el corte de caja." },
      { status: 500 }
    );
  }
}
