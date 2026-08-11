import { all, one, run, nowIso, uuid } from "../lib/db.js";import { effectiveCompanyScope } from "../lib/session.js";
import { withBalance, shippedQtyFor } from "../lib/balance.js";
import { recordHistory } from "../lib/history.js";
import { json, badRequest, forbidden, notFound, conflict } from "../lib/http.js";
import { putPhoto, deletePhoto } from "../lib/photos.js";

function requireLogin(session) {
  if (!session) return forbidden("Login required");
  return null;
}
function requireAdmin(session) {
  if (!session || session.role !== "admin") return forbidden("Admin access required");
  return null;
}
// Viewer role (recommendation, implemented) — read-only across the board.
function requireReader(session) {
  if (!session || !["admin", "viewer"].includes(session.role)) return forbidden("Admin or viewer access required");
  return null;
}
// Viewer role (recommendation, implemented) — read-only. Blocks creating,
// editing, shipping, or deleting stock records, while still allowing the
// read-only endpoints (list/get/history) that just use requireLogin.
function requireWriter(session) {
  if (!session) return forbidden("Login required");
  if (session.role === "viewer") return forbidden("Viewer accounts are read-only");
  return null;
}

// Root creating/editing while scope is "All" is rejected, per spec §6.2.
function requireSpecificCompany(scope) {
  if (scope.all) return badRequest("Select a specific company first");
  return null;
}

