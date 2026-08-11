# Beam Veda — Beam Management Solution
## Master Specification v4 — Cloudflare Edition (as-built, supersedes v3)

**Platform: Cloudflare Workers + D1 + R2 + Cron Triggers only.** This document describes the real, primary, fully-tested deployment. For the Netlify-native port, see `BEAM_VEDA_SPEC_Netlify.md` — a separate document describing a separate project, not a variation of this one.

This document supersedes BEAM_VEDA_SPEC_V3.md. It reflects the system as actually implemented, including every change made after v3 was written. Everything in v3 that's still accurate is carried forward without repeating in full detail; this document focuses on what changed and gives a complete current picture section by section.

Automated test suite: 82 checks, all passing (node test/run.mjs), running the real backend route code against an in-memory SQLite database shaped like D1.

---

## 1. Product Identity

Unchanged from v3: Beam Veda — Beam Management Solution. White-label-first — each company's own branding is what their people see day to day; "Powered by Beam Veda" is a small secondary line.

---

## 2. Architecture & Tech Stack

Unchanged core stack (Cloudflare Workers + D1 + R2 + signed cookies + PBKDF2 + Resend + client-side image resize + Cron Triggers). Two additions:

- platform_settings table — root-configurable scheduling (see Section 11).
- Deployment packaging: `beam-veda-project_Cloudflare.zip` (§16).

---

## 3. Database Schema — changes since v3

- companies.lang_admin_default / lang_employee_default -> collapsed into a single lang_secondary column. The two-field model was replaced after clarifying the actual intent: each company has ONE secondary language its people can toggle to (alongside English), not separate admin/employee defaults.
- users.lang_override (new, nullable) — an optional, admin-set override of the company's secondary language for one specific person. This went through two revisions: first added as a required-feeling per-user picker, then removed entirely per clarification that "the decision belongs to the employee," then reintroduced in its current, correct form — optional, defaults to null (inherit company default), framed as a rare admin override rather than a routine field.
- users.role CHECK constraint extended: 'admin' | 'employee' | 'viewer' (new viewer role — see Section 8).
- company_profile_history (new) — audit trail for company profile changes (name, contact, secondary language), logging who changed what and when, whether the change came from root or the company's own admin.
- login_attempts (new) — backs the IP-level login throttle (Section 12).
- platform_settings (new, single row, id=1) — backup_frequency_days, housekeeping_frequency_days, last_backup_run, last_housekeeping_run. Backs root's configurable automatic-job schedule (Section 11).
- backup_runs.kind CHECK constraint extended to include 'system_restore' and 'company_restore' (Section 10).
- inward_entries.customer_number — now nullable (was NOT NULL in v3), per explicit instruction: Customer # is optional, same as Pipe Size already was.

---

## 4. Authentication & Sessions — changes since v3

- Login screen no longer shows the Company field at all once a company is identified via the shared signup link (?company=<slug>) or remembered in sessionStorage — the banner alone identifies which company someone's signing into. The field still appears as a fallback if someone reaches login without going through a link.
- Root recovery (added in v3, unchanged): root can set up its own Favourite Colour / Favourite Place answers and recover via a logged-out flow without a company slug.
- IP-level login throttle (new) — 20 failed attempts from one IP within 15 minutes blocks further attempts from that IP for the rest of the window, regardless of which account(s) were being tried. This is a defense-in-depth complement to Cloudflare's own dashboard rate-limiting rules (documented as a setup step, not application code).

---

## 5. Roles & Permissions — changes since v3

Three roles now: admin, employee, and viewer (new).

Viewer is read-only across the board:
- Can: view All Records, view/export/email Reports, open entry detail (including photos).
- Cannot: create/edit/delete Inward or Outward records, manage Users, manage Lookups, run Housekeeping, manage Backups. Every write endpoint explicitly rejects role === 'viewer' (via a requireWriter check added specifically for this).
- Tab set: All Records, Reports, My Account only.
- Like employees, a viewer's own password is reset by their admin, not self-service.

The effectiveCompanyScope root rule from v3 is unchanged.

---

## 6. Companies — changes since v3

- updateOwnCompany (company admin self-service) now also accepts langSecondary — per clarified intent ("admin can steer, root just helps set the initial value"), the company's own admin can change their secondary language, not just root. Logo upload remains root-only, unchanged.
- Root's banner hierarchy fixed: main heading now reads "Beam Veda" with "Root Administration" as the subtitle (was reversed before — a real, reported bug).
- Change history (new) — every name/contact/lang_secondary edit, by root or the company's own admin, is logged to company_profile_history and viewable via "View Change History" from the Edit Company modal.
- Root, working inside a selected company, now correctly gets the same full tab set (including Housekeeping) that company's own admin sees, with the company's own branding and language toggle applied, while the session badge still reads "Root" so it's never ambiguous who's actually logged in.

