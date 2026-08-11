import { all, run, nowIso } from "../lib/db.js";
import { effectiveCompanyScope } from "../lib/session.js";
import { json, badRequest, forbidden, notFound } from "../lib/http.js";

function requireRoot(session) {
  if (!session || !session.isRoot) return forbidden("Root access required");
  return null;
}
function requireAdmin(session) {
  if (!session || session.role !== "admin") return forbidden("Admin access required");
  return null;
}

const ALL_TABLES = [
  "companies", "users", "admin_recovery", "inward_entries", "outward_shipments",
  "record_history", "lookup_fields", "lookup_values", "retention_policy",
];
const COMPANY_TABLES = ["inward_entries", "outward_shipments", "lookup_fields", "lookup_values", "record_history"];
// users and admin_recovery are deliberately excluded from company exports —
// credentials never leave the system as a downloadable file, per spec §6.9.

async function dumpTables(db, tables, companyId = null) {
  const dump = {};
  for (const t of tables) {
    dump[t] = companyId == null
      ? await all(db, `SELECT * FROM ${t}`)
      : await all(db, `SELECT * FROM ${t} WHERE company_id = ?`, companyId);
  }
  return dump;
}

// ---- Restore (recommendation, implemented) — the counterpart to the dump
// above. Wipes the target scope, then re-inserts every row from the dump.
// Tables are deleted in reverse dependency order and inserted in forward
// order so foreign keys never point at a row that doesn't exist yet.
async function insertRow(db, table, row) {
  const cols = Object.keys(row);
  const placeholders = cols.map(() => "?").join(",");
  await run(db, `INSERT OR REPLACE INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`, ...cols.map((c) => row[c]));
}

async function restoreDump(env, dump, tables, companyId = null) {
  const reversed = [...tables].reverse();
  for (const t of reversed) {
    if (companyId != null) await run(env.DB, `DELETE FROM ${t} WHERE company_id = ?`, companyId);
    else await run(env.DB, `DELETE FROM ${t}`);
  }
  for (const t of tables) {
    if (!dump[t]) continue;
    for (const row of dump[t]) await insertRow(env.DB, t, row);
  }
}

// ---- System backup (root only, whole database) ----
export async function doSystemBackup(env) {
  try {
    const dump = await dumpTables(env.DB, ALL_TABLES);
    const key = `system/system_${Date.now()}.json`;
    await env.PHOTOS.put(key, JSON.stringify(dump), { httpMetadata: { contentType: "application/json" } });
    await run(env.DB, `INSERT INTO backup_runs (kind, company_id, status, detail, ran_at) VALUES ('system', NULL, 'success', ?, ?)`, key, nowIso());
    return { ok: true, key };
  } catch (e) {
    await run(env.DB, `INSERT INTO backup_runs (kind, company_id, status, detail, ran_at) VALUES ('system', NULL, 'failure', ?, ?)`, String(e), nowIso());
    return { ok: false, error: String(e) };
  }
}

export async function runSystemBackup(session, env) {
  const err = requireRoot(session);
  if (err) return err;
  const result = await doSystemBackup(env);
  return result.ok ? json(result) : json({ error: "Backup failed", detail: result.error }, 500);
}

export async function listSystemBackups(session, env) {
  const err = requireRoot(session);
  if (err) return err;
  const list = await env.PHOTOS.list({ prefix: "system/" });
  return json(list.objects.map((o) => ({ filename: o.key, size: o.size, uploaded: o.uploaded })));
}

