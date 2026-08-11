// Stateless, signed, httpOnly cookie sessions — replaces the spec's
// express-session + connect-sqlite3 store. The session payload itself
// (user pk, company_id, role, isRoot, selectedCompanyId for root,
// expiry) is carried in the cookie, HMAC-signed with SESSION_SECRET so
// it can't be tampered with client-side. Nothing is stored server-side,
// which is what makes this work statelessly on Workers.

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours, per spec §6.1

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlEncode(obj) {
  return btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4);
  return JSON.parse(atob(padded));
}

export async function createSessionCookie(secret, payload) {
  const body = { ...payload, exp: Date.now() + SESSION_TTL_MS };
  const encoded = b64urlEncode(body);
  const sig = await hmac(secret, encoded);
  const value = `${encoded}.${sig}`;
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `bv_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return `bv_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function readSession(secret, request) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const match = cookieHeader.match(/bv_session=([^;]+)/);
  if (!match) return null;
  const [encoded, sig] = match[1].split(".");
  if (!encoded || !sig) return null;
  const expectedSig = await hmac(secret, encoded);
  if (sig !== expectedSig) return null;
  let payload;
  try {
    payload = b64urlDecode(encoded);
  } catch {
    return null;
  }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

// The single most important rule in the system (spec §6.2) — unchanged logic,
// just reading from the cookie-session payload instead of req.session.
export function effectiveCompanyScope(session) {
  if (!session) return { companyId: null, all: false };
  if (!session.isRoot) return { companyId: session.companyId };
  return session.selectedCompanyId == null
    ? { companyId: null, all: true }
    : { companyId: session.selectedCompanyId };
}
