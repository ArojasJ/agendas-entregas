import { Client } from "pg";
import crypto from "crypto";

// Se firma igual que lib/panelAuth: ese archivo usa sintaxis de módulo dentro de un
// paquete CJS, así que no se puede importar desde un script suelto.
const SECRET = process.env.PANEL_TOKEN_SECRET || "agenda_super_secreta_123";
const signPanelToken = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", SECRET).update(body).digest("base64url")}`;
};

const BASE = process.env.BASE_URL || "http://localhost:3000";
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const ETIQUETA = "PRUEBA_BITACORA";
let token, tokenTrabajadora, tokenRepartidor, productoId, clienteId, estadoOriginal;

const api = (url, opts) =>
  fetch(`${BASE}${url}`, { ...opts, headers: { "Content-Type": "application/json", "x-panel-token": token, ...(opts?.headers || {}) } })
    .then((r) => r.json());

const ponerBodega = (valor) =>
  api("/api/settings", { method: "PATCH", body: JSON.stringify({ key: "en_bodega", value: String(valor) }) });

async function vender(cantidad) {
  const items = Array.from({ length: cantidad }, () => ({
    product_id: productoId, variant_id: null, quantity: 1, unit_price: 100,
  }));
  const prop = await api(`/api/panel/ubicacion?clientId=${clienteId}&productos=${cantidad}`);
  const ubic = prop.tipo === "estante" ? { tipo: "estante" }
    : prop.caja ? { tipo: "caja", caja: prop.caja, aMover: prop.aMover || [] } : null;
  const r = await api("/api/sales", {
    method: "POST",
    body: JSON.stringify({
      client_id: clienteId, total: cantidad * 100, discount: 0, payment_method: "efectivo",
      status: "paid", down_payment: cantidad * 100, items, ubicacion: ubic,
    }),
  });
  return r.sale?.id;
}

const tareasDe = async () =>
  (await c.query(
    `SELECT t.id, t.hecha, t.productos FROM bitacora_tareas t
     JOIN sales s ON s.id = t.sale_id WHERE s.client_id = $1`, [clienteId])).rows;