export async function listOpen(session, env, url) {
  const err = requireLogin(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const q = url.searchParams.get("q") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(10, parseInt(url.searchParams.get("pageSize") || "10", 10)));

  const params = [];
  let where = `1=1`;
  const companyIdFilter = scope.all ? url.searchParams.get("companyId") : null;
  if (!scope.all) {
    where += ` AND ie.company_id = ?`;
    params.push(scope.companyId);
  } else if (companyIdFilter) {
    where += ` AND ie.company_id = ?`;
    params.push(Number(companyIdFilter));
  }
  if (q) {
    where += ` AND (ie.customer_number LIKE ? OR ie.party_name LIKE ? OR ie.pipe_number LIKE ? OR ie.inward_vehicle_reg LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const selectCols = scope.all ? `ie.*, c.name AS company_name, c.slug AS company_slug` : `ie.*`;
  const fromClause = scope.all ? `inward_entries ie JOIN companies c ON c.id = ie.company_id` : `inward_entries ie`;
  const rows = await all(env.DB, `SELECT ${selectCols} FROM ${fromClause} WHERE ${where} ORDER BY ie.created_at DESC`, ...params);
  const withBalances = await Promise.all(rows.map((r) => withBalance(env.DB, r)));
  const open = withBalances.filter((r) => r.status !== "closed");
  const start = (page - 1) * pageSize;
  const pageRows = open.slice(start, start + pageSize);
  return json({ rows: pageRows, total: open.length, page, pageSize });
}

export async function listAll(session, env, url) {
  const err = requireReader(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(10, parseInt(url.searchParams.get("pageSize") || "10", 10)));

  const params = [];
  let where = `1=1`;

  // Root can narrow by a specific company while staying in the "All" view.
  const companyIdFilter = scope.all ? url.searchParams.get("companyId") : null;
  if (!scope.all) {
    where += ` AND ie.company_id = ?`;
    params.push(scope.companyId);
  } else if (companyIdFilter) {
    where += ` AND ie.company_id = ?`;
    params.push(Number(companyIdFilter));
  }
  for (const [param, col, exact] of [
    ["party", "party_name", false],
    ["pipeNumber", "pipe_number", false],
    ["customerNumber", "customer_number", false],
  ]) {
    const v = url.searchParams.get(param);
    if (v) {
      where += ` AND ie.${col} LIKE ?`;
      params.push(`%${v}%`);
    }
  }
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from) { where += ` AND ie.inward_date >= ?`; params.push(from); }
  if (to) { where += ` AND ie.inward_date <= ?`; params.push(to); }

  // Item 11/12: filter by outward (shipment) date range too — an entry
  // matches if ANY of its shipments falls in the range.
  const outwardFrom = url.searchParams.get("outwardFrom");
  const outwardTo = url.searchParams.get("outwardTo");
  if (outwardFrom || outwardTo) {
    let sub = `SELECT DISTINCT inward_id FROM outward_shipments WHERE 1=1`;
    if (outwardFrom) { sub += ` AND outward_date >= ?`; params.push(outwardFrom); }
    if (outwardTo) { sub += ` AND outward_date <= ?`; params.push(outwardTo); }
    where += ` AND ie.id IN (${sub})`;
  }

  const selectCols = scope.all
    ? `ie.*, c.name AS company_name, c.slug AS company_slug`
    : `ie.*`;
  const fromClause = scope.all ? `inward_entries ie JOIN companies c ON c.id = ie.company_id` : `inward_entries ie`;
  const rows = await all(env.DB, `SELECT ${selectCols} FROM ${fromClause} WHERE ${where} ORDER BY ie.created_at DESC`, ...params);
  let withBalances = await Promise.all(rows.map((r) => withBalance(env.DB, r)));

  const status = url.searchParams.get("status");
  if (status && status !== "all") withBalances = withBalances.filter((r) => r.status === status);

  const start = (page - 1) * pageSize;
  const pageRows = withBalances.slice(start, start + pageSize);
  return json({ rows: pageRows, total: withBalances.length, page, pageSize });
}

async function loadOwnedEntry(session, env, id) {
  const entry = await one(env.DB, `SELECT * FROM inward_entries WHERE id = ?`, id);
  if (!entry) return { error: notFound("Inward entry not found") };
  if (!session.isRoot && entry.company_id !== session.companyId) {
    return { error: forbidden("Not your company's record") };
  }
  return { entry };
}

export async function getOne(session, env, id) {
  const err = requireLogin(session);
  if (err) return err;
  const { entry, error } = await loadOwnedEntry(session, env, id);
  if (error) return error;
  const withBal = await withBalance(env.DB, entry);
  // Root viewing an entry (especially from the cross-company "All" view) needs
  // to know which company it belongs to — the list views already show this,
  // the detail view previously didn't.
  if (session.isRoot) {
    const company = await one(env.DB, `SELECT name FROM companies WHERE id = ?`, entry.company_id);
    withBal.company_name = company?.name || null;
  }
  return json(withBal);
}

export async function getHistory(session, env, id) {
  const err = requireAdmin(session);
  if (err) return err;
  const { entry, error } = await loadOwnedEntry(session, env, id);
  if (error) return error;
  const rows = await all(
    env.DB,
    `SELECT * FROM record_history WHERE inward_id = ? ORDER BY changed_at DESC`,
    id
  );
  return json(rows.map((r) => ({ ...r, snapshot: JSON.parse(r.snapshot) })));
}

const REQUIRED_FIELDS = ["party_name", "number_of_pipes", "inward_date", "inward_vehicle_reg"];

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function validateInward(body) {
  for (const f of REQUIRED_FIELDS) {
    if (body[f] === undefined || body[f] === null || body[f] === "") return `${f} is required`;
  }
  if (!Number.isInteger(body.number_of_pipes) || body.number_of_pipes <= 0) {
    return "number_of_pipes must be a positive whole number";
  }
  if (body.inward_date > todayIso()) return "Inward Date cannot be in the future";
  return null;
}

export async function create(session, env, request) {
  const err = requireWriter(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const scopeErr = requireSpecificCompany(scope);
  if (scopeErr) return scopeErr;

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid body");
  const validationError = validateInward(body);
  if (validationError) return badRequest(validationError);

  const id = uuid();
  const createdAt = nowIso();
  let photoKey = null;
  if (body.photoBase64) photoKey = await putPhoto(env, scope.companyId, `inward/${id}`, body.photoBase64);

  await run(
    env.DB,
    `INSERT INTO inward_entries
     (id, company_id, customer_number, party_name, pipe_number, number_of_pipes, pipe_size,
      inward_date, inward_vehicle_reg, notes, photo_key, created_by, created_at, device_info)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, scope.companyId, body.customer_number || null, body.party_name, body.pipe_number || null,
    body.number_of_pipes, body.pipe_size || null, body.inward_date, body.inward_vehicle_reg,
    body.notes || null, photoKey, session.id, createdAt, body.deviceInfo || null
  );

  await recordHistory(env.DB, {
    companyId: scope.companyId, inwardId: id, entityType: "inward", entityId: id,
    action: "create", snapshot: { ...body, id }, changedBy: session.id,
  });

  return json({ id }, 201);
}