---

## 7. Inward & Outward — changes since v3

- Customer # is now optional (backend validation and DB constraint both updated), matching Pipe Size.
- Entry detail now shows a photo gallery, not just the inward photo. This was a real, reported bug: the modal previously only surfaced the inward photo as a text link; shipment photos existed and were uploadable but never displayed anywhere. Now every photo — inward and every shipment's — renders as a clickable thumbnail together.
- Lookups are now actually wired into the entry forms (new — a significant, previously-unnoticed gap). The Lookups management screen always worked correctly (6 fields seed correctly per company, confirmed by test), but the New Inward Entry form and the Ship Out form never consulted it — every field was always a plain text input regardless of whether "Use dropdown list" was toggled on. Now, when a field's lookup is enabled, that field renders as a dropdown populated from the company's saved values instead of free text.
- Camera capture — the Inward and Outward photo inputs now use capture="environment", so on a phone they open the camera directly instead of a generic file picker.
- listOpen (Outward tab) and getOne (entry detail) were missing company info for root — a real bug, found and fixed: listAll (All Records) had always correctly joined to companies for root's cross-company view, but listOpen and getOne hadn't, so the Outward tab and entry detail showed no company name for root even though All Records did. Both now include company_name for root consistently.

---

## 8. Users & Account Recovery — changes since v3

- New viewer role (Section 5).
- Optional per-employee language override (Section 3, Section 9) — admin-controlled, defaults to inherit.
- Users tab now has a company filter for root's cross-company view (new — the tab showed a Company column but no way to narrow the list down, unlike All Records and Reports which both got filters earlier).
- Fixed recovery questions (Favourite Colour / Favourite Place), last-active-admin protection, and root's step-up password-change flow are unchanged from v3, and the last-admin rule was explicitly re-verified to still catch attempts to demote the only admin to viewer, not just to employee.

---

## 9. Language / i18n — significant rework since v3

v3 described a company-level admin/employee language default pair plus (briefly) a per-user override that was added and then removed. The model has settled into its final, clarified form:

- Each company has ONE secondary language (companies.lang_secondary), not separate admin/employee defaults. Set by root at company creation (the "initial steer"), changeable afterward by that company's own admin.
- The header toggle is EN + that one language — for everyone in the company by default. The decision to view English or the secondary language belongs to the individual, via the toggle, every time — nothing is forced.
- Optional per-employee override (users.lang_override) — admin can set a different secondary language for one specific person, on top of the toggle model above. Still optional, still just adds a second toggle target for that person — never removes their own choice between English and whichever language applies to them.
- "Hindi" is labeled plainly as "Hindi", not "Hinglish" (that's WhatsApp's own product naming). The underlying meaning — Hindi mixed with everyday English words, not pure Devanagari — is documented as a code comment for the future translation work, not surfaced as a UI label.
- Translation coverage: only English and Hindi have real translated static UI strings right now (tab names, a handful of buttons) as a working proof of the mechanism. Other languages in the picker show their own name (native script) on the toggle button but fall back to English body text until translated.
- Binding rule for all future i18n work: only static UI text translates. User-entered data (names, IDs, notes, anything typed in) never translates, always displays exactly as entered.

---

## 10. Backups — significant addition since v3

- Restore is now real, not just documented as a recommendation. restoreDump() wipes the target scope (system-wide or one company) and re-inserts every row from a backup JSON, deleting in reverse dependency order and inserting in forward order so foreign keys are never violated mid-restore.
- Root-only, confirmation-gated: both system and company restore require typing the exact word RESTORE in the request body — same safety pattern as deleting a company (type-the-slug-to-confirm).
- Verified with an actual round-trip test, not just a UI mock: back up, mutate the data, restore, verify it reverted to the pre-mutation state. Both system-level and company-level restore have this test.
- A real production bug was caught in the process: runCompanyBackup was returning a plain JavaScript object instead of a proper Response — in the actual Workers runtime this would have crashed the request entirely the first time anyone clicked "Run Backup Now" on the company backups screen. Fixed; now wraps the result correctly, matching how runSystemBackup already did it.
- Root's Backups screen now has a Restore button next to Download on every backup file, opening a confirmation modal with an explicit warning about what gets overwritten.

---

## 11. Housekeeping — changes since v3

