import { run, nowIso } from "./db.js";

export async function recordHistory(db, { companyId, inwardId, entityType, entityId, action, snapshot, changedBy }) {
  await run(
    db,
    `INSERT INTO record_history (company_id, inward_id, entity_type, entity_id, action, snapshot, changed_by, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    companyId, inwardId, entityType, entityId, action, JSON.stringify(snapshot), changedBy, nowIso()
  );
}
