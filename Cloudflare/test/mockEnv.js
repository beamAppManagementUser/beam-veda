import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";

export function makeMockD1(schemaPath) {
  const raw = new DatabaseSync(":memory:");
  const schema = fs.readFileSync(schemaPath, "utf8");
  raw.exec(schema);

  return {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            all() {
              const stmt = raw.prepare(sql);
              const results = stmt.all(...args);
              return { results };
            },
            first() {
              const stmt = raw.prepare(sql);
              const row = stmt.get(...args);
              return row || null;
            },
            run() {
              const stmt = raw.prepare(sql);
              const info = stmt.run(...args);
              return { meta: { last_row_id: info.lastInsertRowid, changes: info.changes } };
            },
          };
        },
      };
    },
  };
}

export function makeMockR2() {
  const store = new Map();
  return {
    async put(key, value, opts) {
      store.set(key, { body: value, httpMetadata: opts?.httpMetadata, uploaded: new Date().toISOString(), size: value.length || 0 });
      return true;
    },
    async get(key) {
      const obj = store.get(key);
      if (!obj) return null;
      return { body: obj.body, httpMetadata: obj.httpMetadata };
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix } = {}) {
      const objects = [...store.entries()]
        .filter(([k]) => !prefix || k.startsWith(prefix))
        .map(([key, v]) => ({ key, size: v.size, uploaded: v.uploaded }));
      return { objects };
    },
    _store: store,
  };
}

export function fakeRequest(body, headers = {}) {
  return { json: async () => body, headers: { get: (h) => headers[h] ?? null } };
}