try {
  await c.connect();
  token = signPanelToken({ role: "admin", username: "prueba_admin", displayName: "Prueba Admin" });
  tokenTrabajadora = signPanelToken({ role: "worker", username: "prueba_gaby", displayName: "Prueba Gaby" });
  tokenRepartidor = signPanelToken({ role: "driver", username: "prueba_repartidor", displayName: "Prueba Repartidor" });

  estadoOriginal = (await (await fetch(`${BASE}/api/settings`)).json()).settings?.en_bodega ?? "true";

  const p = await c.query(
    `INSERT INTO products (name,category,price,stock,cost) VALUES ($1,'PRUEBA',100,99,40) RETURNING id`, [ETIQUETA]);
  productoId = p.rows[0].id;
  const cl = await c.query(
    `INSERT INTO clients (name,instagram,phone) VALUES ($1,$2,'8711234567') RETURNING id`,
    [ETIQUETA, "@prueba_bitacora"]);
  clienteId = cl.rows[0].id;

  // ── Estando EN bodega no debe anotar nada ──
  await ponerBodega(true);
  await vender(2);
  if ((await tareasDe()).length === 0) ok("en bodega NO anota tarea: se guarda en el momento");
  else fail("anotó tarea estando en bodega");

  // ── Fuera de bodega sí ──
  await ponerBodega(false);
  await vender(3);
  const tareas = await tareasDe();
  if (tareas.length === 1) ok("fuera de bodega anota una tarea");
  else fail(`esperaba 1 tarea, hay ${tareas.length}`);

  if (tareas[0]?.productos?.includes(ETIQUETA)) ok(`la tarea dice qué guardar: "${tareas[0].productos.slice(0, 40)}…"`);
  else fail(`la tarea no trae los productos: "${tareas[0]?.productos}"`);

  // ── La bitácora la muestra con su lugar ──
  const lista = await api("/api/panel/bitacora");
  const mia = lista.dias?.flatMap((d) => d.tareas).find((t) => t.id === tareas[0].id);
  if (mia) ok(`aparece en la bitácora agrupada por día (${lista.total} pendientes en total)`);
  else fail("no aparece en la bitácora");

  if (mia?.ubicacion) ok(`dice dónde guardarlo: ${mia.ubicacion}${mia.caja ? " " + mia.caja : ""}`);
  else fail("la tarea no dice dónde guardar");

  // ── Si la compra se mueve de caja, la tarea refleja el lugar nuevo ──
  const ventaId = (await c.query(
    `SELECT s.id FROM sales s JOIN bitacora_tareas t ON t.sale_id=s.id WHERE s.client_id=$1`, [clienteId])).rows[0].id;
  await c.query("UPDATE sales SET ubicacion='estante', caja=NULL WHERE id=$1", [ventaId]);
  const lista2 = await api("/api/panel/bitacora");
  const mia2 = lista2.dias?.flatMap((d) => d.tareas).find((t) => t.id === tareas[0].id);
  if (mia2?.ubicacion === "estante") ok("si se mueve de lugar, la tarea muestra el lugar ACTUAL");
  else fail(`la tarea sigue diciendo "${mia2?.ubicacion}" tras moverla al estante`);

  // ── Palomear la saca de pendientes pero la deja en el historial ──
  await api("/api/panel/bitacora", { method: "PATCH", body: JSON.stringify({ ids: [tareas[0].id] }) });
  const pend = await api("/api/panel/bitacora");
  const sigue = pend.dias?.flatMap((d) => d.tareas).some((t) => t.id === tareas[0].id);
  if (!sigue) ok("al palomear desaparece de pendientes");
  else fail("sigue apareciendo como pendiente");

  const hoy = new Date().toLocaleDateString("en-CA");
  const hist = await api(`/api/panel/bitacora?dia=${hoy}`);
  const enHist = hist.dias?.flatMap((d) => d.tareas).find((t) => t.id === tareas[0].id);
  if (enHist?.hecha) ok(`queda en el historial del día, marcada como hecha${enHist.hechaPor ? " por " + enHist.hechaPor : ""}`);
  else fail("no quedó en el historial");

  // ── Mostrador: se la lleva quien la compró, no hay nada que guardar ──
  const mostrador = await api("/api/sales", {
    method: "POST",
    body: JSON.stringify({
      client_id: null, total: 100, discount: 0, payment_method: "efectivo",
      status: "paid", down_payment: 100,
      items: [{ product_id: productoId, variant_id: null, quantity: 1, unit_price: 100 }],
    }),
  });
  const ventaMostrador = mostrador.sale?.id;
  const tareasMostrador = (await c.query(
    "SELECT id FROM bitacora_tareas WHERE sale_id=$1", [ventaMostrador])).rows;
  if (tareasMostrador.length === 0) ok("una venta de mostrador no ensucia la bitácora");
  else fail("la venta de mostrador anotó una tarea que nadie puede hacer");

  // ── Una venta cancelada no deja la tarea colgada ──
  await ponerBodega(false);
  const saleCancel = await vender(2);
  const antesDeCancelar = (await api("/api/panel/bitacora")).total;
  await c.query("UPDATE sales SET status='cancelled' WHERE id=$1", [saleCancel]);
  const despues = await api("/api/panel/bitacora");
  if (despues.total === antesDeCancelar - 1) ok("al cancelar la venta su tarea deja de pedirse");
  else fail(`la tarea de la venta cancelada sigue pendiente (${antesDeCancelar} → ${despues.total})`);

  const siguenEnBase = (await c.query(
    "SELECT count(*) n FROM bitacora_tareas WHERE sale_id=$1", [saleCancel])).rows[0].n;
  if (Number(siguenEnBase) === 1) ok("pero el registro no se borra: si se revive la venta, vuelve");
  else fail("se perdió el registro de la tarea cancelada");

  // ── Quién la puede abrir ──
  const deTrabajadora = await fetch(`${BASE}/api/panel/bitacora`, {
    headers: { "x-panel-token": tokenTrabajadora },
  });
  if (deTrabajadora.status === 200) ok("una trabajadora sí puede abrir la bitácora");
  else fail(`una trabajadora recibió ${deTrabajadora.status} en vez de 200`);

  // Y palomear, que es a lo que llega temprano
  const marcada = await fetch(`${BASE}/api/panel/bitacora`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenTrabajadora },
    body: JSON.stringify({ ids: [tareas[0].id], hecha: false }),
  });
  if (marcada.status === 200) ok("y puede palomear y despalomear");
  else fail(`una trabajadora recibió ${marcada.status} al palomear`);

  const quienLaHizo = (await c.query(
    "SELECT hecha, hecha_por FROM bitacora_tareas WHERE id=$1", [tareas[0].id])).rows[0];
  if (quienLaHizo.hecha === false) ok("al despalomear vuelve a quedar pendiente");
  else fail("no se despalomeó");

  const delRepartidor = await fetch(`${BASE}/api/panel/bitacora`, {
    headers: { "x-panel-token": tokenRepartidor },
  });
  if (delRepartidor.status === 403) ok("el repartidor no (403)");
  else fail(`el repartidor recibió ${delRepartidor.status} en vez de 403`);

  const sinToken = await fetch(`${BASE}/api/panel/bitacora`);
  if (sinToken.status === 403) ok("sin sesión tampoco (403)");
  else fail(`sin sesión recibió ${sinToken.status}`);

  // El interruptor se queda solo para el admin
  const interruptor = await fetch(`${BASE}/api/settings`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "x-panel-token": tokenTrabajadora },
    body: JSON.stringify({ key: "en_bodega", value: "false" }),
  });
  if (interruptor.status === 403) ok("una trabajadora no puede mover el interruptor de bodega (403)");
  else fail(`una trabajadora movió el interruptor: ${interruptor.status}`);
} catch (e) {
  fail(e.message);
} finally {
  try {
    if (estadoOriginal) await ponerBodega(estadoOriginal === "true");
    if (clienteId) {
      await c.query(`DELETE FROM bitacora_tareas WHERE sale_id IN (SELECT id FROM sales WHERE client_id=$1)`, [clienteId]);
      await c.query(`DELETE FROM bitacora_tareas WHERE sale_id IN (SELECT sale_id FROM sale_items WHERE product_id=$1)`, [productoId]);
      await c.query(`DELETE FROM sales WHERE client_id IS NULL AND id IN (SELECT sale_id FROM sale_items WHERE product_id=$1)`, [productoId]);
      await c.query(`DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_id=$1)`, [clienteId]);
      await c.query("DELETE FROM sales WHERE client_id=$1", [clienteId]);
      await c.query("DELETE FROM clients WHERE id=$1", [clienteId]);
    }
    if (productoId) {
      await c.query("DELETE FROM sale_items WHERE product_id=$1", [productoId]);
      await c.query("DELETE FROM products WHERE id=$1", [productoId]);
    }
    out.push(`  --    datos de prueba eliminados · interruptor devuelto a "${estadoOriginal}"`);
  } catch (e) { out.push("  AVISO no se pudo limpiar: " + e.message); }
  console.log(out.join("\n"));
  await c.end();
}
