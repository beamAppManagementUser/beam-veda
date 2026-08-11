import { one, run, nowIso } from "../lib/db.js";
import { verifyPassword } from "../lib/password.js";
import { createSessionCookie, clearSessionCookie, readSession } from "../lib/session.js";
import { json, badRequest, unauthorized } from "../lib/http.js";

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
// IP-level throttle (recommendation, implemented) — per-account lockout
// alone doesn't stop someone trying many different accounts/companies from
// one source. This is a cheap complement to it, not a replacement for
// Cloudflare's own dashboard rate-limiting rules (see HOSTING_STEPS.md),
// which should still be set up for real protection at the edge.
const IP_MAX_ATTEMPTS = 20;
const IP_WINDOW_MS = 15 * 60 * 1000;

async function checkIpThrottle(env, request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const cutoff = new Date(Date.now() - IP_WINDOW_MS).toISOString();
  // Opportunistic cleanup of old rows — cheap since indexed, avoids unbounded growth.
  await run(env.DB, `DELETE FROM login_attempts WHERE attempted_at < ?`, new Date(Date.now() - 60 * 60 * 1000).toISOString());
  const row = await one(env.DB, `SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND attempted_at >= ?`, ip, cutoff);
  return { ip, throttled: row.n >= IP_MAX_ATTEMPTS };
}
async function recordIpAttempt(env, ip) {
  await run(env.DB, `INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)`, ip, nowIso());
}

export async function login(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.id || !body.password) return badRequest("id and password are required");
  const { id, password, companySlug } = body;

  const { ip, throttled } = await checkIpThrottle(env, request);
  if (throttled) return unauthorized("Too many login attempts from this network. Try again later.");

  let user;
  if (companySlug) {
    const company = await one(env.DB, `SELECT * FROM companies WHERE slug = ? COLLATE NOCASE AND active = 1`, companySlug);
    if (!company) { await recordIpAttempt(env, ip); return unauthorized("Invalid company, ID, or password"); }
    user = await one(env.DB, `SELECT * FROM users WHERE id = ? COLLATE NOCASE AND company_id = ?`, id, company.id);
  } else {
    // root login path (no companySlug)
    user = await one(env.DB, `SELECT * FROM users WHERE id = ? COLLATE NOCASE AND is_root = 1`, id);
  }

  if (!user || !user.active) { await recordIpAttempt(env, ip); return unauthorized("Invalid company, ID, or password"); }

  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    return unauthorized("Account temporarily locked. Try again later.");
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    await recordIpAttempt(env, ip);
    const attempts = (user.failed_attempts || 0) + 1;
    const lockedUntil = attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null;
    await run(env.DB, `UPDATE users SET failed_attempts = ?, locked_until = ? WHERE pk = ?`, attempts, lockedUntil, user.pk);
    return unauthorized("Invalid company, ID, or password");
  }

  await run(env.DB, `UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE pk = ?`, user.pk);

  const session = {
    pk: user.pk,
    id: user.id,
    name: user.name,
    role: user.role,
    companyId: user.company_id,
    isRoot: !!user.is_root,
    selectedCompanyId: null, // root only: null = "All" until root picks one
  };
  const cookie = await createSessionCookie(env.SESSION_SECRET, session);

  return json(
    { id: user.id, name: user.name, role: user.role, isRoot: !!user.is_root, companyId: user.company_id },
    200,
    { "Set-Cookie": cookie }
  );
}

export async function logout() {
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie() });
}

export async function me(request, env) {
  const session = await readSession(env.SESSION_SECRET, request);
  if (!session) return unauthorized("Not logged in");
  let companyName = null, companySlug = null, companyContact = null, hasLogo = false, companyLangSecondary = null;
  const lookupCompanyId = session.companyId || session.selectedCompanyId; // covers both a company user AND root-with-a-company-selected
  if (lookupCompanyId) {
    const company = await one(env.DB, `SELECT name, slug, contact, logo_key, lang_secondary FROM companies WHERE id = ?`, lookupCompanyId);
    if (company) {
      companyName = company.name; companySlug = company.slug; companyContact = company.contact;
      hasLogo = !!company.logo_key; companyLangSecondary = company.lang_secondary;
    }
  }
  let myLangOverride = null;
  if (session.pk && !session.isRoot) {
    const me = await one(env.DB, `SELECT lang_override FROM users WHERE pk = ?`, session.pk);
    myLangOverride = me?.lang_override || null;
  }
  return json({
    pk: session.pk,
    id: session.id,
    name: session.name,
    role: session.role,
    isRoot: session.isRoot,
    companyId: session.companyId,
    companyName,
    companySlug,
    companyContact,
    hasLogo,
    companyLangSecondary,
    myLangOverride,
    selectedCompanyId: session.selectedCompanyId,
  });
}
