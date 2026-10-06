// Las direcciones se guardan como un blob con etiquetas: "Calle: X, Num: #Y, Col: Z, Ref: W".
// Google geocodifica las etiquetas y las palabras del "Ref:" como nombres de lugar
// (ej. "palma afuera" → Palma, Illes Balears, España), así que hay que reconstruir
// la dirección en formato mexicano plano antes de mandarla a Maps.
export function geoAddress(bk) {
  const addr = bk.address || "";
  const tail = [bk.city, bk.state, "México"].filter(Boolean);

  const calle = addr.match(/Calle:\s*([^,]+)/i)?.[1]?.trim();
  const num = addr.match(/N[uú]m(?:ero)?:\s*#?\s*([^,]+)/i)?.[1]?.trim();
  const col = addr.match(/Col(?:onia)?:\s*([^,]+)/i)?.[1]?.trim();

  if (calle || col) {
    const street = [calle, num].filter(Boolean).join(" ");
    return [street, col, ...tail].filter(Boolean).join(", ");
  }

  const plain = addr.replace(/,?\s*Ref:.*$/i, "").trim();
  return [plain, ...tail].filter(Boolean).join(", ");
}
