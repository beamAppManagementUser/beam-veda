import { all, one, run } from "../lib/db.js";
import { effectiveCompanyScope } from "../lib/session.js";
import { withBalance } from "../lib/balance.js";
import { deletePhoto } from "../lib/photos.js";
import { json, badRequest, forbidden } from "../lib/http.js";

function requireAdmin(session) {
  if (!session || session.role !== "admin") return forbidden("Admin access required");
  return null;
}

function resolveCompanyId(scope, url, body = null) {
  if (!scope.all) return scope.companyId;
  const id = url?.searchParams?.get("companyId") || body?.companyId;
  return id ? Number(id) : null;
}

async function closedEntriesBeforeCutoff(env, companyId, cutoff) {
  const rows = await all(env.DB, `SELECT * FROM inward_entries WHERE company_id = ?`, companyId);
  const withBalances = await Promise.all(rows.map((r) => withBalance(env.DB, r)));
  // Housekeeping only touches closed entries whose most recent shipment
  // date is before the cutoff — matches the spec's wording exactly.
  return withBalances.filter((r) => r.status === "closed" && r.lastShipmentDate && r.lastShipmentDate <= cutoff);
}

export async function stats(session, env, url) {
  const err = requireAdmin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const companyId = resolveCompanyId(scope, url);
  if (!companyId) return badRequest("companyId is required");
  const total = await one(env.DB, `SELECT COUNT(*) AS n FROM inward_entries WHERE company_id = ?`, companyId);
  const withPhotos = await one(env.DB, `SELECT COUNT(*) AS n FROM inward_entries WHERE company_id = ? AND photo_key IS NOT NULL`, companyId);
  const rows = await all(env.DB, `SELECT * FROM inward_entries WHERE company_id = ?`, companyId);
  const closed = (await Promise.all(rows.map((r) => withBalance(env.DB, r)))).filter((r) => r.status === "closed").length;
  return json({ total: total.n, closed, withPhotos: withPhotos.n });
}

export async function clearPhotos(session, env, request, url) {
  const err = requireAdmin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const body = await request.json().catch(() => null);
  if (!body || !body.cutoff) return badRequest("cutoff is required");
  const companyId = resolveCompanyId(scope, url, body);
  if (!companyId) return badRequest("companyId is required");
  const result = await doClearPhotos(env, companyId, body.cutoff);
  return json({ ok: true, ...result });
}

export async function doClearPhotos(env, companyId, cutoff) {
  const targets = await closedEntriesBeforeCutoff(env, companyId, cutoff);
  let cleared = 0;
  for (const entry of targets) {
    if (entry.photo_key) { await deletePhoto(env, entry.photo_key); await run(env.DB, `UPDATE inward_entries SET photo_key = NULL WHERE id = ?`, entry.id); cleared++; }
    const shipments = await all(env.DB, `SELECT id, photo_key FROM outward_shipments WHERE inward_id = ? AND photo_key IS NOT NULL`, entry.id);
    for (const s of shipments) { await deletePhoto(env, s.photo_key); await run(env.DB, `UPDATE outward_shipments SET photo_key = NULL WHERE id = ?`, s.id); }
  }
  return { entriesAffected: targets.length, photosCleared: cleared };
}

export async function deleteOld(session, env, request, url) {
  const err = requireAdmin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const body = await request.json().catch(() => null);
  if (!body || !body.cutoff) return badRequest("cutoff is required");
  const companyId = resolveCompanyId(scope, url, body);
  if (!companyId) return badRequest("companyId is required");
  const result = await doDeleteOld(env, companyId, body.cutoff);
  return json({ ok: true, ...result });
}

export async function doDeleteOld(env, companyId, cutoff) {
  const targets = await closedEntriesBeforeCutoff(env, companyId, cutoff);
  for (const entry of targets) {
    const shipments = await all(env.DB, `SELECT id, photo_key FROM outward_shipments WHERE inward_id = ?`, entry.id);
    for (const s of shipments) { if (s.photo_key) await deletePhoto(env, s.photo_key); }
    await run(env.DB, `DELETE FROM outward_shipments WHERE inward_id = ?`, entry.id);
    if (entry.photo_key) await deletePhoto(env, entry.photo_key);
    await run(env.DB, `DELETE FROM inward_entries WHERE id = ?`, entry.id);
  }
  return { entriesDeleted: targets.length };
}

