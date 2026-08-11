import { ensureRootSeeded } from "./lib/bootstrap.js";
import { readSession, createSessionCookie } from "./lib/session.js";
import { json, notFound } from "./lib/http.js";
import * as authRoutes from "./routes/auth.js";
import * as companyRoutes from "./routes/companies.js";
import * as inwardRoutes from "./routes/inward.js";
import * as outwardRoutes from "./routes/outward.js";
import * as userRoutes from "./routes/users.js";
import * as lookupRoutes from "./routes/lookups.js";
import * as reportRoutes from "./routes/reports.js";
import * as backupRoutes from "./routes/backups.js";
import * as housekeepingRoutes from "./routes/housekeeping.js";
import { runSystemBackup, doSystemBackup, doCompanyBackup } from "./routes/backups.js";
import { autoPurgeSweep } from "./routes/housekeeping.js";
import { all } from "./lib/db.js";
import { sendEmail } from "./lib/email.js";
import * as settingsRoutes from "./routes/settings.js";

// Alert-on-failure (recommendation, implemented) — a scheduled backup or
// purge failing used to be silent (only visible if root happened to check
// the Backups tab). Now it emails ALERT_EMAIL if that var is set, reusing
// the same Resend integration the "Email Report" feature already uses.
// Never throws — a failed alert must not crash the cron job itself.
async function alertOnFailure(env, subject, detail) {
  if (!env.ALERT_EMAIL) return;
  try {
    await sendEmail(env, { to: env.ALERT_EMAIL, subject: `Beam Veda alert: ${subject}`, html: `<p>${subject}</p><pre>${String(detail)}</pre>` });
  } catch { /* don't let an alerting failure crash the scheduled job */ }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Lazy root-seed check. Cheap no-op after the first ever request once
    // the root row exists (single indexed lookup).
    ctx.waitUntil(ensureRootSeeded(env.DB));
    await ensureRootSeeded(env.DB); // also await once synchronously for cold start correctness

    if (!path.startsWith("/api/")) {
      // Static assets (the SPA shell) — served via the [assets] binding.
      return env.ASSETS.fetch(request);
    }

    const session = await readSession(env.SESSION_SECRET, request);

    try {
      // ---- Auth ----
      if (path === "/api/auth/login" && request.method === "POST") return authRoutes.login(request, env);
      if (path === "/api/auth/logout" && request.method === "POST") return authRoutes.logout();
      if (path === "/api/auth/me" && request.method === "GET") return authRoutes.me(request, env);

      // ---- Companies (public) ----
      let m;
      if ((m = path.match(/^\/api\/companies\/public\/([^/]+)$/)) && request.method === "GET") {
        return companyRoutes.publicCompanyInfo(env, m[1]);
      }
      if ((m = path.match(/^\/api\/companies\/public\/([^/]+)\/logo$/)) && request.method === "GET") {
        return companyRoutes.publicCompanyLogo(env, m[1]);
      }
      if ((m = path.match(/^\/api\/companies\/(\d+)\/logo$/)) && request.method === "POST") {
        return companyRoutes.uploadLogo(session, env, Number(m[1]), request);
      }

      // ---- Companies (root) ----
      if (path === "/api/companies" && request.method === "GET") return companyRoutes.listCompanies(session, env);
      if (path === "/api/companies" && request.method === "POST") return companyRoutes.createCompany(session, env, request);
      if (path === "/api/companies/me" && request.method === "PUT") return companyRoutes.updateOwnCompany(session, env, request);
      if ((m = path.match(/^\/api\/companies\/(\d+)$/)) && request.method === "PUT") {
        return companyRoutes.updateCompany(session, env, Number(m[1]), request);
      }
      if ((m = path.match(/^\/api\/companies\/(\d+)\/history$/)) && request.method === "GET") {
        return companyRoutes.getCompanyHistory(session, env, Number(m[1]));
      }
      if ((m = path.match(/^\/api\/companies\/(\d+)$/)) && request.method === "DELETE") {
        return companyRoutes.deleteCompany(session, env, Number(m[1]), request);
      }
      if ((m = path.match(/^\/api\/companies\/(\d+)\/deactivate$/)) && request.method === "POST") {
        return companyRoutes.setCompanyActive(session, env, Number(m[1]), false);
      }
      if ((m = path.match(/^\/api\/companies\/(\d+)\/reactivate$/)) && request.method === "POST") {
        return companyRoutes.setCompanyActive(session, env, Number(m[1]), true);
      }
      if (path === "/api/companies/select" && request.method === "POST") {
        const result = await companyRoutes.selectCompany(session, env, request);
        if (result.status !== 200) return result;
        const body = await result.clone().json();
        const newCookie = await createSessionCookie(env.SESSION_SECRET, { ...session, selectedCompanyId: body.selectedCompanyId });
        return json(body, 200, { "Set-Cookie": newCookie });
      }

      // ---- Inward entries ----
      if (path === "/api/inward/open" && request.method === "GET") return inwardRoutes.listOpen(session, env, url);
      if (path === "/api/inward" && request.method === "GET") return inwardRoutes.listAll(session, env, url);
      if (path === "/api/inward" && request.method === "POST") return inwardRoutes.create(session, env, request);
      if ((m = path.match(/^\/api\/inward\/([^/]+)\/history$/)) && request.method === "GET") {
        return inwardRoutes.getHistory(session, env, m[1]);
      }
      if ((m = path.match(/^\/api\/inward\/([^/]+)\/photo$/)) && request.method === "GET") {
        return inwardRoutes.getPhoto(session, env, m[1], url);
      }
      if ((m = path.match(/^\/api\/inward\/([^/]+)$/)) && request.method === "GET") {
        return inwardRoutes.getOne(session, env, m[1]);
      }
      if ((m = path.match(/^\/api\/inward\/([^/]+)$/)) && request.method === "PUT") {
        return inwardRoutes.update(session, env, m[1], request);
      }
      if ((m = path.match(/^\/api\/inward\/([^/]+)$/)) && request.method === "DELETE") {
        return inwardRoutes.remove(session, env, m[1]);
      }

      // ---- Outward shipments ----
      if ((m = path.match(/^\/api\/outward\/inward\/([^/]+)$/)) && request.method === "GET") {
        return outwardRoutes.listForInward(session, env, m[1]);
      }
      if ((m = path.match(/^\/api\/outward\/([^/]+)\/photo$/)) && request.method === "GET") {
        return outwardRoutes.getPhoto(session, env, m[1], url);
      }
      if ((m = path.match(/^\/api\/outward\/([^/]+)$/)) && request.method === "POST") {
        return outwardRoutes.create(session, env, m[1], request);
      }
      if ((m = path.match(/^\/api\/outward\/([^/]+)$/)) && request.method === "PUT") {
        return outwardRoutes.update(session, env, m[1], request);
      }
      if ((m = path.match(/^\/api\/outward\/([^/]+)$/)) && request.method === "DELETE") {
        return outwardRoutes.remove(session, env, m[1]);
      }

      // ---- Users ----
      if (path === "/api/users" && request.method === "GET") return userRoutes.list(session, env, url);
      if (path === "/api/users" && request.method === "POST") return userRoutes.create(session, env, request);
      if ((m = path.match(/^\/api\/users\/(\d+)$/)) && request.method === "PUT") {
        return userRoutes.update(session, env, Number(m[1]), request);
      }
      if ((m = path.match(/^\/api\/users\/(\d+)$/)) && request.method === "DELETE") {
        return userRoutes.remove(session, env, Number(m[1]));
      }
      if (path === "/api/users/me/profile" && request.method === "PUT") return userRoutes.updateMyProfile(session, env, request);
      if (path === "/api/users/me/recovery-questions" && request.method === "GET") return userRoutes.getMyRecoveryQuestions(session, env);
      if (path === "/api/users/me/recovery-questions" && request.method === "PUT") return userRoutes.setMyRecoveryQuestions(session, env, request);
      if (path === "/api/users/me/password-verified" && request.method === "PUT") return userRoutes.rootChangePasswordVerified(session, env, request);
      if (path === "/api/auth/recovery/root/questions" && request.method === "GET") return userRoutes.rootRecoveryQuestions(env);
      if (path === "/api/auth/recovery/root/reset" && request.method === "POST") return userRoutes.rootRecoveryReset(env, request);
      if ((m = path.match(/^\/api\/auth\/recovery\/([^/]+)\/([^/]+)\/questions$/)) && request.method === "GET") {
        return userRoutes.recoveryQuestions(env, m[1], m[2]);
      }
      if ((m = path.match(/^\/api\/auth\/recovery\/([^/]+)\/([^/]+)\/reset$/)) && request.method === "POST") {
        return userRoutes.recoveryReset(env, m[1], m[2], request);
      }

      // ---- Lookups ----
      if (path === "/api/lookups" && request.method === "GET") return lookupRoutes.get(session, env);
      if ((m = path.match(/^\/api\/lookups\/fields\/([^/]+)$/)) && request.method === "PUT") {
        return lookupRoutes.setUseLookup(session, env, m[1], request);
      }
      if ((m = path.match(/^\/api\/lookups\/fields\/([^/]+)\/values$/)) && request.method === "POST") {
        return lookupRoutes.addValue(session, env, m[1], request);
      }
      if ((m = path.match(/^\/api\/lookups\/fields\/([^/]+)\/values\/([^/]+)$/)) && request.method === "DELETE") {
        return lookupRoutes.removeValue(session, env, m[1], decodeURIComponent(m[2]));
      }

      // ---- Reports ----
      if (path === "/api/reports" && request.method === "GET") return reportRoutes.summary(session, env, url);
      if (path === "/api/reports/csv" && request.method === "GET") return reportRoutes.csv(session, env, url);
      if (path === "/api/reports/email" && request.method === "POST") return reportRoutes.emailReport(session, env, url, request);

      // ---- Backups ----
      if (path === "/api/backups/system/run" && request.method === "POST") return backupRoutes.runSystemBackup(session, env);
      if (path === "/api/backups/system" && request.method === "GET") return backupRoutes.listSystemBackups(session, env);
      if ((m = path.match(/^\/api\/backups\/system\/([^/]+)$/)) && request.method === "GET") return backupRoutes.downloadSystemBackup(session, env, m[1]);
      if ((m = path.match(/^\/api\/backups\/system\/([^/]+)$/)) && request.method === "DELETE") return backupRoutes.deleteSystemBackup(session, env, m[1]);
      if (path === "/api/backups/system/cleanup" && request.method === "POST") return backupRoutes.cleanupSystemBackups(session, env, request);
      if ((m = path.match(/^\/api\/backups\/system\/([^/]+)\/restore$/)) && request.method === "POST") return backupRoutes.restoreSystemBackup(session, env, m[1], request);

      if (path === "/api/backups/company/run" && request.method === "POST") return backupRoutes.runCompanyBackup(session, env, url);
      if (path === "/api/backups/company/bulk-run" && request.method === "POST") return backupRoutes.bulkRunCompanyBackups(session, env, request);
      if (path === "/api/backups/company" && request.method === "GET") return backupRoutes.listCompanyBackups(session, env, url);
      if ((m = path.match(/^\/api\/backups\/company\/([^/]+)$/)) && request.method === "GET") return backupRoutes.downloadCompanyBackup(session, env, m[1], url);
      if ((m = path.match(/^\/api\/backups\/company\/([^/]+)$/)) && request.method === "DELETE") return backupRoutes.deleteCompanyBackup(session, env, m[1], url);
      if (path === "/api/backups/company/cleanup" && request.method === "POST") return backupRoutes.cleanupCompanyBackups(session, env, request);
      if ((m = path.match(/^\/api\/backups\/company\/([^/]+)\/restore$/)) && request.method === "POST") return backupRoutes.restoreCompanyBackup(session, env, m[1], url, request);
      if (path === "/api/backups/health" && request.method === "GET") return backupRoutes.backupHealth(session, env);

      // ---- Housekeeping ----
      if (path === "/api/housekeeping/stats" && request.method === "GET") return housekeepingRoutes.stats(session, env, url);
      if (path === "/api/housekeeping/clear-photos" && request.method === "POST") return housekeepingRoutes.clearPhotos(session, env, request, url);
      if (path === "/api/housekeeping/delete-old" && request.method === "POST") return housekeepingRoutes.deleteOld(session, env, request, url);
      if (path === "/api/housekeeping/bulk-clear-photos" && request.method === "POST") return housekeepingRoutes.bulkClearPhotos(session, env, request);
      if (path === "/api/housekeeping/bulk-delete-old" && request.method === "POST") return housekeepingRoutes.bulkDeleteOld(session, env, request);
      if (path === "/api/housekeeping/retention" && request.method === "GET") return housekeepingRoutes.getRetentionPolicy(session, env, url);
      if (path === "/api/housekeeping/retention" && request.method === "PUT") return housekeepingRoutes.setRetentionPolicy(session, env, request, url);

      // ---- Platform settings (backup/housekeeping frequency) ----
      if (path === "/api/settings/platform" && request.method === "GET") return settingsRoutes.getSettings(session, env);
      if (path === "/api/settings/platform" && request.method === "PUT") return settingsRoutes.updateSettings(session, env, request);
      if (path === "/api/settings/public" && request.method === "GET") return settingsRoutes.getPublicSettings(env);

      return notFound("No such API route");
    } catch (e) {
      return json({ error: "Internal error", detail: String(e) }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    // Both crons now fire DAILY (see wrangler.toml); root's configured
    // frequency (platform_settings) decides whether the work actually runs.
    if (event.cron === "0 2 * * *") {
      if (!(await settingsRoutes.isDue(env, "backup"))) return;
      const result = await doSystemBackup(env);
      if (!result.ok) await alertOnFailure(env, "System backup failed", result.error);
      await settingsRoutes.markRun(env, "backup");
      return;
    }
    if (event.cron === "0 3 * * *") {
      if (!(await settingsRoutes.isDue(env, "housekeeping"))) return;
      const companies = await all(env.DB, `SELECT id, name FROM companies WHERE active = 1`);
      for (const c of companies) {
        const result = await doCompanyBackup(env, c.id);
        if (!result.ok) await alertOnFailure(env, `Company backup failed: ${c.name}`, result.error);
      }
      try {
        await autoPurgeSweep(env);
      } catch (e) {
        await alertOnFailure(env, "Auto-purge sweep failed", String(e));
      }
      await settingsRoutes.markRun(env, "housekeeping");
    }
  },
};
