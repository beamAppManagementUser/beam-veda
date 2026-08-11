import { one, run, nowIso } from "./db.js";
import { hashPassword } from "./password.js";

// Seeds exactly one root row on first-ever request, per spec §5.2.
// NOTE: the spec's literal seed password ('Anupamaji#1') is used here to
// match the document, but shipping a fixed, publicly-documented password
// is a real risk — change it via the break-glass reset flow immediately
// after first deploy. See the chat recommendation on this.
export async function ensureRootSeeded(db) {
  const existing = await one(db, `SELECT pk FROM users WHERE is_root = 1 LIMIT 1`);
  if (existing) return;
  const hash = await hashPassword("Anupamaji#1");
  await run(
    db,
    `INSERT INTO users (id, company_id, name, password_hash, role, active, is_root, created_at)
     VALUES ('Admin', NULL, 'Administrator', ?, 'admin', 1, 1, ?)`,
    hash,
    nowIso()
  );
}
