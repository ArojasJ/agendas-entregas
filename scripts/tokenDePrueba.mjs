import crypto from "crypto";

// Las pruebas firman su propia sesión en vez de iniciarla con usuario y contraseña:
// así no dependen de credenciales reales en el entorno, que al faltar devolvían 401
// y hacían fallar pruebas de código que estaba bien.
const SECRET = process.env.PANEL_TOKEN_SECRET || "agenda_super_secreta_123";

export function tokenDePrueba(role = "admin", displayName = "Prueba Admin") {
  const payload = { role, username: "prueba_" + role, displayName };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}
