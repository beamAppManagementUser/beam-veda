import { all, one, run, nowIso } from "../lib/db.js";
import { hashPassword } from "../lib/password.js";
import { json, badRequest, forbidden, notFound, conflict } from "../lib/http.js";

const RESERVED_SLUGS = new Set(["root-admin", "api", "admin", "www", "app"]);
const SLUG_RE = /^[a-z0-9-]{2,60}$/;
const LOOKUP_FIELDS = [
  ["customer_number", "Customer Number"],
  ["party_name", "Party Name"],
  ["pipe_number", "Pipe Number"],
  ["pipe_size", "Pipe Size"],
  ["inward_vehicle_reg", "Inward Vehicle Reg"],
  ["outward_vehicle_reg", "Outward Vehicle Reg"],
];

function requireRoot(session) {
  if (!session || !session.isRoot) return forbidden("Root access required");
  return null;
}

async function logProfileChange(env, companyId, changedBy, field, oldValue, newValue) {
  if (oldValue === newValue) return; // no-op edits aren't worth a log line
  await run(
    env.DB,
    `INSERT INTO company_profile_history (company_id, changed_by, field, old_value, new_value, changed_at) VALUES (?, ?, ?, ?, ?, ?)`,
    companyId, changedBy, field, oldValue ?? null, newValue ?? null, nowIso()
  );
}

// Company admin self-service. Per clarified intent: the admin CAN steer the
// company's secondary language (the one their employees toggle to) — root
// just sets the initial value when creating the company. Logo stays
// root-only ("banner is good and pretty" as-is).
export async function updateOwnCompany(session, env, request) {
  if (!session || session.isRoot || session.role !== "admin") return forbidden("Company admin access required");
  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid body");
  const current = await one(env.DB, `SELECT * FROM companies WHERE id = ?`, session.companyId);
  if (!current) return notFound("Company not found");

  const { name, contact, langSecondary } = body;
  const result = await run(
    env.DB,
    `UPDATE companies SET name = COALESCE(?, name), contact = COALESCE(?, contact), lang_secondary = COALESCE(?, lang_secondary) WHERE id = ?`,
    name ?? null, contact ?? null, langSecondary ?? null, session.companyId
  );
  if (result.meta.changes === 0) return notFound("Company not found");

  if (name && name !== current.name) await logProfileChange(env, session.companyId, session.id, "name", current.name, name);
  if (contact && contact !== current.contact) await logProfileChange(env, session.companyId, session.id, "contact", current.contact, contact);
  if (langSecondary && langSecondary !== current.lang_secondary) await logProfileChange(env, session.companyId, session.id, "lang_secondary", current.lang_secondary, langSecondary);

  return json({ ok: true });
}

export async function listCompanies(session, env) {
  const err = requireRoot(session);
  if (err) return err;
  const companies = await all(env.DB, `SELECT id, slug, name, contact, active, lang_secondary, created_at FROM companies ORDER BY name`);
  return json(companies);
}

export async function createCompany(session, env, request) {
  const err = requireRoot(session);
  if (err) return err;
  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid body");
  const { name, slug, contact = "", adminId, adminName, adminPassword, langSecondary = "hi" } = body;
  if (!name || !slug || !adminId || !adminName || !adminPassword) {
    return badRequest("name, slug, adminId, adminName, adminPassword are all required");
  }
  const normalizedSlug = String(slug).toLowerCase();
  if (!SLUG_RE.test(normalizedSlug)) return badRequest("Slug must be 2-60 lowercase letters/numbers/hyphens");
  if (RESERVED_SLUGS.has(normalizedSlug)) return badRequest("That slug is reserved");

  const existing = await one(env.DB, `SELECT id FROM companies WHERE slug = ? COLLATE NOCASE`, normalizedSlug);
  if (existing) return conflict("Slug already in use");

  const createdAt = nowIso();
  const companyResult = await run(
    env.DB,
    `INSERT INTO companies (slug, name, contact, active, lang_secondary, created_at) VALUES (?, ?, ?, 1, ?, ?)`,
    normalizedSlug, name, contact, langSecondary, createdAt
  );
  const companyId = companyResult.meta.last_row_id;

  const hash = await hashPassword(adminPassword);
  await run(
    env.DB,
    `INSERT INTO users (id, company_id, name, password_hash, role, active, is_root, created_at)
     VALUES (?, ?, ?, ?, 'admin', 1, 0, ?)`,
    adminId, companyId, adminName, hash, createdAt
  );

  // Seed lookup_fields rows per spec §5.6
  for (const [fieldKey, label] of LOOKUP_FIELDS) {
    await run(
      env.DB,
      `INSERT INTO lookup_fields (company_id, field_key, label, use_lookup) VALUES (?, ?, ?, 0)`,
      companyId, fieldKey, label
    );
  }
  await run(env.DB, `INSERT INTO retention_policy (company_id, enabled) VALUES (?, 0)`, companyId);
  await logProfileChange(env, companyId, session.id, "created", null, `${name} (secondary language: ${langSecondary})`);

  return json({ id: companyId, slug: normalizedSlug, name }, 201);
}

