// Thin convenience wrapper around D1's prepared-statement API.

export function q(db, sql, ...binds) {
  return db.prepare(sql).bind(...binds);
}

export async function all(db, sql, ...binds) {
  const { results } = await q(db, sql, ...binds).all();
  return results;
}

export async function one(db, sql, ...binds) {
  return await q(db, sql, ...binds).first();
}

export async function run(db, sql, ...binds) {
  return await q(db, sql, ...binds).run();
}

export function nowIso() {
  return new Date().toISOString();
}

export function uuid() {
  return crypto.randomUUID();
}
