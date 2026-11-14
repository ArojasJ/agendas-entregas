import { tieneIntentoFallidoSinSaldar, costoDeEnvio, ENVIO_NORMAL, ENVIO_DOBLE } from "../lib/penalizacionEnvio.js";

// El doble cobro de envío es por el VIAJE perdido, no por cualquier entrega que no
// ocurrió. Antes contaba todos los tipos: a quien no pasó a recoger a bodega en enero
// le aparecían $90 al pedir a domicilio en noviembre, sin haber hecho nada.
//
// Esto importa justo ahora porque vamos a marcar como "no entregadas" 326 entregas
// viejas de bodega, paquetería y florería que nunca salieron. Con la regla anterior,
// eso le hubiera cobrado doble a 120 clientas de golpe.

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const e = (type, delivery_status, date) => ({ type, delivery_status, date });

const casos = [
  ["sin historial, envío normal",
    [], ENVIO_NORMAL],

  ["un domicilio fallido y nada después: se cobra doble",
    [e("domicilio", "no_entregado", "2026-09-01")], ENVIO_DOBLE],

  ["un domicilio fallido pero después sí recibió: queda saldado",
    [e("domicilio", "no_entregado", "2026-09-01"), e("domicilio", "entregado", "2026-09-10")], ENVIO_NORMAL],

  ["lo saldó recogiendo en bodega: cuenta igual, ya recibió lo suyo",
    [e("domicilio", "no_entregado", "2026-09-01"), e("bodega", "entregado", "2026-09-10")], ENVIO_NORMAL],

  ["no pasó a recoger a bodega: eso NO es un viaje perdido, envío normal",
    [e("bodega", "no_entregado", "2026-09-01")], ENVIO_NORMAL],

  ["un paquete que no salió tampoco penaliza",
    [e("paqueteria", "no_entregado", "2026-09-01")], ENVIO_NORMAL],

  ["ni una entrega de florería",
    [e("floreria", "no_entregado", "2026-09-01")], ENVIO_NORMAL],

  ["bodega fallida y domicilio fallido: cuenta el domicilio",
    [e("bodega", "no_entregado", "2026-09-05"), e("domicilio", "no_entregado", "2026-09-01")], ENVIO_DOBLE],

  ["entregó bien ANTES del fallo, no después: sigue debiendo el viaje",
    [e("domicilio", "entregado", "2026-08-01"), e("domicilio", "no_entregado", "2026-09-01")], ENVIO_DOBLE],

  ["dos fallos, saldado después del último: normal",
    [e("domicilio", "no_entregado", "2026-07-01"), e("domicilio", "no_entregado", "2026-08-01"),
     e("domicilio", "entregado", "2026-08-15")], ENVIO_NORMAL],

  ["dos fallos, la entrega buena quedó entre los dos: sigue doble",
    [e("domicilio", "no_entregado", "2026-07-01"), e("domicilio", "entregado", "2026-07-15"),
     e("domicilio", "no_entregado", "2026-08-01")], ENVIO_DOBLE],

  ["no caduca con el tiempo: un fallo de hace dos años sigue cobrando doble",
    [e("domicilio", "no_entregado", "2024-01-01")], ENVIO_DOBLE],
];

for (const [nombre, entregas, esperado] of casos) {
  const dio = costoDeEnvio(entregas);
  if (dio === esperado) ok(`${nombre} — $${dio}`);
  else fail(`${nombre}: esperaba $${esperado} y dio $${dio}`);
}

// Que no truene con datos sucios, que de eso hay
for (const basura of [null, undefined, [null], [{}], [{ type: "domicilio" }]]) {
  try {
    const r = costoDeEnvio(basura);
    if (r !== ENVIO_NORMAL) { fail(`con datos sucios cobró $${r}: ${JSON.stringify(basura)}`); break; }
  } catch (err) {
    fail(`truena con ${JSON.stringify(basura)}: ${err.message}`);
    break;
  }
}
ok("con datos incompletos o vacíos no truena y cobra lo normal");

// Y la comprobación que motivó todo esto
const bodegaVieja = [e("bodega", "no_entregado", "2026-01-15")];
if (!tieneIntentoFallidoSinSaldar(bodegaVieja))
  ok("marcar las 326 viejas de bodega y paquetería NO le cobrará doble a nadie");
else
  fail("marcar las viejas de bodega seguiría penalizando");

console.log(out.join("\n"));
