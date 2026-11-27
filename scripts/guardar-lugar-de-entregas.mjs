import { Client } from "pg";
import { ubicarParada } from "../lib/ruta/coordenadas.js";
import { geoAddress } from "../lib/address.js";

// Dejar guardado el lugar de las entregas que YA están agendadas.
//
// El código nuevo las resuelve solo, la primera vez que alguien abre la ruta. Pero esa
// primera vez es el repartidor, en la calle, con el celular: seguir el link corto de
// cada pin es un viaje a Google por parada. Corriendo esto antes, mañana el mapa abre
// instantáneo y con los pines donde van.
//
// Solo escribe donde está vacío. Correrlo dos veces no hace nada la segunda.

const APLICAR = process.argv.includes("--aplicar");
// `::date` llega como Date de JavaScript: String() daria "Fri Nov 27 ...".
const dia = (d) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;

const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

const hoy = new Date().toISOString().slice(0, 10);
const { rows } = await db.query(
  `select id, date, type, instagram, "fullName", address, city, state, location_url, lat, lng
     from bookings
    where date >= $1
      and type in ('domicilio','parada_paqueteria')
      and (lat is null or lng is null)
    order by date, "createdAt"`, [hoy]);

console.log(`Entregas agendadas de hoy (${hoy}) en adelante sin lugar guardado: ${rows.length}\n`);
if (!rows.length) { await db.end(); process.exit(0); }

const cuenta = { pin: 0, direccion: 0, ninguna: 0 };

for (const bk of rows) {
  const u = await ubicarParada({ ...bk, addressText: geoAddress({ ...bk, lat: null, lng: null }) }, apiKey);
  cuenta[u.fuente] = (cuenta[u.fuente] || 0) + 1;
  const quien = bk.instagram ? "@" + String(bk.instagram).replace(/^@/, "") : bk.fullName;
  const donde = u.lat != null ? `${u.lat.toFixed(5)}, ${u.lng.toFixed(5)}` : "— no se pudo ubicar";
  console.log(`${dia(bk.date)}  ${String(quien).padEnd(22).slice(0, 22)}  ${u.fuente.padEnd(10)}  ${donde}`);

  if (APLICAR && u.lat != null) {
    await db.query("update bookings set lat=$1, lng=$2 where id=$3", [u.lat, u.lng, bk.id]);
  }
}

console.log(`\nDel pin de la clienta: ${cuenta.pin || 0}   Por la dirección: ${cuenta.direccion || 0}   Sin ubicar: ${cuenta.ninguna || 0}`);
console.log(APLICAR ? "\nGuardado." : "\nNada escrito. Para guardarlo: node scripts/guardar-lugar-de-entregas.mjs --aplicar");
await db.end();
