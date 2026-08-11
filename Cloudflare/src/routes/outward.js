import { one, all, run, nowIso, uuid } from "../lib/db.js";
import { shippedQtyFor } from "../lib/balance.js";
import { recordHistory } from "../lib/history.js";
import { json, badRequest, forbidden, notFound } from "../lib/http.js";
import { putPhoto, deletePhoto } from "../lib/photos.js";

function requireLogin(session) {
  if (!session) return forbidden("Login required");
  return null;
}
function requireAdmin(session) {
  if (!session || session.role !== "admin") return forbidden("Admin access required");
  return null;
}
function requireWriter(session) {
  if (!session) return forbidden("Login required");
  if (session.role === "viewer") return forbidden("Viewer accounts are read-only");
  return null;
}

async function loadOwnedInward(session, env, inwardId) {
  const entry = await one(env.DB, `SELECT * FROM inward_entries WHERE id = ?`, inwardId);
  if (!entry) return { error: notFound("Inward entry not found") };
  if (!session.isRoot && entry.company_id !== session.companyId) return { error: forbidden("Not your company's record") };
  return { entry };
}

async function loadOwnedShipment(session, env, id) {
  const shipment = await one(env.DB, `SELECT * FROM outward_shipments WHERE id = ?`, id);
  if (!shipment) return { error: notFound("Shipment not found") };
  if (!session.isRoot && shipment.company_id !== session.companyId) return { error: forbidden("Not your company's record") };
  return { shipment };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function validateShipment(body) {
  if (!Number.isInteger(body.number_of_pipes) || body.number_of_pipes <= 0) {
    return "Outward Qty must be a positive whole number";
  }
  if (!body.outward_date) return "Outward Date is required";
  if (body.outward_date > todayIso()) return "Outward Date cannot be in the future";
  if (!body.outward_vehicle_reg) return "Outward Vehicle Reg is required";
  return null;
}

export async function listForInward(session, env, inwardId) {
  const err = requireLogin(session);
  if (err) return err;
  const { error } = await loadOwnedInward(session, env, inwardId);
  if (error) return error;
  const rows = await all(env.DB, `SELECT * FROM outward_shipments WHERE inward_id = ? ORDER BY outward_date DESC`, inwardId);
  return json(rows);
}

export async function create(session, env, inwardId, request) {
  const err = requireWriter(session);
  if (err) return err;
  const { entry, error } = await loadOwnedInward(session, env, inwardId);
  if (error) return error;

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid body");
  const validationError = validateShipment(body);
  if (validationError) return badRequest(validationError);
  if (body.outward_date < entry.inward_date) return badRequest("Outward Date cannot be before the Inward Date");

  const alreadyShipped = await shippedQtyFor(env.DB, inwardId);
  const remaining = entry.number_of_pipes - alreadyShipped;
  if (body.number_of_pipes > remaining) {
    return badRequest(`Outward Qty exceeds remaining balance (${remaining} left)`);
  }

  const id = uuid();
  const createdAt = nowIso();
  let photoKey = null;
  if (body.photoBase64) photoKey = await putPhoto(env, entry.company_id, `outward/${id}`, body.photoBase64);

  await run(
    env.DB,
    `INSERT INTO outward_shipments
     (id, company_id, inward_id, pipe_number, number_of_pipes, outward_date, outward_vehicle_reg,
      notes, photo_key, created_by, created_at, device_info)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, entry.company_id, inwardId, body.pipe_number || null, body.number_of_pipes,
    body.outward_date, body.outward_vehicle_reg, body.notes || null, photoKey,
    session.id, createdAt, body.deviceInfo || null
  );

  await recordHistory(env.DB, {
    companyId: entry.company_id, inwardId, entityType: "outward", entityId: id,
    action: "create", snapshot: { ...body, id }, changedBy: session.id,
  });

  return json({ id }, 201);
}

export async function update(session, env, id, request) {
  const err = requireAdmin(session);
  if (err) return err;
  const { shipment, error } = await loadOwnedShipment(session, env, id);
  if (error) return error;
  const entry = await one(env.DB, `SELECT * FROM inward_entries WHERE id = ?`, shipment.inward_id);

  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid body");
  const validationError = validateShipment(body);
  if (validationError) return badRequest(validationError);
  if (body.outward_date < entry.inward_date) return badRequest("Outward Date cannot be before the Inward Date");

  const alreadyShipped = await shippedQtyFor(env.DB, shipment.inward_id, id); // excludes this shipment's own prior total
  const remaining = entry.number_of_pipes - alreadyShipped;
  if (body.number_of_pipes > remaining) {
    return badRequest(`Outward Qty exceeds remaining balance (${remaining} left)`);
  }

  let photoKey = shipment.photo_key;
  if (body.photoBase64) photoKey = await putPhoto(env, shipment.company_id, `outward/${id}`, body.photoBase64);

  await run(
    env.DB,
    `UPDATE outward_shipments SET pipe_number=?, number_of_pipes=?, outward_date=?, outward_vehicle_reg=?,
     notes=?, photo_key=?, updated_by=?, updated_at=? WHERE id=?`,
    body.pipe_number || null, body.number_of_pipes, body.outward_date, body.outward_vehicle_reg,
    body.notes || null, photoKey, session.id, nowIso(), id
  );

  await recordHistory(env.DB, {
    companyId: shipment.company_id, inwardId: shipment.inward_id, entityType: "outward", entityId: id,
    action: "update", snapshot: { ...body, id }, changedBy: session.id,
  });

  return json({ ok: true });
}

export async function remove(session, env, id) {
  const err = requireAdmin(session);
  if (err) return err;
  const { shipment, error } = await loadOwnedShipment(session, env, id);
  if (error) return error;

  if (shipment.photo_key) await deletePhoto(env, shipment.photo_key);
  await run(env.DB, `DELETE FROM outward_shipments WHERE id = ?`, id);

  await recordHistory(env.DB, {
    companyId: shipment.company_id, inwardId: shipment.inward_id, entityType: "outward", entityId: id,
    action: "delete", snapshot: shipment, changedBy: session.id,
  });

  return json({ ok: true });
}

export async function getPhoto(session, env, id, url) {
  const err = requireLogin(session);
  if (err) return err;
  const { shipment, error } = await loadOwnedShipment(session, env, id);
  if (error) return error;
  if (!shipment.photo_key) return notFound("No photo on this shipment");
  const obj = await env.PHOTOS.get(shipment.photo_key);
  if (!obj) return notFound("Photo not found in storage");
  const headers = { "Content-Type": obj.httpMetadata?.contentType || "image/jpeg" };
  if (url?.searchParams.get("download") === "1") headers["Content-Disposition"] = `attachment; filename="outward-${id}.jpg"`;
  return new Response(obj.body, { headers });
}