- Root's cross-company ("All") view now has a Housekeeping tab — a real, reported gap: the bulk multi-company Clear Photos / Delete Old Entries actions existed but were only reachable buried inside the Backups screen, with no dedicated Housekeeping tab for root at all when viewing "All." Now it has its own tab, and the duplicate bulk-housekeeping section was removed from Backups (which is now purely about backups).
- Configurable automatic-job frequency (new) — root can now set "run automatic backups every N days" and "run automatic housekeeping every N days" from the Backups tab. Since Cloudflare Cron Triggers are fixed at deploy time (not runtime-configurable), the actual mechanism is: both Cron Triggers now fire daily, and each checks platform_settings to decide whether enough days have actually passed since the job last ran before doing any real work. This gives root genuine "every N days" control without needing to touch wrangler.toml or redeploy.
- Alert-on-failure (new) — if the scheduled backup or auto-purge job fails, and ALERT_EMAIL is set (a new wrangler.toml var), an email goes out via the existing Resend integration. Previously a failure was silent. The alert path is wrapped so a failure to send the alert itself can never crash the scheduled job.

---

## 12. Security additions since v3

- IP-level login throttle (Section 4) — new, tested.
- Rate limiting documentation — HOSTING_STEPS.md now includes a step for setting up Cloudflare's own dashboard WAF rate-limiting rules on /api/auth/login, since that's the correct place for real edge-level protection (the app-level IP throttle above is a complement, not a substitute).

---

## 13. Reports — changes since v3

- Company filter dropdown (added earlier, re-verified working here) — root's cross-company Reports view has a labeled "Filter by Company:" dropdown affecting the live stats, table, CSV download, and Email Report all together.
- Viewer role now has full read/export/email access to Reports, same as admin.

---

## 14. Frontend Design System

Unchanged from v3 (top header + tape strip + dark title strip + horizontal tabs, Barlow Condensed / Inter / IBM Plex Mono, warm off-white + burnt-orange palette). No visual system changes this round — all changes were functional/data wiring.

---

## 15. Testing

82 automated checks, up from 51 and then 60 in earlier rounds. New coverage added this round: platform settings (get/update/permissions/isDue/markRun), per-employee language override (set/clear/exposed via /auth/me), viewer role (read access granted, write access blocked, admin-only endpoints blocked), backup restore (confirmation-phrase gating, full round-trip for both system and company scope), IP throttle (normal use unaffected, throttling actually kicks in), and lookup-field seeding (confirmed all 6 fields present — ruled out a backend bug when investigating a reported "only 1 lookup" issue, which turned out to be the forms-not-wired-to-lookups gap instead).

Explicitly still not covered by automated tests: visual appearance on an actual device, real email delivery through Resend, and Cloudflare's Cron Triggers actually firing on their daily schedule in production.

---

## 16. Deployment Packaging

beam-veda-project_Cloudflare.zip — the complete package described by this entire document. Deploy per HOSTING_STEPS.md. No other platform's specifics appear anywhere in this document by design — see BEAM_VEDA_SPEC_Netlify.md for the separate, independent Netlify-native project.

---

## 17. Known Limitations / Future Work (updated)

Carried forward from v3, still accurate:
- Only English and Hindi have real translated UI text.
- No higher-resolution "original" photo kept alongside the lightweight stored copy (accepted trade-off).
- Company Info self-service now covers name/contact/secondary language; logo remains root-only by design.
- No custom domain yet.

New:
- Restore is a real, tested capability, but has only been exercised against the in-memory test database, not a live D1/R2 production environment — worth a real-world dry run before depending on it in an actual emergency.

---

## 18. Post-v4 additions

### Support email (new)
`platform_settings.support_email` and `platform_settings.support_email_name` — root-configurable from the Backups / Platform Settings card. Appears on every company's login screen as a platform-level support contact (distinct from each company's own contact). Used as `reply-to` on report emails. Served publicly at `GET /api/settings/public` so the login screen can show it before login. Cleared to null = no support email shown. Tested: set, retrieve, clear, public endpoint, reply-to in emails.

### Pagination (new)
All listing endpoints now return `{rows, total, page, pageSize}` with 10/20/50 per-page chooser (default 10), sorted by `created_at DESC`. Applies to: All Records, Outward (open entries), Users, Reports table. The Inward form (single-entry submission) has no list to paginate. Stat boxes on Reports (total in/shipped/open/partial/closed) always reflect the full unfiltered dataset, not just the current page.

### Company filter on All Records and Outward (new)
Root's cross-company views now have a Company dropdown filter on All Records (was missing) and Outward tab (was missing). Joins the existing filters already present on Reports and Users.

### Housekeeping and Backups: correct multi-select model confirmed
Root selects 1, N, or All companies via a checkbox list — "All" = leave all unticked. Each company's records and files are processed independently behind the scenes (never co-mingled). The "bulk-run" routes iterate per-company internally; this is unchanged from the original design and is confirmed correct.
