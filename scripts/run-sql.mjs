import { readFileSync } from "node:fs";
import { Client } from "pg";

const file = process.argv[2];
if (!file) {
  console.error("Uso: node scripts/run-sql.mjs <ruta-al-archivo.sql>");
  process.exit(1);
}

const sql = readFileSync(file, "utf8");

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Falta DATABASE_URL en .env.local");
  process.exit(1);
}

const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log(`OK: ${file} aplicado correctamente.`);
} catch (err) {
  console.error(`ERROR aplicando ${file}:`, err.message);
  process.exit(1);
} finally {
  await client.end();
}
