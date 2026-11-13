import { Client } from "pg";
import { writeFileSync } from "node:fs";

// Los productos vendidos a una clienta que no están entregados y que no están en
// ningún lado: ni en caja, ni en estante, ni en un paquete armado. Es lo único que
// falta por ubicar para saber dónde está cada cosa.
//
// Sale en CSV para abrirlo en Excel e irlo palomeando contra la bodega.

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();

  const filas = (await db.query(`
    select c.instagram, c.name clienta, coalesce(c.box_1, '') caja_en_su_ficha,
           pr.name producto, i.quantity cantidad,
           s.created_at::date comprada,
           (current_date - s.created_at::date) dias,
           case when s.total - s.down_payment
                     - coalesce((select sum(p.amount) from payments p where p.sale_id = s.id), 0) > 0
                then 'debe' else 'pagado' end pago,
           s.id venta
    from sale_items i
    join sales s on s.id = i.sale_id
    join products pr on pr.id = i.product_id
    join clients c on c.id = s.client_id
    where i.delivery_status <> 'delivered'
      and s.status not in ('cancelled','pending_payment')
      and i.paquete_booking_id is null
      and s.ubicacion is null
    order by c.name, s.created_at`)).rows;

  const esc = (v) => {
    const t = String(v ?? "").replace(/"/g, '""');
    return /[",;\n]/.test(t) ? `"${t}"` : t;
  };

  const encabezado = [
    "Usuario", "Clienta", "Caja en su ficha", "Producto", "Cantidad",
    "Comprado", "Días", "Pago", "Venta",
  ];
  const lineas = [encabezado.join(",")];
  for (const f of filas) {
    lineas.push([
      f.instagram, f.clienta.trim(), f.caja_en_su_ficha, f.producto.trim(), f.cantidad,
      f.comprada.toISOString().slice(0, 10), f.dias, f.pago, f.venta,
    ].map(esc).join(","));
  }

  // Con BOM para que Excel respete los acentos.
  const archivo = "scripts/productos-sin-ubicar.csv";
  writeFileSync(archivo, "﻿" + lineas.join("\r\n"), "utf8");

  const clientas = new Set(filas.map((f) => f.instagram)).size;
  const conCaja = filas.filter((f) => f.caja_en_su_ficha).length;
  console.log(`${filas.length} productos de ${clientas} clientas`);
  console.log(`  ${conCaja} de clientas que SÍ tienen caja anotada`);
  console.log(`  ${filas.length - conCaja} sin ninguna pista`);
  console.log(`archivo: ${archivo}`);
} finally {
  await db.end();
}
