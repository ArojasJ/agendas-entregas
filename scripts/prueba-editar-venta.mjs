import { Client } from "pg";
import { tokenDePrueba } from "./tokenDePrueba.mjs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const ETIQUETA = "PRUEBA_EDITAR";
const token = tokenDePrueba("admin", "Prueba Admin");
const tokenGaby = tokenDePrueba("worker", "Prueba Gaby");
const tokenRepa = tokenDePrueba("driver", "Prueba Repartidor");

let productoId, clienteId, ventaId;

const api = (url, opts = {}, t = token) =>
  fetch(`${BASE}${url}`, {
    ...opts,
    headers: { "Content-Type": "application/json", "x-panel-token": t, ...(opts.headers || {}) },
  });

const editar = (cuerpo, t = token) =>
  api(`/api/sales/${ventaId}`, { method: "PATCH", body: JSON.stringify({ action: "edit", ...cuerpo }) }, t);

const venta = async () =>
  (await c.query(
    "select total, discount, down_payment, status from sales where id=$1", [ventaId])).rows[0];
const renglones = async () =>
  (await c.query(
    "select id, quantity, unit_price from sale_items where sale_id=$1 order by created_at", [ventaId])).rows;
const stock = async () =>
  Number((await c.query("select stock from products where id=$1", [productoId])).rows[0].stock);
const saldo = async () =>
  Number((await c.query("select saldo_favor from clients where id=$1", [clienteId])).rows[0].saldo_favor || 0);

