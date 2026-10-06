import { readFileSync } from "node:fs";
import { Client } from "pg";

const file = process.argv[2];
const sql = readFileSync(file, "utf8");
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const res = await client.query(sql);
  console.table(res.rows);
} catch (err) {
  console.error("ERROR:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
