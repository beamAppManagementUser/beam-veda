# Beam Veda — Beam Management Solution
## Master Specification v3 (as-built, post-chat revisions)

This document supersedes the original `beam-stock-master-spec-v2.md`. It reflects the system as actually implemented, including every change made during the build conversation. Where this document differs from the original spec, the difference is called out explicitly with the reason.

---

## 1. Product Identity

- **Product name:** Beam Veda — Beam Management Solution
- **Positioning:** White-label-first. Each tenant company's own branding (logo, name, contact) is what employees see day to day; "Powered by Beam Veda" appears as a small, secondary line under the company's own name.
- **Domain:** Not yet purchased. Runs on a free `*.workers.dev` Cloudflare subdomain until `beamveda.com` (or similar) is bought and attached — a zero-code-change step once that happens (see §12).

---

## 2. Architecture & Tech Stack

**Platform: Cloudflare Workers** (chosen over Render/Fly.io/Netlify for lowest ongoing maintenance — no server to babysit, no disk to manage, managed cron).

| Concern | Technology | Note |
|---|---|---|
| Compute | Cloudflare Workers | Single `src/index.js` entrypoint, hand-rolled router (no framework) |
| Database | Cloudflare D1 (SQLite-compatible) | `schema.sql` is the source of truth |
| File storage | Cloudflare R2 | Photos, logos, backup exports — all under `companies/<id>/...` key prefixes |
| Sessions | Signed, httpOnly cookies (HMAC-SHA256 via Web Crypto) | No session store — stateless by design |
| Password hashing | PBKDF2-SHA256 (100,000 iterations) via Web Crypto | Not bcryptjs (original spec's choice) — bcryptjs is pure-JS CPU-bound hashing that risks exceeding Workers' per-request CPU limit |
| Email | Resend HTTP API | Not nodemailer/SMTP (original spec's choice) — Workers cannot open raw SMTP/TCP connections |
| Image processing | Client-side (canvas, in app.js) | Not sharp (original spec's choice) — sharp is a native binary, incompatible with the Workers runtime |
| Scheduled jobs | Cloudflare Cron Triggers | Two schedules registered in wrangler.toml |
| Frontend | Vanilla JS SPA, no framework | public/index.html + public/app.js |

This is a deliberate, substantial deviation from the original spec's Node.js/Express/better-sqlite3/local-disk architecture, made necessary by the choice of Cloudflare Workers (a serverless/edge platform with no persistent filesystem or long-running process) over a traditional always-on Node server.

---

## 3. Database Schema (current)

All tables in `schema.sql`. Key points and deviations from the original spec:

- **companies**: slug (unique, case-insensitive), name, logo_key (R2 object key, was unused in original build — now wired to an actual upload/display feature), contact, lang_admin_default / lang_employee_default (language codes — see §10), active, created_at.
- **users**: composite-unique on (company_id, id) so the same User ID can exist in different companies. is_root flag distinguishes the single platform-owner row (company_id IS NULL). failed_attempts / locked_until implement the 5-attempt lockout.
- **admin_recovery**: one row per admin/root user. Deviation: question1/question2 are no longer admin-chosen free text — they are hardcoded to "Favourite Colour" and "Favourite Place" for every account (root included). Only the answer hashes are stored.
- **inward_entries**: customer_number and pipe_size are both nullable (deviation from original spec, which had customer_number NOT NULL; pipe_size was made optional first, customer_number second, both per explicit instruction during the build). photo_key replaces the original's has_photo boolean + local file path.
- **outward_shipments**: no ON DELETE CASCADE from inward_entries intentionally — deleting an inward entry with shipments against it is blocked at the application layer instead (see §7).
- **record_history**: append-only audit trail, one row per create/update/delete on either entity type.
- **lookup_fields** / **lookup_values**: per-company custom dropdown values, seeded automatically when a company is created.
- **retention_policy**: new table, not in the original spec — backs the auto-purge feature (see §11).
- **backup_runs**: new table, not in the original spec — a health-check log of every backup/purge job, success or failure, surfaced in the Backups tab.

---

## 4. Authentication & Sessions

- Login: POST /api/auth/login with { id, password, companySlug? }. Omitting companySlug is how root logs in.
- Sessions are not stored server-side. The session payload (pk, id, role, companyId, isRoot, selectedCompanyId) is HMAC-signed and carried entirely in an httpOnly cookie, 12-hour expiry.
- 5 failed attempts locks the account for 15 minutes.
- **Root recovery (new — did not exist in original spec):** root previously had no way to recover a forgotten password. Root can now set up its own Favourite Colour / Favourite Place answers (via My Account) and use a logged-out recovery flow at /api/auth/recovery/root/questions + /reset, mirroring the company-admin recovery flow but without a company slug.
- **Locked/branded login links (new):** a URL like https://\<host\>/?company=\<slug\> pre-fills and locks the Company field, and pulls that company's real name/logo/contact onto the login screen before the person even logs in. Root's Copy Signup Link button (Companies tab) generates this. On logout, a company user is routed straight back to their own locked login page, not a generic one (remembered via sessionStorage).

---

## 5. Roles & Permissions

Three roles: root (is_root = 1), admin, employee. The single governing rule, unchanged from the original spec:

> effectiveCompanyScope(session) — if the logged-in user is not root, they are always scoped to their own company_id, full stop. If they are root, scope is null/"All" until root explicitly selects a company (via Companies → Work in this company); while scope is "All", root can view but not create/edit records (must pick a specific company first).

**Deviation fixed mid-build:** originally, selecting a specific company only gave root a reduced tab set. This was a bug — root now correctly gets the full company-admin tab set (Inward, Outward, Lookups, Housekeeping, etc.) once a company is selected, identical to what that company's own admin sees.

---

## 6. Companies

Root-only CRUD: Create, Edit (name/contact/both language defaults — originally only name/contact were editable, expanded per explicit instruction), Deactivate/Reactivate (blocks/restores that company's logins without deleting data), Delete (requires typing the exact slug to confirm; also now cleans up every R2 file belonging to that company, not just database rows — this was a gap in the original build, closed once file storage became company-namespaced).

**Company logo (new — not in original build):** root can upload a logo (Edit Company modal), stored at companies/\<id\>/logo.png, resized client-side to 400px/quality 0.85 before upload. Displayed in the app header and on that company's login screen. Served publicly (no login required) at GET /api/companies/public/\<slug\>/logo specifically so it renders on the pre-login screen.

---

## 7. Inward & Outward (core stock tracking)

Split into two separate tabs, per the actual UX sample (a mid-build correction — an earlier draft had merged them into one "Open Entries" view, which did not match the provided design).

- **Inward tab**: a form only — Customer # (optional), Party Name (required), Pipe # (optional), Number of Pipes (required, positive integer), Pipe Size (optional), Inward Date (required, cannot be in the future), Inward Vehicle Reg (required), Notes, Photo.
- **Outward tab**: lists every entry not yet fully shipped, with a live open-count in the header. Clicking an entry opens its detail: shipped/remaining quantities, status pill (open/partial/closed), inward photo, and — if quantity remains — a Ship Out action.
- **Ship Out**: Outward Qty (required, cannot exceed remaining balance), Outward Date (required, cannot be in the future, cannot be before the Inward Date), Outward Vehicle Reg (required), Notes, Photo.
- **Balance/status logic** (unchanged core rule): remainingQty = number_of_pipes - SUM(shipments.number_of_pipes), computed live, never stored. Status: open (0 shipped), partial (some shipped, some remaining), closed (remainingQty = 0).
- **Edit permissions**: an employee can edit an Inward entry only while it has zero shipments against it; once any shipment exists, only an admin (or root acting as that company) can edit it further.
- **Delete protection**: an Inward entry with shipments against it cannot be deleted directly (only via Housekeeping's bulk cleanup, which removes both sides together).

---

## 8. Users & Account Recovery

- Company admins manage their own company's users (add/deactivate/reactivate/delete). A company can never be left with zero active admins — enforced on both deactivate and delete.
- **Fixed recovery questions (deviation from original spec):** every admin/root account uses the same two questions — "Favourite Colour" and "Favourite Place" — rather than admin-authored free-text questions. Only the answers are user-specific.
- Root's own password change requires answering its two security questions first (a step-up flow), separate from a company admin's simpler in-session password change.

---

## 9. Lookups

Per-company custom dropdown values for six fields (Customer #, Party Name, Pipe #, Pipe Size, Inward Vehicle Reg, Outward Vehicle Reg), each with a useLookup toggle — company decides per field whether to enforce a dropdown or leave it free text. Seeded automatically (all off) when a company is created.

---

## 10. Language / i18n

- **Company language defaults**: root sets an Admin-screens language and an Employee-screens language per company (Add/Edit Company), from a list of major Indian languages plus English.
- **"Hindi" labeling (explicit instruction):** the dropdown option is labeled plainly "Hindi", not "Hinglish" — that term belongs to WhatsApp's own product naming, not this app's. The meaning is still Hindi mixed with everyday English words (as commonly spoken/typed), not pure Devanagari-only Hindi — this is a code comment/behavioral note for whichever engineer eventually builds full translation, not a UI label.
- **Working language toggle (new — did not exist in original build):** a real EN/हिंदी toggle sits in the app header, wired to an i18n dictionary (I18N in app.js) covering tab names and key buttons. English and Hindi are populated as a working proof; the other Indian languages in the company-settings dropdown currently fall back to English display until translated — this is stated plainly rather than implied to be complete.
- **Translation rule (explicit instruction, binding on all future i18n work):** only static UI text — labels, buttons, tab names — is ever translated. User-entered data (usernames, company names, party names, notes, anything someone typed) is never translated and always displays exactly as entered, regardless of language setting.

---

## 11. Housekeeping & Retention

- **Manual cleanup** (per company, admin-triggered): Clear Photos and Delete Old Entries, both scoped to closed entries whose last shipment date is on or before a chosen cutoff date. (A cutoff-date off-by-one bug — entries closed exactly on the cutoff were being skipped — was caught by the automated test suite and fixed.)
- **Automatic purge** (new — not in original spec, added per explicit instruction): a per-company toggle + retention-days setting, swept weekly by a Cloudflare Cron Trigger, using the same underlying delete logic as the manual button.
- **Root bulk actions (new):** root can run Clear Photos or Delete Old Entries across one, several (checkbox-selected), or all companies at once from the Backups tab — not just one company at a time.

---

## 12. Backups

- **System backup** (root only): a full JSON dump of every table, downloadable, stored at system/system_\<timestamp\>.json in R2. Replaces the original spec's "raw SQLite file copy" concept, which doesn't map onto D1.
- **Company data backup** (that company's own admins, or root acting as them): a JSON export of that company's own tables only. Deliberately excludes users and admin_recovery — credentials never leave the system as a downloadable file.
- **Root bulk company backups (new):** run backups for one, several, or all companies in one action.
- **Scheduled backups:** two Cron Triggers in wrangler.toml — system backup weekly (Sunday 02:00 UTC), company backups + auto-purge sweep weekly (Sunday 03:00 UTC).
- **Health-check log:** every backup/purge run (success or failure) is recorded in backup_runs and surfaced as a small table in the Backups tab, so a silent scheduled-job failure isn't invisible.

---

## 13. Photos & File Storage

- **Storage key scheme (deviation from original build, corrected per explicit instruction):** every file — photos, logos, backups — is stored under companies/\<company-id\>/.... Originally photos were stored as flat inward/\<id\>... / outward/\<id\>... keys with no company grouping, which made root-level bulk filtering/action by company harder than necessary. Fixed so root can trivially reason about "everything belonging to Company X," and so deleting a company now also cleans up all of its files automatically.
- **Compression (explicit instruction: keep storage lightweight):** photos are resized client-side (canvas, no server-side image library — Workers can't run sharp) to 1200px max dimension, JPEG quality 0.72, before upload.
- **Download/Share (explicit instruction, with an acknowledged trade-off):** only one compressed copy of each photo is kept — there is no separate higher-resolution original stored. Download and View both serve that exact same file, unmodified, with no further recompression — it is "best available" relative to what's stored, not a hidden full-resolution original. This trade-off was surfaced explicitly and accepted.

---

## 14. Reports

Admin-only. Live summary (entries, total in, total shipped, open/partial/closed counts), CSV download, and "Email Report" (via Resend — see §2), all respecting the same company-scoping rule as everything else, with a Company column added automatically when root views "All."

---

## 15. Frontend Design System (as-built, matching the provided UX sample)

A prior draft used a generic sidebar dashboard that did not match the provided UX mockup — this was identified and corrected. The current build follows the actual sample:

- **Layout:** top header bar (brand logo + name + tagline + contact block) → accent-colored "tape" strip → dark title strip (page title + language toggle + session info + logout) → horizontal tab bar → content.
- **Type:** Barlow Condensed (headings/tabs), Inter (body), IBM Plex Mono (IDs/slugs/filenames).
- **Palette:** warm off-white background (#EEF0EC), dark ink (#1B2430), steel blue-grey accents, burnt-orange accent (#D2691E) for primary actions and the tape strip.
- **Components:** pill-shaped status badges (open/partial/closed), card-based sections, responsive tables that collapse to label/value pairs on narrow screens.

---

## 16. Testing

A functional test suite (test/run.mjs) runs the real, unmodified route code against an in-memory SQLite database shaped like D1 (via Node's built-in node:sqlite) plus a mock of R2 — not a UI simulation, actual logic execution. 51 automated checks currently cover: login/lockout, company lifecycle, user management and the last-admin protection, entry creation (including both optional-field cases), the full balance/shipping math (including the over-shipment block and open→partial→closed transitions), edit/delete permission boundaries, lookups, report totals, retention policy and auto-purge (including the cutoff bug this suite caught and fixed), backups, and root's recovery flow. Re-run anytime with node test/run.mjs.

**Explicitly not covered** (needs a real deploy + manual click-through): visual appearance on an actual device, real email delivery through Resend, and Cloudflare's Cron Triggers actually firing on schedule in production.

---

## 17. Known Limitations / Future Work

- Only English and Hindi have real translated UI text; the other Indian languages in the company-settings dropdown fall back to English until translated.
- No higher-resolution "original" photo is kept alongside the lightweight stored copy — an accepted trade-off, revisit if a genuine need for full-resolution downloads emerges.
- Company Info self-service editing (for a company's own admin) is currently a stub pointing them to root; could be built out if companies want to self-manage more than users/lookups.
- No custom domain yet — signup links are currently long workers.dev URLs; resolves automatically once beamveda.com is purchased and attached (see HOSTING_STEPS.md).