try {
  await c.connect();

  const p = await c.query(
    "INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,50,40) RETURNING id", [ETIQUETA]);
  productoId = p.rows[0].id;
  const cl = await c.query(
    "INSERT INTO clients (name,instagram,phone,saldo_favor) VALUES ($1,$2,'8711234567',0) RETURNING id",
    [ETIQUETA, "@prueba_editar"]);
  clienteId = cl.rows[0].id;

  const creada = await (await api("/api/sales", {
    method: "POST",
    body: JSON.stringify({
      client_id: clienteId, total: 200, discount: 0, payment_method: "efectivo",
      status: "paid", down_payment: 200,
      items: [{ product_id: productoId, variant_id: null, quantity: 2, unit_price: 100 }],
    }),
  })).json();
  ventaId = creada.sale?.id;
  if (ventaId) ok("se creó la venta de prueba: 2 x $100 = $200 pagada");
  else { fail("no se pudo crear la venta de prueba"); throw new Error("sin venta"); }

  const stockInicial = await stock();

  // ── Caso 1: se olvidó el descuento ──
  let r = await editar({
    items: [{ id: (await renglones())[0].id, product_id: productoId, quantity: 2, unit_price: 100 }],
    discount: 20,
    resolucion: { tipo: "devolver" },
  });
  let v = await venta();
  if (r.status === 200 && Number(v.total) === 180) ok("descuento olvidado: el total baja a $180");
  else fail(`el total quedó en ${v.total} (http ${r.status})`);

  if (Number(v.down_payment) === 180) ok("y el enganche baja a $180: los $20 salieron de la caja");
  else fail(`el enganche quedó en ${v.down_payment}`);

  if (v.status === "paid") ok("la venta sigue pagada");
  else fail(`la venta quedó en "${v.status}"`);

  if ((await stock()) === stockInicial) ok("el inventario no se movió: no cambiaron los productos");
  else fail(`el inventario se movió a ${await stock()}`);

  const cuerpo1 = await r.json();
  if (cuerpo1.devuelto === 20) ok("avisa que hay que devolver $20");
  else fail(`dice devuelto = ${cuerpo1.devuelto}`);

  // ── Caso 2: faltó un producto ──
  r = await editar({
    items: [{ id: (await renglones())[0].id, product_id: productoId, quantity: 3, unit_price: 100 }],
    discount: 0,
    resolucion: { tipo: "cobrar" },
  });
  v = await venta();
  if (r.status === 200 && Number(v.total) === 300) ok("faltó un producto: el total sube a $300");
  else fail(`el total quedó en ${v.total} (http ${r.status})`);

  if (Number(v.down_payment) === 300 && v.status === "paid") ok("se cobró la diferencia y queda pagada");
  else fail(`enganche ${v.down_payment}, estado ${v.status}`);

  if ((await stock()) === stockInicial - 1) ok("el inventario descuenta la pieza que se agregó");
  else fail(`el inventario quedó en ${await stock()}, esperaba ${stockInicial - 1}`);

  // ── Caso 3: sobraba un producto, y se le deja como saldo ──
  r = await editar({
    items: [{ id: (await renglones())[0].id, product_id: productoId, quantity: 1, unit_price: 100 }],
    discount: 0,
    resolucion: { tipo: "saldo" },
  });
  v = await venta();
  if (r.status === 200 && Number(v.total) === 100) ok("sobraba un producto: el total baja a $100");
  else fail(`el total quedó en ${v.total} (http ${r.status})`);

  if ((await saldo()) === 200) ok("los $200 que sobraron quedaron como saldo a favor de la clienta");
  else fail(`el saldo a favor quedó en ${await saldo()}`);

  if ((await stock()) === stockInicial + 1) ok("y las dos piezas de más regresaron al inventario");
  else fail(`el inventario quedó en ${await stock()}, esperaba ${stockInicial + 1}`);

  // ── Precio por renglón ──
  r = await editar({
    items: [{ id: (await renglones())[0].id, product_id: productoId, quantity: 1, unit_price: 80 }],
    discount: 0,
    resolucion: { tipo: "saldo" },
  });
  v = await venta();
  if (r.status === 200 && Number(v.total) === 80) ok("se le puede bajar el precio a un producto suelto: $80");
  else fail(`el total quedó en ${v.total} (http ${r.status})`);

  // ── Agregar un producto nuevo ──
  const p2 = await c.query(
    "INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',55,10,20) RETURNING id",
    [ETIQUETA + "_2"]);
  const producto2 = p2.rows[0].id;
  r = await editar({
    items: [
      { id: (await renglones())[0].id, product_id: productoId, quantity: 1, unit_price: 80 },
      { product_id: producto2, variant_id: null, quantity: 2, unit_price: 55 },
    ],
    discount: 0,
    resolucion: { tipo: "credito" },
  });
  v = await venta();
  if (r.status === 200 && (await renglones()).length === 2) ok("se puede agregar un producto que no estaba");
  else fail(`quedaron ${(await renglones()).length} renglones (http ${r.status})`);

  if (Number(v.total) === 190) ok("el total suma los dos renglones: $190");
  else fail(`el total quedó en ${v.total}`);

  if (v.status === "credit") ok("como faltó dinero y se eligió crédito, la venta queda a crédito");
  else fail(`la venta quedó en "${v.status}"`);

  const stock2 = Number((await c.query("select stock from products where id=$1", [producto2])).rows[0].stock);
  if (stock2 === 8) ok("y descuenta del inventario del producto nuevo");
  else fail(`el inventario del producto nuevo quedó en ${stock2}`);

  // ── Ventas a crédito: todavía no acaba de pagar ──
  const aCredito = await (await api("/api/sales", {
    method: "POST",
    body: JSON.stringify({
      client_id: clienteId, total: 1000, discount: 0, payment_method: "efectivo",
      status: "credit", down_payment: 300, credit_days: 15,
      items: [{ product_id: productoId, variant_id: null, quantity: 10, unit_price: 100 }],
    }),
  })).json();
  const ventaCredito = aCredito.sale?.id;
  await (await api("/api/payments", {
    method: "POST", body: JSON.stringify({ sale_id: ventaCredito, amount: 200 }),
  })).json();

  const vc = async () =>
    (await c.query("select total, down_payment, status from sales where id=$1", [ventaCredito])).rows[0];
  const renglonCredito = async () =>
    (await c.query("select id from sale_items where sale_id=$1 limit 1", [ventaCredito])).rows[0].id;
  const editarCredito = (cuerpo) =>
    api(`/api/sales/${ventaCredito}`, { method: "PATCH", body: JSON.stringify({ action: "edit", ...cuerpo }) });

  if (ventaCredito && (await vc()).status === "credit") ok("venta a crédito de prueba: $1000, enganche $300 y un abono de $200");
  else fail("no se pudo crear la venta a crédito");

  const saldoAntes = await saldo();

  // Baja el total pero sigue debiendo: no hay nada que devolver
  let rc = await editarCredito({
    items: [{ id: await renglonCredito(), product_id: productoId, quantity: 8, unit_price: 100 }],
    discount: 0, resolucion: { tipo: "credito" },
  });
  let v3 = await vc();
  const cuerpoC = await rc.json();
  if (rc.status === 200 && Number(v3.total) === 800) ok("crédito: el total baja a $800");
  else fail(`el total quedó en ${v3.total} (http ${rc.status})`);

  if (v3.status === "credit" && Number(v3.down_payment) === 300) ok("sigue a crédito y el enganche no se toca: todavía debe $300");
  else fail(`quedó ${v3.status} con enganche ${v3.down_payment}`);

  if (cuerpoC.devuelto === 0 && cuerpoC.saldoAcreditado === 0 && (await saldo()) === saldoAntes)
    ok("y NO se le devuelve nada: ese dinero nunca lo pagó");
  else fail(`devolvió ${cuerpoC.devuelto} y acreditó ${cuerpoC.saldoAcreditado}`);

  // Baja por debajo de lo que ya entregó: ahí sí sobra dinero de verdad
  rc = await editarCredito({
    items: [{ id: await renglonCredito(), product_id: productoId, quantity: 4, unit_price: 100 }],
    discount: 0, resolucion: { tipo: "devolver" },
  });
  v3 = await vc();
  const cuerpoD = await rc.json();
  if (Number(v3.total) === 400 && cuerpoD.devuelto === 100)
    ok("si el total baja por debajo de lo ya pagado ($500), ahí sí se le devuelven $100");
  else fail(`total ${v3.total}, devuelto ${cuerpoD.devuelto}`);

  if (v3.status === "paid") ok("y la venta deja de estar a crédito: ya quedó cubierta");
  else fail(`la venta quedó en "${v3.status}"`);

  // Sube el total: simplemente debe más
  rc = await editarCredito({
    items: [{ id: await renglonCredito(), product_id: productoId, quantity: 6, unit_price: 100 }],
    discount: 0, resolucion: { tipo: "credito" },
  });
  v3 = await vc();
  if (Number(v3.total) === 600 && v3.status === "credit") ok("si sube el total, simplemente queda debiendo más");
  else fail(`total ${v3.total}, estado ${v3.status}`);

  await c.query("DELETE FROM bitacora_tareas WHERE sale_id=$1", [ventaCredito]);
  await c.query("DELETE FROM payments WHERE sale_id=$1", [ventaCredito]);
  await c.query("DELETE FROM sale_items WHERE sale_id=$1", [ventaCredito]);
  await c.query("DELETE FROM audit_logs WHERE entity_id=$1", [String(ventaCredito)]);
  await c.query("DELETE FROM sales WHERE id=$1", [ventaCredito]);

  // ── Que la caja cuadre: lo que el corte contará, peso por peso ──
  // Se calcula igual que lo hace el corte: enganches de las ventas sin cortar
  // (las canceladas solo con su penalización) más los abonos sin cortar.
  const cajaPendiente = async () => {
    const r = await c.query(`
      select round((
        coalesce((select sum(case
          when status = 'cancelled' then coalesce(penalty_amount,0)
          when status = 'catalog_pending' then 0
          else down_payment end) from sales where pos_cut_id is null), 0)
        + coalesce((select sum(amount) from payments where pos_cut_id is null), 0)
      )::numeric, 2) caja`);
    return Number(r.rows[0].caja);
  };

  const cajaAntes = await cajaPendiente();
  const ventaCaja = (await (await api("/api/sales", {
    method: "POST",
    body: JSON.stringify({
      client_id: clienteId, total: 500, discount: 0, payment_method: "efectivo",
      status: "paid", down_payment: 500,
      items: [{ product_id: productoId, variant_id: null, quantity: 5, unit_price: 100 }],
    }),
  })).json()).sale?.id;
  const renglonCaja = async () =>
    (await c.query("select id from sale_items where sale_id=$1 limit 1", [ventaCaja])).rows[0].id;
  const editarCaja = (cuerpo) =>
    api(`/api/sales/${ventaCaja}`, { method: "PATCH", body: JSON.stringify({ action: "edit", ...cuerpo }) });

  if ((await cajaPendiente()) === cajaAntes + 500) ok("caja: la venta nueva de $500 entra completa al pendiente de corte");
  else fail(`la caja pasó de ${cajaAntes} a ${await cajaPendiente()}`);

  await editarCaja({
    items: [{ id: await renglonCaja(), product_id: productoId, quantity: 4, unit_price: 100 }],
    discount: 0, resolucion: { tipo: "devolver" },
  });
  if ((await cajaPendiente()) === cajaAntes + 400) ok("caja: al devolver $100 la caja baja exactamente $100");
  else fail(`la caja quedó en ${await cajaPendiente()}, esperaba ${cajaAntes + 400}`);

  await editarCaja({
    items: [{ id: await renglonCaja(), product_id: productoId, quantity: 7, unit_price: 100 }],
    discount: 0, resolucion: { tipo: "cobrar" },
  });
  if ((await cajaPendiente()) === cajaAntes + 700) ok("caja: al cobrar $300 más la caja sube exactamente $300");
  else fail(`la caja quedó en ${await cajaPendiente()}, esperaba ${cajaAntes + 700}`);

  // Dejarlo como saldo: el efectivo se queda en el cajón pero sale de la caja contada
  const saldoPrevio = await saldo();
  const rCaja = await editarCaja({
    items: [{ id: await renglonCaja(), product_id: productoId, quantity: 6, unit_price: 100 }],
    discount: 0, resolucion: { tipo: "saldo" },
  });
  const cuerpoCaja = await rCaja.json();
  if ((await saldo()) === saldoPrevio + 100 && cuerpoCaja.saldoAcreditado === 100)
    ok("caja: al dejarlo a su favor se le acreditan los $100");
  else fail(`saldo ${await saldo()} (antes ${saldoPrevio}), acreditado ${cuerpoCaja.saldoAcreditado}`);

  if ((await cajaPendiente()) === cajaAntes + 600) ok("caja: y el corte contará $600, no los $700 de antes");
  else fail(`la caja quedó en ${await cajaPendiente()}, esperaba ${cajaAntes + 600}`);

  // Centavos: que no se escurra nada por el redondeo
  await editarCaja({
    items: [{ id: await renglonCaja(), product_id: productoId, quantity: 3, unit_price: 33.33 }],
    discount: 0.01, resolucion: { tipo: "devolver" },
  });
  const vCent = (await c.query("select total, down_payment from sales where id=$1", [ventaCaja])).rows[0];
  if (Number(vCent.total) === 99.98 && Number(vCent.down_payment) === 99.98)
    ok("centavos: 3 x $33.33 menos $0.01 da $99.98 clavados");
  else fail(`total ${vCent.total}, enganche ${vCent.down_payment}`);

  if ((await cajaPendiente()) === Math.round((cajaAntes + 99.98) * 100) / 100)
    ok("y la caja queda en el centavo exacto, sin arrastre");
  else fail(`la caja quedó en ${await cajaPendiente()}, esperaba ${cajaAntes + 99.98}`);

  await c.query("DELETE FROM bitacora_tareas WHERE sale_id=$1", [ventaCaja]);
  await c.query("DELETE FROM sale_items WHERE sale_id=$1", [ventaCaja]);
  await c.query("DELETE FROM audit_logs WHERE entity_id=$1", [String(ventaCaja)]);
  await c.query("DELETE FROM sales WHERE id=$1", [ventaCaja]);
  await c.query("UPDATE clients SET saldo_favor=0 WHERE id=$1", [clienteId]);
  if ((await cajaPendiente()) === cajaAntes) ok("caja: al borrar la venta de prueba la caja vuelve a su valor original");
  else fail(`la caja no volvió: ${await cajaPendiente()} contra ${cajaAntes}`);

  // ── Ventas pagadas con saldo a favor ──
  // El POS guarda el total completo pero en el enganche solo el efectivo: una venta
  // de $200 pagada con $50 de saldo queda como total 200 / enganche 150. Si el
  // sistema la leyera como "faltan 50", al cobrarlos metería al corte dinero que
  // nunca entró al cajón.
  await c.query("UPDATE clients SET saldo_favor=0 WHERE id=$1", [clienteId]);
  const conSaldo = await (await api("/api/sales", {
    method: "POST",
    body: JSON.stringify({
      client_id: clienteId, total: 200, discount: 0, payment_method: "efectivo",
      status: "paid", down_payment: 150, saldo_applied: 50,
      items: [{ product_id: productoId, variant_id: null, quantity: 2, unit_price: 100 }],
    }),
  })).json();
  const ventaSaldo = conSaldo.sale?.id;
  const vs = async () =>
    (await c.query("select total, down_payment, status from sales where id=$1", [ventaSaldo])).rows[0];
  const renglonSaldo = async () =>
    (await c.query("select id from sale_items where sale_id=$1 limit 1", [ventaSaldo])).rows[0].id;
  const editarSaldo = (cuerpo) =>
    api(`/api/sales/${ventaSaldo}`, { method: "PATCH", body: JSON.stringify({ action: "edit", ...cuerpo }) });

  // Corregir el precio sin cambiar el total no debe inventar un faltante
  let rs = await editarSaldo({
    items: [{ id: await renglonSaldo(), product_id: productoId, quantity: 2, unit_price: 100 }],
    discount: 0, resolucion: {},
  });
  let vS = await vs();
  let cS = await rs.json();
  if (rs.status === 200 && cS.cobrado === 0 && Number(vS.down_payment) === 150)
    ok("venta pagada con saldo: no inventa un faltante ni infla el enganche");
  else fail(`cobró ${cS.cobrado} y el enganche quedó en ${vS.down_payment}`);

  // Bajar el total: lo que se devuelve es el efectivo, el saldo sigue aplicado
  rs = await editarSaldo({
    items: [{ id: await renglonSaldo(), product_id: productoId, quantity: 2, unit_price: 60 }],
    discount: 0, resolucion: { tipo: "devolver" },
  });
  vS = await vs();
  cS = await rs.json();
  if (Number(vS.total) === 120 && cS.devuelto === 80 && Number(vS.down_payment) === 70)
    ok("al bajar a $120 se le devuelven $80 en efectivo y el enganche queda en $70");
  else fail(`total ${vS.total}, devuelto ${cS.devuelto}, enganche ${vS.down_payment}`);

  if ((await saldo()) === 0) ok("y su saldo a favor no se toca: ese se quedó aplicado");
  else fail(`el saldo a favor quedó en ${await saldo()}`);

  // Bajar por debajo del efectivo: sale todo el efectivo y le regresa saldo
  rs = await editarSaldo({
    items: [{ id: await renglonSaldo(), product_id: productoId, quantity: 1, unit_price: 30 }],
    discount: 0, resolucion: { tipo: "devolver" },
  });
  vS = await vs();
  cS = await rs.json();
  if (Number(vS.total) === 30 && cS.devuelto === 70 && Number(vS.down_payment) === 0)
    ok("al bajar a $30 sale todo el efectivo que quedaba ($70)");
  else fail(`total ${vS.total}, devuelto ${cS.devuelto}, enganche ${vS.down_payment}`);

  if ((await saldo()) === 20 && cS.saldoAcreditado === 20)
    ok("y los $20 de saldo que ya no se ocupan le regresan a su saldo a favor");
  else fail(`saldo acreditado ${cS.saldoAcreditado}, saldo del cliente ${await saldo()}`);

  if (vS.status === "paid") ok("la venta sigue marcada como pagada, que es lo que es");
  else fail(`la venta quedó en "${vS.status}"`);

  await c.query("DELETE FROM bitacora_tareas WHERE sale_id=$1", [ventaSaldo]);
  await c.query("DELETE FROM sale_items WHERE sale_id=$1", [ventaSaldo]);
  await c.query("DELETE FROM audit_logs WHERE entity_id=$1", [String(ventaSaldo)]);
  await c.query("DELETE FROM sales WHERE id=$1", [ventaSaldo]);
  await c.query("UPDATE clients SET saldo_favor=0 WHERE id=$1", [clienteId]);

  // ── Lo que no se debe poder ──
  r = await editar({ items: [], discount: 0 });
  if (r.status === 400) ok("no se puede dejar la venta sin productos (400)");
  else fail(`dejar la venta vacía devolvió ${r.status}`);

  r = await editar({
    items: [{ id: (await renglones())[0].id, product_id: productoId, quantity: 999, unit_price: 80 }],
    discount: 0, resolucion: { tipo: "credito" },
  });
  if (r.status === 409) ok("no deja vender más de lo que hay en existencia (409)");
  else fail(`pedir 999 piezas devolvió ${r.status}`);

  r = await editar({
    items: [{ id: (await renglones())[0].id, product_id: productoId, quantity: 1, unit_price: 80 }],
    discount: 500, resolucion: { tipo: "devolver" },
  });
  if (r.status === 400) ok("el descuento no puede ser mayor que la suma de los productos (400)");
  else fail(`un descuento desmedido devolvió ${r.status}`);

  const idEntregado = (await renglones())[1].id;
  await c.query("UPDATE sale_items SET delivery_status='delivered' WHERE id=$1", [idEntregado]);
  r = await editar({
    items: [{ id: (await renglones())[0].id, product_id: productoId, quantity: 1, unit_price: 80 }],
    discount: 0, resolucion: { tipo: "devolver" },
  });
  if (r.status === 409) ok("un producto ya entregado no se puede quitar de la venta (409)");
  else fail(`quitar un entregado devolvió ${r.status}`);

  r = await editar({
    items: [
      { id: (await renglones())[0].id, product_id: productoId, quantity: 1, unit_price: 80 },
      { id: idEntregado, product_id: producto2, quantity: 1, unit_price: 55 },
    ],
    discount: 0, resolucion: { tipo: "devolver" },
  });
  if (r.status === 409) ok("ni bajarle la cantidad (409)");
  else fail(`bajarle la cantidad a un entregado devolvió ${r.status}`);
  await c.query("UPDATE sale_items SET delivery_status='pending' WHERE id=$1", [idEntregado]);

  // ── Quién puede ──
  r = await editar({
    items: [{ id: (await renglones())[0].id, product_id: productoId, quantity: 1, unit_price: 80 }],
    discount: 0, resolucion: { tipo: "devolver" },
  }, tokenGaby);
  if (r.status === 200) ok("una trabajadora sí puede editar");
  else fail(`una trabajadora recibió ${r.status}`);

  r = await editar({
    items: [{ id: (await renglones())[0].id, product_id: productoId, quantity: 1, unit_price: 80 }],
    discount: 0, resolucion: { tipo: "devolver" },
  }, tokenRepa);
  if (r.status === 403) ok("el repartidor no puede editar (403)");
  else fail(`el repartidor recibió ${r.status}`);

  const borrado = await api(`/api/sales?id=${ventaId}`, { method: "DELETE" }, tokenRepa);
  if (borrado.status === 403) ok("y tampoco puede borrar (403): el hueco quedó cerrado");
  else fail(`el repartidor pudo borrar: ${borrado.status}`);

  // ── La bitácora se refresca ──
  // La venta pudo nacer ya con su tarea si estaban fuera de bodega
  await c.query("DELETE FROM bitacora_tareas WHERE sale_id=$1", [ventaId]);
  await c.query(
    "INSERT INTO bitacora_tareas (sale_id, client_id, productos) VALUES ($1,$2,'viejo')", [ventaId, clienteId]);
  await editar({
    items: [{ id: (await renglones())[0].id, product_id: productoId, quantity: 4, unit_price: 80 }],
    discount: 0, resolucion: { tipo: "credito" },
  });
  const tarea = (await c.query(
    "select productos from bitacora_tareas where sale_id=$1", [ventaId])).rows[0];
  if (tarea?.productos?.includes("4x " + ETIQUETA)) ok(`la tarea de bitácora se actualiza sola: "${tarea.productos.slice(0, 40)}…"`);
  else fail(`la tarea de bitácora dice "${tarea?.productos}"`);

  // ── Queda registro de quién editó ──
  const registros = await c.query(
    "select count(*) n, max(staff_name) quien from audit_logs where action='edit_sale' and entity_id=$1",
    [String(ventaId)]);
  if (Number(registros.rows[0].n) > 0) ok(`queda registro de cada edición (${registros.rows[0].n}, la última por ${registros.rows[0].quien})`);
  else fail("no quedó registro en la bitácora de auditoría");

  // ── Venta cortada: candado para todos ──
  const corte = await c.query(
    "INSERT INTO pos_cuts (from_datetime, to_datetime, total_amount) VALUES (now(), now(), 0) RETURNING id");
  await c.query("UPDATE sales SET pos_cut_id=$1 WHERE id=$2", [corte.rows[0].id, ventaId]);
  r = await editar({
    items: [{ id: (await renglones())[0].id, product_id: productoId, quantity: 1, unit_price: 80 }],
    discount: 0, resolucion: { tipo: "devolver" },
  });
  if (r.status === 409) ok("una venta ya cortada no la edita nadie, ni el administrador (409)");
  else fail(`editar una venta cortada devolvió ${r.status}`);
  await c.query("UPDATE sales SET pos_cut_id=NULL WHERE id=$1", [ventaId]);
  await c.query("DELETE FROM pos_cuts WHERE id=$1", [corte.rows[0].id]);

  // ── Una venta cancelada tampoco ──
  await c.query("UPDATE sales SET status='cancelled' WHERE id=$1", [ventaId]);
  r = await editar({
    items: [{ id: (await renglones())[0].id, product_id: productoId, quantity: 1, unit_price: 80 }],
    discount: 0, resolucion: { tipo: "devolver" },
  });
  if (r.status === 409) ok("una venta cancelada tampoco se edita (409)");
  else fail(`editar una cancelada devolvió ${r.status}`);
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (ventaId) {
      await c.query("DELETE FROM bitacora_tareas WHERE sale_id=$1", [ventaId]);
      await c.query("DELETE FROM payments WHERE sale_id=$1", [ventaId]);
      await c.query("DELETE FROM sale_items WHERE sale_id=$1", [ventaId]);
      await c.query("DELETE FROM audit_logs WHERE entity_id=$1", [String(ventaId)]);
      await c.query("DELETE FROM sales WHERE id=$1", [ventaId]);
    }
    if (clienteId) await c.query("DELETE FROM clients WHERE id=$1", [clienteId]);
    await c.query("DELETE FROM sale_items WHERE product_id IN (SELECT id FROM products WHERE name LIKE $1)", [ETIQUETA + "%"]);
    await c.query("DELETE FROM products WHERE name LIKE $1", [ETIQUETA + "%"]);
    out.push("  --    datos de prueba eliminados");
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await c.end();
}
