import { one, run, nowIso } from "../lib/db.js";
import { json, badRequest, forbidden } from "../lib/http.js";

function requireRoot(session) {
  if (!session || !session.isRoot) return forbidden("Root access required");
  return null;
}

export async function getSettings(session, env) {
  const err = requireRoot(session);
  if (err) return err;
  const row = await one(env.DB, `SELECT * FROM platform_settings WHERE id = 1`);
  return json(row);
}

export async function updateSettings(session, env, request) {
  const err = requireRoot(session);
  if (err) return err;
  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid body");
  const backupDays = parseInt(body.backupFrequencyDays, 10);
  const housekeepingDays = parseInt(body.housekeepingFrequencyDays, 10);
  if (!Number.isInteger(backupDays) || backupDays < 1) return badRequest("backupFrequencyDays must be a positive whole number");
  if (!Number.isInteger(housekeepingDays) || housekeepingDays < 1) return badRequest("housekeepingFrequencyDays must be a positive whole number");

  // support_email is optional — null means "no platform support email shown"
  const supportEmail = body.supportEmail !== undefined ? (body.supportEmail || null) : undefined;
  const supportEmailName = body.supportEmailName || "Beam Veda Support";

  if (supportEmail !== undefined) {
    await run(
      env.DB,
      `UPDATE platform_settings SET backup_frequency_days = ?, housekeeping_frequency_days = ?, support_email = ?, support_email_name = ? WHERE id = 1`,
      backupDays, housekeepingDays, supportEmail, supportEmailName
    );
  } else {
    await run(
      env.DB,
      `UPDATE platform_settings SET backup_frequency_days = ?, housekeeping_frequency_days = ? WHERE id = 1`,
      backupDays, housekeepingDays
    );
  }
  return json({ ok: true });
}

// Public endpoint — login screen uses this to show platform support email
// without requiring login. No sensitive data returned.
export async function getPublicSettings(env) {
  const row = await one(env.DB, `SELECT support_email, support_email_name FROM platform_settings WHERE id = 1`);
  return json({ supportEmail: row?.support_email || null, supportEmailName: row?.support_email_name || "Beam Veda Support" });
}

// Used by the scheduled() handler, not exposed as an HTTP route.
export async function isDue(env, field) {
  const row = await one(env.DB, `SELECT * FROM platform_settings WHERE id = 1`);
  const lastRun = field === "backup" ? row.last_backup_run : row.last_housekeeping_run;
  const frequencyDays = field === "backup" ? row.backup_frequency_days : row.housekeeping_frequency_days;
  if (!lastRun) return true; // never run before
  const dueAt = new Date(lastRun).getTime() + frequencyDays * 86400000;
  return Date.now() >= dueAt;
}

export async function markRun(env, field) {
  const column = field === "backup" ? "last_backup_run" : "last_housekeeping_run";
  await run(env.DB, `UPDATE platform_settings SET ${column} = ? WHERE id = 1`, nowIso());
}
