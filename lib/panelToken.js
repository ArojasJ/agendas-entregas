// Lectura del token en el navegador, donde no hay forma de verificar la firma.
// Solo sirve para pintar la UI — toda decisión real se valida en el servidor.
// Vive aparte de panelAuth.js para no arrastrar `crypto` de Node al bundle del cliente.
export function decodePanelTokenUnsafe(token) {
  try {
    const [body] = String(token).split(".");
    return JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}
