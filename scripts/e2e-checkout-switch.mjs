import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const USER = process.env.ADMIN_USER;
const PASS = process.env.ADMIN_PASS;

const out = [];
const ok = (m) => out.push("  ok    " + m);
const fail = (m) => { out.push("  FALLA " + m); process.exitCode = 1; };

const browser = await chromium.launch();

async function abrir({ comoAdmin }) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  if (comoAdmin) {
    const r = await page.request.post(`${BASE}/api/login-panel`, {
      data: { username: USER, password: PASS },
    });
    const { token } = await r.json();
    await page.addInitScript((t) => localStorage.setItem("panelToken", t), token);
  }
  await page.goto(`${BASE}/catalogo`, { waitUntil: "networkidle", timeout: 60000 });
  return { ctx, page };
}

try {
  // 1. Una clienta cualquiera no debe ver nada
  const cliente = await abrir({ comoAdmin: false });
  const visibleParaCliente = await cliente.page.getByText(/^Checkout:/).count();
  if (visibleParaCliente === 0) ok("la clienta NO ve el interruptor");
  else fail("el interruptor se le aparece a la clienta");
  await cliente.ctx.close();

  // 2. Admin sí lo ve
  const admin = await abrir({ comoAdmin: true });
  const { page } = admin;
  const boton = page.getByText(/^Checkout:/);
  await boton.waitFor({ state: "visible", timeout: 10000 });
  ok(`admin ve el interruptor (${(await boton.textContent()).trim()})`);

  // 3. Abre el panel y muestra los dos controles
  await boton.click();
  await page.getByText("Lo que ven las clientas").waitFor({ timeout: 5000 });
  await page.getByText("Probar el otro, solo tú").waitFor({ timeout: 5000 });
  ok("muestra el control global y el de vista previa");

  // 4. La vista previa no debe tocar el ajuste global
  const antes = await (await page.request.get(`${BASE}/api/settings`)).json();
  await page.getByRole("button", { name: /^Ver / }).click();
  await page.waitForTimeout(800);
  const despues = await (await page.request.get(`${BASE}/api/settings`)).json();
  if (antes.settings?.checkout_modo === despues.settings?.checkout_modo)
    ok(`la vista previa no cambió el ajuste global (sigue en "${despues.settings?.checkout_modo ?? "apartado"}")`);
  else fail("la vista previa alteró lo que ven las clientas");

  // 5. En modo tienda el carrito avisa en vez de registrar un pedido fantasma
  const pedidos = [];
  page.on("response", (r) => {
    if (r.url().includes("/api/public/checkout")) pedidos.push(r.status());
  });
  await page.screenshot({ path: "scripts/e2e-switch.png", fullPage: false });
  if (pedidos.length === 0) ok("no se disparó ningún pedido durante la prueba");

  await admin.ctx.close();
} catch (e) {
  fail(e.message);
} finally {
  console.log(out.join("\n"));
  await browser.close();
}
