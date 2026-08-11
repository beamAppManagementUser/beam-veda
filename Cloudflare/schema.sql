-- Beam Veda — D1 schema (adapted from master-spec-v2 §5)
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  logo_key TEXT,               -- R2 object key instead of local logo_path
  contact TEXT DEFAULT '',
  lang_secondary TEXT NOT NULL DEFAULT 'hi', -- the ONE non-English language this company's people can toggle to
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  pk INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL COLLATE NOCASE,
  company_id INTEGER NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,   -- PBKDF2 (Web Crypto), see src/lib/password.js
  role TEXT NOT NULL CHECK(role IN ('admin','employee','viewer')),
  active INTEGER NOT NULL DEFAULT 1,
  is_root INTEGER NOT NULL DEFAULT 0,
  lang_override TEXT NULL,       -- optional, admin-set: overrides the company's secondary language for THIS person only; NULL = use company default
  created_at TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT NULL,
  UNIQUE(company_id, id)
);

CREATE TABLE IF NOT EXISTS admin_recovery (
  user_pk INTEGER PRIMARY KEY REFERENCES users(pk) ON DELETE CASCADE,
  question1 TEXT NOT NULL,
  answer1_hash TEXT NOT NULL,
  question2 TEXT NOT NULL,
  answer2_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inward_entries (
  id TEXT PRIMARY KEY,             -- UUID v4
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_number TEXT NULL,
  party_name TEXT NOT NULL,
  pipe_number TEXT NULL,
  number_of_pipes INTEGER NOT NULL,
  pipe_size TEXT NULL,
  inward_date TEXT NOT NULL,
  inward_vehicle_reg TEXT NOT NULL,
  notes TEXT NULL,
  photo_key TEXT NULL,             -- R2 object key instead of has_photo flag
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NULL,
  updated_at TEXT NULL,
  device_info TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_inward_company ON inward_entries(company_id);

CREATE TABLE IF NOT EXISTS outward_shipments (
  id TEXT PRIMARY KEY,             -- UUID v4
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  inward_id TEXT NOT NULL REFERENCES inward_entries(id),  -- no ON DELETE CASCADE (by design)
  pipe_number TEXT NULL,
  number_of_pipes INTEGER NOT NULL,
  outward_date TEXT NOT NULL,
  outward_vehicle_reg TEXT NOT NULL,
  notes TEXT NULL,
  photo_key TEXT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NULL,
  updated_at TEXT NULL,
  device_info TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_outward_company ON outward_shipments(company_id);
CREATE INDEX IF NOT EXISTS idx_outward_inward ON outward_shipments(inward_id);

CREATE TABLE IF NOT EXISTS record_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  inward_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('inward','outward')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('create','update','delete')),
  snapshot TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  device_info TEXT
);
CREATE INDEX IF NOT EXISTS idx_history_inward ON record_history(inward_id);

CREATE TABLE IF NOT EXISTS lookup_fields (
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  label TEXT NOT NULL,
  use_lookup INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(company_id, field_key)
);

CREATE TABLE IF NOT EXISTS lookup_values (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  field_key TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE(company_id, field_key, value),
  FOREIGN KEY(company_id, field_key) REFERENCES lookup_fields(company_id, field_key) ON DELETE CASCADE
);

-- Auto-purge / retention policy (per company) — new feature agreed on in chat
CREATE TABLE IF NOT EXISTS retention_policy (
  company_id INTEGER PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  completed_retention_days INTEGER NOT NULL DEFAULT 30,
  all_retention_days INTEGER NOT NULL DEFAULT 90
);

-- Backup run log (health-check indicator — value-add agreed on in chat)
CREATE TABLE IF NOT EXISTS backup_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('system','company','auto_purge','system_restore','company_restore')),
  company_id INTEGER NULL,
  status TEXT NOT NULL CHECK(status IN ('success','failure')),
  detail TEXT NULL,
  ran_at TEXT NOT NULL
);

-- Company profile change audit trail (recommendation, implemented) — every
-- name/contact/language edit, whether made by root or the company's own
-- admin, is logged so root can see what changed without asking around.
CREATE TABLE IF NOT EXISTS company_profile_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  changed_by TEXT NOT NULL,      -- user id string (e.g. 'Admin' for root, or the company admin's id)
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_history_company ON company_profile_history(company_id);

-- Platform-wide scheduling settings (recommendation, implemented) — root
-- can configure how often the automatic backup/housekeeping sweep actually
-- runs. The Cron Trigger itself still fires daily (Cloudflare Cron Triggers
-- are fixed at deploy time in wrangler.toml, not runtime-configurable), but
-- the job only actually executes when this many days have passed since it
-- last ran — giving root a real "every N days" control without redeploying.
CREATE TABLE IF NOT EXISTS platform_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  backup_frequency_days INTEGER NOT NULL DEFAULT 7,
  housekeeping_frequency_days INTEGER NOT NULL DEFAULT 7,
  last_backup_run TEXT NULL,
  last_housekeeping_run TEXT NULL,
  support_email TEXT NULL,   -- root-configurable platform support email shown on login screen
  support_email_name TEXT NOT NULL DEFAULT 'Beam Veda Support'
);
INSERT OR IGNORE INTO platform_settings (id, backup_frequency_days, housekeeping_frequency_days) VALUES (1, 7, 7);

-- IP-level login throttle (recommendation, implemented) — a defense-in-depth
-- complement to Cloudflare's own dashboard rate-limiting rules (see
-- HOSTING_STEPS.md), catching attempts spread across many different
-- accounts/companies from one source, which per-account lockout can't.
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, attempted_at);

-- Seed: root user is inserted lazily by code on first request (needs a
-- runtime-computed PBKDF2 hash — see src/lib/bootstrap.js), not here.