export async function update(session, env, id, request) {
  const err = requireWriter(session);
  if (err) return err;
  const { entry, error } = await loadOwnedEntry(session, env, id);
  if (error) return error;

  const shippedQty = await shippedQtyFor(env.DB, id);
  // Employees may only edit while zero shipments exist; once any exist,
  // only that company's admin (or root) may edit further — spec §6.6.
  if (shippedQty > 0 && session.role !== "admin") {
    return forbidden("This entry has shipments — only an admin can edit it now");
  }

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid body");
  const validationError = validateInward(body);
  if (validationError) return badRequest(validationError);
  if (body.number_of_pipes < shippedQty) {
    return badRequest(`Cannot reduce Number of Pipes below the ${shippedQty} already shipped`);
  }

  let photoKey = entry.photo_key;
  if (body.photoBase64) photoKey = await putPhoto(env, entry.company_id, `inward/${id}`, body.photoBase64);

  await run(
    env.DB,
    `UPDATE inward_entries SET customer_number=?, party_name=?, pipe_number=?, number_of_pipes=?,
     pipe_size=?, inward_date=?, inward_vehicle_reg=?, notes=?, photo_key=?, updated_by=?, updated_at=?
     WHERE id=?`,
    body.customer_number || null, body.party_name, body.pipe_number || null, body.number_of_pipes,
    body.pipe_size || null, body.inward_date, body.inward_vehicle_reg, body.notes || null,
    photoKey, session.id, nowIso(), id
  );

  await recordHistory(env.DB, {
    companyId: entry.company_id, inwardId: id, entityType: "inward", entityId: id,
    action: "update", snapshot: { ...body, id }, changedBy: session.id,
  });

  return json({ ok: true });
}

export async function remove(session, env, id) {
  const err = requireAdmin(session);
  if (err) return err;
  const { entry, error } = await loadOwnedEntry(session, env, id);
  if (error) return error;

  const shippedQty = await shippedQtyFor(env.DB, id);
  if (shippedQty > 0) return conflict("Cannot delete — shipments exist against this entry. Use Housekeeping to bulk-clean up instead.");

  if (entry.photo_key) await deletePhoto(env, entry.photo_key);
  await run(env.DB, `DELETE FROM inward_entries WHERE id = ?`, id);

  await recordHistory(env.DB, {
    companyId: entry.company_id, inwardId: id, entityType: "inward", entityId: id,
    action: "delete", snapshot: entry, changedBy: session.id,
  });

  return json({ ok: true });
}

export async function getPhoto(session, env, id, url) {
  const err = requireLogin(session);
  if (err) return err;
  const { entry, error } = await loadOwnedEntry(session, env, id);
  if (error) return error;
  if (!entry.photo_key) return notFound("No photo on this entry");
  const obj = await env.PHOTOS.get(entry.photo_key);
  if (!obj) return notFound("Photo not found in storage");
  const headers = { "Content-Type": obj.httpMetadata?.contentType || "image/jpeg" };
  if (url?.searchParams.get("download") === "1") headers["Content-Disposition"] = `attachment; filename="inward-${id}.jpg"`;
  return new Response(obj.body, { headers });
}
