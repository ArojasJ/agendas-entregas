import crypto from "crypto";

const SECRET = process.env.PANEL_TOKEN_SECRET || "agenda_super_secreta_123";

function sign(body) {
  return crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
}

// El token es `datos.firma`. Antes era base64(datos + "|" + SECRETO), que al no ser
// cifrado dejaba el secreto legible para cualquiera con un token: bastaba decodificarlo
// para fabricarse uno con role admin. El HMAC permite verificar sin exponer el secreto.
export function signPanelToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function getPanelSession(req) {
  const token = req.headers.get("x-panel-token");
  if (!token) return null;

  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  const expected = Buffer.from(sign(body));
  const received = Buffer.from(sig);
  if (expected.length !== received.length) return null;
  if (!crypto.timingSafeEqual(expected, received)) return null;

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