export async function downloadSystemBackup(session, env, filename) {
  const err = requireRoot(session);
  if (err) return err;
  const obj = await env.PHOTOS.get(`system/${filename}`);
  if (!obj) return notFound("Backup not found");
  return new Response(obj.body, { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${filename}"` } });
}

export async function deleteSystemBackup(session, env, filename) {
  const err = requireRoot(session);
  if (err) return err;
  await env.PHOTOS.delete(`system/${filename}`);
  return json({ ok: true });
}

export async function cleanupSystemBackups(session, env, request) {
  const err = requireRoot(session);
  if (err) return err;
  const body = await request.json().catch(() => ({}));
  const days = body.olderThanDays ?? 30;
  const cutoff = Date.now() - days * 86400000;
  const list = await env.PHOTOS.list({ prefix: "system/" });
  let removed = 0;
  for (const o of list.objects) {
    if (new Date(o.uploaded).getTime() < cutoff) {
      await env.PHOTOS.delete(o.key);
      removed++;
    }
  }
  return json({ ok: true, removed });
}

// ---- Company data backup (that company's own admins, and root) ----
export async function runCompanyBackup(session, env, url) {
  const err = requireAdmin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  // Root can target a specific company via ?companyId= without having to
  // "enter" that company (which would change their header/tab context).
  const companyId = scope.all ? url?.searchParams?.get("companyId") : scope.companyId;
  if (!companyId) return badRequest("companyId is required — select a company first");
  const result = await doCompanyBackup(env, Number(companyId));
  return result.ok ? json(result) : json({ error: "Backup failed", detail: result.error }, 500);
}

export async function doCompanyBackup(env, companyId) {
  try {
    const dump = await dumpTables(env.DB, COMPANY_TABLES, companyId);
    const company = await env.DB.prepare(`SELECT slug FROM companies WHERE id = ?`).bind(companyId).first();
    const key = `companies/${companyId}/company_${company?.slug || companyId}_${Date.now()}.json`;
    await env.PHOTOS.put(key, JSON.stringify(dump), { httpMetadata: { contentType: "application/json" } });
    await run(env.DB, `INSERT INTO backup_runs (kind, company_id, status, detail, ran_at) VALUES ('company', ?, 'success', ?, ?)`, companyId, key, nowIso());
    return { ok: true, key };
  } catch (e) {
    await run(env.DB, `INSERT INTO backup_runs (kind, company_id, status, detail, ran_at) VALUES ('company', ?, 'failure', ?, ?)`, companyId, String(e), nowIso());
    return { ok: false, error: String(e) };
  }
}

// Root-only: run company backups across selected (or all) companies at once.
export async function bulkRunCompanyBackups(session, env, request) {
  if (!session || !session.isRoot) return forbidden("Root access required");
  const body = await request.json().catch(() => ({}));
  const companyIds = body.companyIds && body.companyIds.length ? body.companyIds : (await all(env.DB, `SELECT id FROM companies`)).map((c) => c.id);
  const results = [];
  for (const id of companyIds) results.push({ companyId: id, ...(await doCompanyBackup(env, id)) });
  return json({ ok: true, results });
}

export async function listCompanyBackups(session, env, url) {
  const err = requireAdmin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const companyId = scope.all ? url.searchParams.get("companyId") : scope.companyId;
  if (!companyId) return badRequest("companyId is required");
  const list = await env.PHOTOS.list({ prefix: `companies/${companyId}/` });
  return json(list.objects.map((o) => ({ filename: o.key.split("/").pop(), size: o.size, uploaded: o.uploaded })));
}

export async function downloadCompanyBackup(session, env, filename, url) {
  const err = requireAdmin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const companyId = scope.all ? url.searchParams.get("companyId") : scope.companyId;
  if (!companyId) return badRequest("companyId is required");
  const obj = await env.PHOTOS.get(`companies/${companyId}/${filename}`);
  if (!obj) return notFound("Backup not found");
  return new Response(obj.body, { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${filename}"` } });
}

export async function deleteCompanyBackup(session, env, filename, url) {
  const err = requireAdmin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const companyId = scope.all ? url.searchParams.get("companyId") : scope.companyId;
  if (!companyId) return badRequest("companyId is required");
  await env.PHOTOS.delete(`companies/${companyId}/${filename}`);
  return json({ ok: true });
}

export async function cleanupCompanyBackups(session, env, request) {
  const err = requireAdmin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  if (scope.all) return badRequest("Select a specific company first");
  const body = await request.json().catch(() => ({}));
  const days = body.olderThanDays ?? 30;
  const cutoff = Date.now() - days * 86400000;
  const list = await env.PHOTOS.list({ prefix: `companies/${scope.companyId}/` });
  let removed = 0;
  for (const o of list.objects) {
    if (new Date(o.uploaded).getTime() < cutoff) {
      await env.PHOTOS.delete(o.key);
      removed++;
    }
  }
  return json({ ok: true, removed });
}

// ---- Restore endpoints (root-only, confirmation-gated — this overwrites
// live data, so it deliberately isn't a one-click action) ----
export async function restoreSystemBackup(session, env, filename, request) {
  const err = requireRoot(session);
  if (err) return err;
  const body = await request.json().catch(() => ({}));
  if (body.confirmPhrase !== "RESTORE") return badRequest('Type RESTORE exactly to confirm — this overwrites ALL current data');
  const obj = await env.PHOTOS.get(`system/${filename}`);
  if (!obj) return notFound("Backup not found");
  try {
    const dump = JSON.parse(await new Response(obj.body).text());
    await restoreDump(env, dump, ALL_TABLES);
    await run(env.DB, `INSERT INTO backup_runs (kind, company_id, status, detail, ran_at) VALUES ('system_restore', NULL, 'success', ?, ?)`, filename, nowIso());
    return json({ ok: true });
  } catch (e) {
    await run(env.DB, `INSERT INTO backup_runs (kind, company_id, status, detail, ran_at) VALUES ('system_restore', NULL, 'failure', ?, ?)`, String(e), nowIso());
    return json({ error: "Restore failed", detail: String(e) }, 500);
  }
}

export async function restoreCompanyBackup(session, env, filename, url, request) {
  const err = requireAdmin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const companyId = scope.all ? url.searchParams.get("companyId") : scope.companyId;
  if (!companyId) return badRequest("companyId is required");
  const body = await request.json().catch(() => ({}));
  if (body.confirmPhrase !== "RESTORE") return badRequest('Type RESTORE exactly to confirm — this overwrites this company\'s current stock records');
  const obj = await env.PHOTOS.get(`companies/${companyId}/${filename}`);
  if (!obj) return notFound("Backup not found");
  try {
    const dump = JSON.parse(await new Response(obj.body).text());
    await restoreDump(env, dump, COMPANY_TABLES, Number(companyId));
    await run(env.DB, `INSERT INTO backup_runs (kind, company_id, status, detail, ran_at) VALUES ('company_restore', ?, 'success', ?, ?)`, companyId, filename, nowIso());
    return json({ ok: true });
  } catch (e) {
    await run(env.DB, `INSERT INTO backup_runs (kind, company_id, status, detail, ran_at) VALUES ('company_restore', ?, 'failure', ?, ?)`, companyId, String(e), nowIso());
    return json({ error: "Restore failed", detail: String(e) }, 500);
  }
}

export async function backupHealth(session, env) {
  if (!session) return forbidden("Login required");
  const rows = await all(env.DB, `SELECT kind, company_id, status, ran_at FROM backup_runs ORDER BY ran_at DESC LIMIT 10`);
  return json(rows);
}