// ---- Root-only bulk operations across selected companies (item 10) ----
export async function bulkClearPhotos(session, env, request) {
  if (!session || !session.isRoot) return forbidden("Root access required");
  const body = await request.json().catch(() => null);
  if (!body || !body.cutoff) return badRequest("cutoff is required");
  const companyIds = body.companyIds && body.companyIds.length ? body.companyIds : (await all(env.DB, `SELECT id FROM companies`)).map((c) => c.id);
  const perCompany = [];
  for (const id of companyIds) perCompany.push({ companyId: id, ...(await doClearPhotos(env, id, body.cutoff)) });
  return json({ ok: true, results: perCompany });
}

export async function bulkDeleteOld(session, env, request) {
  if (!session || !session.isRoot) return forbidden("Root access required");
  const body = await request.json().catch(() => null);
  if (!body || !body.cutoff) return badRequest("cutoff is required");
  const companyIds = body.companyIds && body.companyIds.length ? body.companyIds : (await all(env.DB, `SELECT id FROM companies`)).map((c) => c.id);
  const perCompany = [];
  for (const id of companyIds) perCompany.push({ companyId: id, ...(await doDeleteOld(env, id, body.cutoff)) });
  return json({ ok: true, results: perCompany });
}

export async function getRetentionPolicy(session, env, url) {
  const err = requireAdmin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const companyId = resolveCompanyId(scope, url);
  if (!companyId) return badRequest("companyId is required");
  const row = await one(env.DB, `SELECT * FROM retention_policy WHERE company_id = ?`, companyId);
  return json(row || { company_id: companyId, enabled: 0, completed_retention_days: 30, all_retention_days: 90 });
}

export async function setRetentionPolicy(session, env, request, url) {
  const err = requireAdmin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid body");
  const companyId = resolveCompanyId(scope, url, body);
  if (!companyId) return badRequest("companyId is required");
  await run(
    env.DB,
    `INSERT INTO retention_policy (company_id, enabled, completed_retention_days, all_retention_days)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(company_id) DO UPDATE SET enabled=excluded.enabled,
       completed_retention_days=excluded.completed_retention_days, all_retention_days=excluded.all_retention_days`,
    companyId, body.enabled ? 1 : 0, body.completedRetentionDays ?? 30, body.allRetentionDays ?? 90
  );
  return json({ ok: true });
}

// Called from the weekly Cron Trigger (src/index.js scheduled()) — sweeps
// every company with auto-purge enabled. Not exposed as an HTTP route.
export async function autoPurgeSweep(env) {
  const policies = await all(env.DB, `SELECT * FROM retention_policy WHERE enabled = 1`);
  let totalDeleted = 0;
  for (const p of policies) {
    const cutoff = new Date(Date.now() - p.completed_retention_days * 86400000).toISOString().slice(0, 10);
    const targets = await closedEntriesBeforeCutoff(env, p.company_id, cutoff);
    for (const entry of targets) {
      const shipments = await all(env.DB, `SELECT id, photo_key FROM outward_shipments WHERE inward_id = ?`, entry.id);
      for (const s of shipments) { if (s.photo_key) await deletePhoto(env, s.photo_key); }
      await run(env.DB, `DELETE FROM outward_shipments WHERE inward_id = ?`, entry.id);
      if (entry.photo_key) await deletePhoto(env, entry.photo_key);
      await run(env.DB, `DELETE FROM inward_entries WHERE id = ?`, entry.id);
      totalDeleted++;
    }
  }
  await run(env.DB, `INSERT INTO backup_runs (kind, company_id, status, detail, ran_at) VALUES ('auto_purge', NULL, 'success', ?, ?)`,
    `${totalDeleted} entries purged across ${policies.length} companies`, new Date().toISOString());
  return totalDeleted;
}
