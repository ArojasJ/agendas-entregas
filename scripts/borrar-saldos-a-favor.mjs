import { Client } from "pg";
import { writeFileSync } from "node:fs";

// Se quitó el saldo a favor del sistema: lo que una clienta pagó de más al
// cancelársele un apartado se le devuelve en efectivo, no se le apunta.
//
// Esto borra los saldos que quedaban. Antes de borrarlos los guarda en un archivo,
// porque es lo único que queda de ese dinero: la tabla no lleva historial y una vez
// en cero no hay de dónde sacarlo.
//
// El archivo lleva nombres y usuarios de clientas, así que NO se sube al repositorio.
//
// Sin argumentos solo enseña el plan. Con --aplicar lo escribe.

const APLICAR = process.argv.includes("--aplicar");
const RESPALDO = "scripts/saldos-a-favor-respaldo.json";

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  await db.connect();

  const { rows } = await db.query(`
    select id, name, instagram, phone, saldo_favor
    from clients where coalesce(saldo_favor,0) <> 0
    order by saldo_favor desc`);

  if (rows.length === 0) {
    console.log("No queda ninguna clienta con saldo a favor.");
  } else {
    const total = rows.reduce((s, r) => s + Number(r.saldo_favor), 0);
    const grandes = rows.filter((r) => Number(r.saldo_favor) >= 50);
    const chicos = rows.length - grandes.length;

    console.log(`Clientas con saldo a favor: ${rows.length}   total $${total.toFixed(2)}\n`);
    console.log(`Las de $50 o más (${grandes.length}) — éstas son las que querrás revisar:`);
    for (const r of grandes)
      console.log(`   $${String(Number(r.saldo_favor).toFixed(2)).padStart(9)}  ${(r.instagram || r.name || "").padEnd(26)} ${r.phone || ""}`);
    console.log(`\nY ${chicos} más por debajo de $50, casi todas de centavos: $${
      rows.filter((r) => Number(r.saldo_favor) < 50).reduce((s, r) => s + Number(r.saldo_favor), 0).toFixed(2)} en total.`);

    if (APLICAR) {
      writeFileSync(RESPALDO, JSON.stringify(
        { borradoEl: new Date().toISOString(), total, clientas: rows }, null, 2), "utf8");
      console.log(`\nRespaldo guardado en ${RESPALDO}`);

      await db.query(`update clients set saldo_favor = 0 where coalesce(saldo_favor,0) <> 0`);
      const { rows: q } = await db.query(
        `select count(*)::int n from clients where coalesce(saldo_favor,0) <> 0`);
      console.log(`Saldos borrados. Quedan ${q[0].n} clientas con saldo.`);
    } else {
      console.log("\nEsto es solo el plan. Para borrarlos: --aplicar");
    }
  }
} finally {
  await db.end();
}