export async function updateCompany(session, env, companyId, request) {
  const err = requireRoot(session);
  if (err) return err;
  const body = await request.json().catch(() => null);
  if (!body) return badRequest("Invalid body");
  const current = await one(env.DB, `SELECT * FROM companies WHERE id = ?`, companyId);
  if (!current) return notFound("Company not found");

  const { name, contact, langSecondary } = body;
  const result = await run(
    env.DB,
    `UPDATE companies SET name = COALESCE(?, name), contact = COALESCE(?, contact),
     lang_secondary = COALESCE(?, lang_secondary) WHERE id = ?`,
    name ?? null, contact ?? null, langSecondary ?? null, companyId
  );
  if (result.meta.changes === 0) return notFound("Company not found");

  if (name && name !== current.name) await logProfileChange(env, companyId, session.id, "name", current.name, name);
  if (contact && contact !== current.contact) await logProfileChange(env, companyId, session.id, "contact", current.contact, contact);
  if (langSecondary && langSecondary !== current.lang_secondary) await logProfileChange(env, companyId, session.id, "lang_secondary", current.lang_secondary, langSecondary);

  return json({ ok: true });
}

export async function getCompanyHistory(session, env, companyId) {
  const err = requireRoot(session);
  if (err) return err;
  const rows = await all(env.DB, `SELECT * FROM company_profile_history WHERE company_id = ? ORDER BY changed_at DESC`, companyId);
  return json(rows);
}

export async function setCompanyActive(session, env, companyId, active) {
  const err = requireRoot(session);
  if (err) return err;
  const result = await run(env.DB, `UPDATE companies SET active = ? WHERE id = ?`, active ? 1 : 0, companyId);
  if (result.meta.changes === 0) return notFound("Company not found");
  return json({ ok: true });
}

export async function deleteCompany(session, env, companyId, request) {
  const err = requireRoot(session);
  if (err) return err;
  const body = await request.json().catch(() => ({}));
  const company = await one(env.DB, `SELECT * FROM companies WHERE id = ?`, companyId);
  if (!company) return notFound("Company not found");
  if (body.confirmSlug !== company.slug) return badRequest("confirmSlug must match the company's slug exactly");

  // Ordering per spec §5.7: delete this company's outward_shipments first
  // (no-cascade FK), THEN let the companies delete cascade the rest
  // (inward_entries, users, lookup_fields/values, record_history).
  await run(env.DB, `DELETE FROM outward_shipments WHERE company_id = ?`, companyId);
  await run(env.DB, `DELETE FROM companies WHERE id = ?`, companyId);

  // Bulk-delete every file (photos + backups) belonging to this company —
  // straightforward now that all storage keys are namespaced by company.
  const list = await env.PHOTOS.list({ prefix: `companies/${companyId}/` });
  for (const obj of list.objects) await env.PHOTOS.delete(obj.key);

  return json({ ok: true, filesRemoved: list.objects.length });
}

export async function selectCompany(session, env, request) {
  const err = requireRoot(session);
  if (err) return err;
  const body = await request.json().catch(() => null);
  if (!body || !("companyId" in body)) return badRequest("companyId is required (or null for All)");
  // Session is a signed cookie, not server state, so "selecting" a company
  // means re-issuing the cookie with selectedCompanyId set. Handled in index.js
  // where the Set-Cookie header is attached — this returns the new value for it.
  return json({ selectedCompanyId: body.companyId });
}

export async function publicCompanyInfo(env, slug) {
  const company = await one(
    env.DB,
    `SELECT name, contact, logo_key, active FROM companies WHERE slug = ? COLLATE NOCASE`,
    slug
  );
  if (!company) return notFound("Unknown company");
  return json({
    name: company.name,
    contact: company.contact,
    hasLogo: !!company.logo_key,
    active: !!company.active,
  });
}

// Public (no login needed) so the logo can render on the login screen itself.
export async function publicCompanyLogo(env, slug) {
  const company = await one(env.DB, `SELECT logo_key FROM companies WHERE slug = ? COLLATE NOCASE`, slug);
  if (!company || !company.logo_key) return notFound("No logo");
  const obj = await env.PHOTOS.get(company.logo_key);
  if (!obj) return notFound("No logo");
  return new Response(obj.body, { headers: { "Content-Type": "image/png" } });
}

export async function uploadLogo(session, env, companyId, request) {
  const err = requireRoot(session);
  if (err) return err;
  const body = await request.json().catch(() => null);
  if (!body || !body.logoBase64) return badRequest("logoBase64 is required");
  const clean = body.logoBase64.includes(",") ? body.logoBase64.split(",")[1] : body.logoBase64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const key = `companies/${companyId}/logo.png`;
  await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType: "image/png" } });
  await run(env.DB, `UPDATE companies SET logo_key = ? WHERE id = ?`, key, companyId);
  return json({ ok: true });
}
