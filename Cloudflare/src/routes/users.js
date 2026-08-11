import { all, one, run, nowIso } from "../lib/db.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { effectiveCompanyScope } from "../lib/session.js";
import { json, badRequest, forbidden, notFound, conflict } from "../lib/http.js";

function requireAdmin(session) {
  if (!session || session.role !== "admin") return forbidden("Admin access required");
  return null;
}
function requireSpecificCompany(scope) {
  if (scope.all) return badRequest("Select a specific company first");
  return null;
}

export async function list(session, env, url) {
  const err = requireAdmin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const page = Math.max(1, parseInt(url?.searchParams?.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(10, parseInt(url?.searchParams?.get("pageSize") || "10", 10)));
  const companyIdFilter = scope.all ? url?.searchParams?.get("companyId") : null;

  if (scope.all) {
    let where = `1=1`;
    const params = [];
    if (companyIdFilter) { where += ` AND u.company_id = ?`; params.push(Number(companyIdFilter)); }
    const rows = await all(
      env.DB,
      `SELECT u.pk, u.id, u.name, u.role, u.active, u.is_root, u.company_id, u.lang_override, c.name AS company_name
       FROM users u LEFT JOIN companies c ON c.id = u.company_id WHERE ${where} ORDER BY u.created_at DESC`, ...params
    );
    const total = rows.length;
    const start = (page - 1) * pageSize;
    return json({ rows: rows.slice(start, start + pageSize), total, page, pageSize });
  }
  const rows = await all(
    env.DB,
    `SELECT pk, id, name, role, active, is_root, lang_override FROM users WHERE company_id = ? ORDER BY created_at DESC`,
    scope.companyId
  );
  const total = rows.length;
  const start = (page - 1) * pageSize;
  return json({ rows: rows.slice(start, start + pageSize), total, page, pageSize });
}

export async function create(session, env, request) {
  const err = requireAdmin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const scopeErr = requireSpecificCompany(scope);
  if (scopeErr) return scopeErr;

  const body = await request.json().catch(() => null);
  if (!body || !body.id || !body.name || !body.password || !body.role) {
    return badRequest("id, name, password, role are all required");
  }
  if (!["admin", "employee", "viewer"].includes(body.role)) return badRequest("role must be 'admin', 'employee', or 'viewer'");

  const existing = await one(env.DB, `SELECT pk FROM users WHERE id = ? COLLATE NOCASE AND company_id = ?`, body.id, scope.companyId);
  if (existing) return conflict("That User ID is already taken in this company");

  const hash = await hashPassword(body.password);
  const result = await run(
    env.DB,
    `INSERT INTO users (id, company_id, name, password_hash, role, active, is_root, lang_override, created_at)
     VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`,
    body.id, scope.companyId, body.name, hash, body.role, body.langOverride || null, nowIso()
  );
  return json({ pk: result.meta.last_row_id }, 201);
}

async function loadOwnedUser(session, env, pk) {
  const user = await one(env.DB, `SELECT * FROM users WHERE pk = ?`, pk);
  if (!user) return { error: notFound("User not found") };
  if (user.is_root) return { error: forbidden("Only root can edit its own account") };
  if (!session.isRoot && user.company_id !== session.companyId) return { error: forbidden("Not your company's user") };
  return { user };
}

export async function update(session, env, pk, request) {
  const err = requireAdmin(session);
  if (err) return err;
  const { user, error } = await loadOwnedUser(session, env, pk);
  if (error) return error;

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid body");

  // "At least one active admin must remain" — evaluated per company, spec §6.3
  if (body.active === false || body.role === "employee" || body.role === "viewer") {
    if (user.role === "admin" && user.active) {
      const otherActiveAdmins = await one(
        env.DB,
        `SELECT COUNT(*) AS n FROM users WHERE company_id = ? AND role = 'admin' AND active = 1 AND pk != ?`,
        user.company_id, pk
      );
      if (otherActiveAdmins.n === 0) return badRequest("At least one active admin must remain in this company");
    }
  }

  let passwordHash = user.password_hash;
  if (body.password) passwordHash = await hashPassword(body.password);

  // langOverride is explicit-set, not COALESCE'd: an empty string means
  // "clear it back to company default", which COALESCE can't express.
  const langOverrideProvided = Object.prototype.hasOwnProperty.call(body, "langOverride");
  const newLangOverride = langOverrideProvided ? (body.langOverride || null) : user.lang_override;

  await run(
    env.DB,
    `UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), active = COALESCE(?, active),
     lang_override = ?, password_hash = ? WHERE pk = ?`,
    body.name ?? null, body.role ?? null, body.active === undefined ? null : (body.active ? 1 : 0),
    newLangOverride, passwordHash, pk
  );
  return json({ ok: true });
}

export async function remove(session, env, pk) {
  const err = requireAdmin(session);
  if (err) return err;
  const { user, error } = await loadOwnedUser(session, env, pk);
  if (error) return error;

  if (user.role === "admin") {
    const otherActiveAdmins = await one(
      env.DB,
      `SELECT COUNT(*) AS n FROM users WHERE company_id = ? AND role = 'admin' AND active = 1 AND pk != ?`,
      user.company_id, pk
    );
    if (otherActiveAdmins.n === 0) return badRequest("At least one active admin must remain in this company");
  }
  await run(env.DB, `DELETE FROM users WHERE pk = ?`, pk);
  return json({ ok: true });
}

export async function updateMyProfile(session, env, request) {
  if (!session) return forbidden("Login required");
  const body = await request.json().catch(() => null);
  if (!body || !body.name) return badRequest("name is required");
  await run(env.DB, `UPDATE users SET name = ? WHERE pk = ?`, body.name, session.pk);
  return json({ ok: true });
}

const RECOVERY_Q1 = "Favourite Colour";
const RECOVERY_Q2 = "Favourite Place";

export async function getMyRecoveryQuestions(session, env) {
  if (!session || session.role !== "admin") return forbidden("Admin login required");
  const row = await one(env.DB, `SELECT question1, question2 FROM admin_recovery WHERE user_pk = ?`, session.pk);
  return json(row || { question1: RECOVERY_Q1, question2: RECOVERY_Q2 });
}

export async function setMyRecoveryQuestions(session, env, request) {
  if (!session || session.role !== "admin") return forbidden("Admin login required");
  const body = await request.json().catch(() => null);
  if (!body || !body.answer1 || !body.answer2) {
    return badRequest("answer1 and answer2 are required");
  }
  const [hash1, hash2] = await Promise.all([hashPassword(body.answer1.toLowerCase().trim()), hashPassword(body.answer2.toLowerCase().trim())]);
  await run(
    env.DB,
    `INSERT INTO admin_recovery (user_pk, question1, answer1_hash, question2, answer2_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_pk) DO UPDATE SET answer1_hash=excluded.answer1_hash, answer2_hash=excluded.answer2_hash, updated_at=excluded.updated_at`,
    session.pk, RECOVERY_Q1, hash1, RECOVERY_Q2, hash2, nowIso()
  );
  return json({ ok: true });
}

// Root's step-up password change — requires answering its own two security
// questions first, separate from the logged-out recovery flow (§6.4).
export async function rootChangePasswordVerified(session, env, request) {
  if (!session || !session.isRoot) return forbidden("Root only");
  const body = await request.json().catch(() => null);
  if (!body || !body.answer1 || !body.answer2 || !body.newPassword) {
    return badRequest("answer1, answer2, newPassword are all required");
  }
  const recovery = await one(env.DB, `SELECT * FROM admin_recovery WHERE user_pk = ?`, session.pk);
  if (!recovery) return badRequest("No security questions set up yet");
  const ok1 = await verifyPassword(body.answer1.toLowerCase().trim(), recovery.answer1_hash);
  const ok2 = await verifyPassword(body.answer2.toLowerCase().trim(), recovery.answer2_hash);
  if (!ok1 || !ok2) return badRequest("Security question answers did not match");
  const newHash = await hashPassword(body.newPassword);
  await run(env.DB, `UPDATE users SET password_hash = ? WHERE pk = ?`, newHash, session.pk);
  return json({ ok: true });
}

// Logged-out recovery for root itself (no company slug involved).
export async function rootRecoveryQuestions(env) {
  const rootUser = await one(env.DB, `SELECT pk FROM users WHERE is_root = 1 LIMIT 1`);
  if (!rootUser) return notFound("Root account not found");
  const recovery = await one(env.DB, `SELECT question1, question2 FROM admin_recovery WHERE user_pk = ?`, rootUser.pk);
  if (!recovery) return notFound("Root has not set up security questions yet — see the README's break-glass recovery option instead");
  return json(recovery);
}

export async function rootRecoveryReset(env, request) {
  const rootUser = await one(env.DB, `SELECT * FROM users WHERE is_root = 1 LIMIT 1`);
  if (!rootUser) return notFound("Root account not found");
  const recovery = await one(env.DB, `SELECT * FROM admin_recovery WHERE user_pk = ?`, rootUser.pk);
  if (!recovery) return notFound("Root has not set up security questions yet");
  const body = await request.json().catch(() => null);
  if (!body || !body.answer1 || !body.answer2 || !body.newPassword) return badRequest("answer1, answer2, newPassword required");
  const ok1 = await verifyPassword(body.answer1.toLowerCase().trim(), recovery.answer1_hash);
  const ok2 = await verifyPassword(body.answer2.toLowerCase().trim(), recovery.answer2_hash);
  if (!ok1 || !ok2) return badRequest("Security question answers did not match");
  const newHash = await hashPassword(body.newPassword);
  await run(env.DB, `UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE pk = ?`, newHash, rootUser.pk);
  return json({ ok: true });
}
export async function recoveryQuestions(env, companySlug, userId) {
  const company = await one(env.DB, `SELECT id FROM companies WHERE slug = ? COLLATE NOCASE AND active = 1`, companySlug);
  if (!company) return notFound("Unknown company");
  const user = await one(env.DB, `SELECT pk, role, is_root FROM users WHERE id = ? COLLATE NOCASE AND company_id = ?`, userId, company.id);
  if (!user || user.is_root || user.role !== "admin") return notFound("No recovery available for this account");
  const recovery = await one(env.DB, `SELECT question1, question2 FROM admin_recovery WHERE user_pk = ?`, user.pk);
  if (!recovery) return notFound("No security questions set up for this account");
  return json(recovery);
}

export async function recoveryReset(env, companySlug, userId, request) {
  const company = await one(env.DB, `SELECT id FROM companies WHERE slug = ? COLLATE NOCASE AND active = 1`, companySlug);
  if (!company) return notFound("Unknown company");
  const user = await one(env.DB, `SELECT pk, role, is_root FROM users WHERE id = ? COLLATE NOCASE AND company_id = ?`, userId, company.id);
  if (!user || user.is_root || user.role !== "admin") return notFound("No recovery available for this account");
  const recovery = await one(env.DB, `SELECT * FROM admin_recovery WHERE user_pk = ?`, user.pk);
  if (!recovery) return notFound("No security questions set up for this account");

  const body = await request.json().catch(() => null);
  if (!body || !body.answer1 || !body.answer2 || !body.newPassword) return badRequest("answer1, answer2, newPassword required");
  const ok1 = await verifyPassword(body.answer1.toLowerCase().trim(), recovery.answer1_hash);
  const ok2 = await verifyPassword(body.answer2.toLowerCase().trim(), recovery.answer2_hash);
  if (!ok1 || !ok2) return badRequest("Security question answers did not match");
  const newHash = await hashPassword(body.newPassword);
  await run(env.DB, `UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE pk = ?`, newHash, user.pk);
  return json({ ok: true });
}
