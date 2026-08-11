import { all, one, run } from "../lib/db.js";
import { effectiveCompanyScope } from "../lib/session.js";
import { json, badRequest, forbidden, notFound } from "../lib/http.js";

function requireLogin(session) {
  if (!session) return forbidden("Login required");
  return null;
}
function requireAdmin(session) {
  if (!session || session.role !== "admin") return forbidden("Admin access required");
  return null;
}
function requireSpecificCompany(scope) {
  if (scope.all) return badRequest("Select a specific company first");
  return null;
}

export async function get(session, env) {
  const err = requireLogin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const scopeErr = requireSpecificCompany(scope);
  if (scopeErr) return scopeErr;

  const fields = await all(env.DB, `SELECT field_key, label, use_lookup FROM lookup_fields WHERE company_id = ?`, scope.companyId);
  const values = await all(env.DB, `SELECT field_key, value FROM lookup_values WHERE company_id = ? ORDER BY value`, scope.companyId);
  const byField = {};
  for (const f of fields) byField[f.field_key] = { label: f.label, useLookup: !!f.use_lookup, values: [] };
  for (const v of values) if (byField[v.field_key]) byField[v.field_key].values.push(v.value);
  return json(byField);
}

export async function setUseLookup(session, env, fieldKey, request) {
  const err = requireAdmin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const scopeErr = requireSpecificCompany(scope);
  if (scopeErr) return scopeErr;

  const body = await request.json().catch(() => null);
  if (!body || typeof body.useLookup !== "boolean") return badRequest("useLookup (boolean) is required");
  const result = await run(
    env.DB,
    `UPDATE lookup_fields SET use_lookup = ? WHERE company_id = ? AND field_key = ?`,
    body.useLookup ? 1 : 0, scope.companyId, fieldKey
  );
  if (result.meta.changes === 0) return notFound("Unknown field");
  return json({ ok: true });
}

export async function addValue(session, env, fieldKey, request) {
  const err = requireAdmin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const scopeErr = requireSpecificCompany(scope);
  if (scopeErr) return scopeErr;

  const body = await request.json().catch(() => null);
  if (!body || !body.value) return badRequest("value is required");
  const field = await one(env.DB, `SELECT field_key FROM lookup_fields WHERE company_id = ? AND field_key = ?`, scope.companyId, fieldKey);
  if (!field) return notFound("Unknown field");
  await run(
    env.DB,
    `INSERT OR IGNORE INTO lookup_values (company_id, field_key, value) VALUES (?, ?, ?)`,
    scope.companyId, fieldKey, body.value
  );
  return json({ ok: true }, 201);
}

export async function removeValue(session, env, fieldKey, value) {
  const err = requireAdmin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const scopeErr = requireSpecificCompany(scope);
  if (scopeErr) return scopeErr;

  await run(env.DB, `DELETE FROM lookup_values WHERE company_id = ? AND field_key = ? AND value = ?`, scope.companyId, fieldKey, value);
  return json({ ok: true });
}
