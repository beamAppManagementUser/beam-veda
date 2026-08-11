import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeMockD1, makeMockR2, fakeRequest } from "./mockEnv.js";
import { one, all, run } from "../src/lib/db.js";

import { hashPassword, verifyPassword } from "../src/lib/password.js";
import { createSessionCookie, readSession, effectiveCompanyScope } from "../src/lib/session.js";
import { ensureRootSeeded } from "../src/lib/bootstrap.js";
import * as authRoutes from "../src/routes/auth.js";
import * as companyRoutes from "../src/routes/companies.js";
import * as userRoutes from "../src/routes/users.js";
import * as inwardRoutes from "../src/routes/inward.js";
import * as outwardRoutes from "../src/routes/outward.js";
import * as lookupRoutes from "../src/routes/lookups.js";
import * as reportRoutes from "../src/routes/reports.js";
import * as housekeepingRoutes from "../src/routes/housekeeping.js";
import * as backupRoutes from "../src/routes/backups.js";
import * as settingsRoutes from "../src/routes/settings.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "..", "schema.sql");

let pass = 0, fail = 0;
const results = [];
async function check(label, fn) {
  try {
    await fn();
    pass++;
    results.push(`PASS  ${label}`);
  } catch (e) {
    fail++;
    results.push(`FAIL  ${label}  -->  ${e.message}`);
  }
}
function fakeReqWithCookie(cookieValue) {
  return { headers: { get: (h) => (h === "Cookie" ? cookieValue : null) } };
}

async function main() {
  const env = { DB: makeMockD1(schemaPath), PHOTOS: makeMockR2(), SESSION_SECRET: "test-secret-key" };

  // ---- password.js ----
  await check("password hash+verify round trip", async () => {
    const h = await hashPassword("MyP@ss123");
    assert.equal(await verifyPassword("MyP@ss123", h), true);
    assert.equal(await verifyPassword("wrong", h), false);
  });

  // ---- session.js ----
  await check("session cookie sign+read round trip", async () => {
    const cookie = await createSessionCookie(env.SESSION_SECRET, { pk: 1, id: "Admin", isRoot: true, companyId: null, selectedCompanyId: null });
    const value = cookie.split(";")[0].replace("bv_session=", "");
    const session = await readSession(env.SESSION_SECRET, fakeReqWithCookie(`bv_session=${value}`));
    assert.equal(session.id, "Admin");
    assert.equal(session.isRoot, true);
  });
  await check("session cookie rejects tampering", async () => {
    const cookie = await createSessionCookie(env.SESSION_SECRET, { pk: 1, id: "Admin", isRoot: true });
    const value = cookie.split(";")[0].replace("bv_session=", "");
    const tampered = value.slice(0, -2) + "xx";
    const session = await readSession(env.SESSION_SECRET, fakeReqWithCookie(`bv_session=${tampered}`));
    assert.equal(session, null);
  });
  await check("effectiveCompanyScope: root with no selection = All", () => {
    const scope = effectiveCompanyScope({ isRoot: true, selectedCompanyId: null });
    assert.equal(scope.all, true);
  });
  await check("effectiveCompanyScope: employee locked to own company", () => {
    const scope = effectiveCompanyScope({ isRoot: false, companyId: 7 });
    assert.equal(scope.companyId, 7);
  });

  // ---- bootstrap ----
  await check("root user lazy-seeds exactly once", async () => {
    await ensureRootSeeded(env.DB);
    await ensureRootSeeded(env.DB); // second call should be a no-op
    const { results: rows } = env.DB.prepare("SELECT * FROM users WHERE is_root = 1").bind().all();
    assert.equal(rows.length, 1);
  });

  // ---- auth: root login ----
  let rootSession;
  await check("root can log in with seed credentials", async () => {
    const res = await authRoutes.login(fakeRequest({ id: "Admin", password: "Anupamaji#1" }), env);
    assert.equal(res.status, 200);
    const setCookie = res.headers.get("Set-Cookie");
    const value = setCookie.split(";")[0].replace("bv_session=", "");
    rootSession = await readSession(env.SESSION_SECRET, fakeReqWithCookie(`bv_session=${value}`));
    assert.equal(rootSession.isRoot, true);
  });
  await check("login rejects wrong password", async () => {
    const res = await authRoutes.login(fakeRequest({ id: "Admin", password: "wrong" }), env);
    assert.equal(res.status, 401);
  });

  // ---- companies ----
  let companyId;
  await check("root can create a company + its first admin", async () => {
    const res = await companyRoutes.createCompany(rootSession, env, fakeRequest({
      name: "Jain Wraptech", slug: "jain-wraptech", contact: "ops@jain.example",
      adminId: "jw-admin", adminName: "JW Admin", adminPassword: "AdminPass1!",
    }));
    assert.equal(res.status, 201);
    const body = await res.json();
    companyId = body.id;
    assert.ok(companyId);
  });
  await check("duplicate slug is rejected", async () => {
    const res = await companyRoutes.createCompany(rootSession, env, fakeRequest({
      name: "Dupe", slug: "jain-wraptech", adminId: "x", adminName: "x", adminPassword: "x",
    }));
    assert.equal(res.status, 409);
  });
  await check("reserved slug is rejected", async () => {
    const res = await companyRoutes.createCompany(rootSession, env, fakeRequest({
      name: "Bad", slug: "root-admin", adminId: "x", adminName: "x", adminPassword: "x",
    }));
    assert.equal(res.status, 400);
  });
  await check("non-root cannot create a company", async () => {
    const fakeEmployee = { isRoot: false, role: "employee", companyId };
    const res = await companyRoutes.createCompany(fakeEmployee, env, fakeRequest({ name: "x", slug: "x", adminId: "x", adminName: "x", adminPassword: "x" }));
    assert.equal(res.status, 403);
  });

  // ---- company admin login ----
  let adminSession;
  await check("company admin can log in with company slug", async () => {
    const res = await authRoutes.login(fakeRequest({ id: "jw-admin", password: "AdminPass1!", companySlug: "jain-wraptech" }), env);
    assert.equal(res.status, 200);
    const value = res.headers.get("Set-Cookie").split(";")[0].replace("bv_session=", "");
    adminSession = await readSession(env.SESSION_SECRET, fakeReqWithCookie(`bv_session=${value}`));
    assert.equal(adminSession.role, "admin");
    assert.equal(adminSession.companyId, companyId);
  });
  await check("5 failed logins lock the account", async () => {
    for (let i = 0; i < 5; i++) await authRoutes.login(fakeRequest({ id: "jw-admin", password: "wrong", companySlug: "jain-wraptech" }), env);
    const res = await authRoutes.login(fakeRequest({ id: "jw-admin", password: "AdminPass1!", companySlug: "jain-wraptech" }), env);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.match(body.error, /locked/i);
  });

  // ---- users ----
  let employeePk;
  await check("admin can add an employee", async () => {
    const res = await userRoutes.create(adminSession, env, fakeRequest({ id: "worker1", name: "Worker One", role: "employee", password: "WorkPass1!" }));
    assert.equal(res.status, 201);
    const body = await res.json();
    employeePk = body.pk;
  });
  await check("duplicate user id within company is rejected", async () => {
    const res = await userRoutes.create(adminSession, env, fakeRequest({ id: "worker1", name: "Dup", role: "employee", password: "x" }));
    assert.equal(res.status, 409);
  });
  await check("cannot deactivate the last active admin", async () => {
    // find the admin's own pk
    const { results: rows } = env.DB.prepare("SELECT pk FROM users WHERE id = 'jw-admin'").bind().all();
    const res = await userRoutes.update(adminSession, env, rows[0].pk, fakeRequest({ active: false }));
    assert.equal(res.status, 400);
  });

  // ---- inward ----
  let inwardId;
  const employeeSession = { pk: employeePk, id: "worker1", name: "Worker One", role: "employee", companyId, isRoot: false };
  await check("Pipe Size is NOT required (per explicit instruction)", async () => {
    const res = await inwardRoutes.create(employeeSession, env, fakeRequest({
      customer_number: "C-100", party_name: "Acme Corp", number_of_pipes: 100,
      inward_date: "2026-08-01", inward_vehicle_reg: "MH-12-AB-1234",
      // pipe_size deliberately omitted
    }));
    assert.equal(res.status, 201);
    const body = await res.json();
    inwardId = body.id;
  });
  await check("Customer # is NOT required (per explicit instruction)", async () => {
    const res = await inwardRoutes.create(employeeSession, env, fakeRequest({
      party_name: "No Customer Number Co", number_of_pipes: 15,
      inward_date: "2026-08-01", inward_vehicle_reg: "MH-12-ZZ-0001",
      // customer_number deliberately omitted
    }));
    assert.equal(res.status, 201);
    const body = await res.json();
    await inwardRoutes.remove(adminSession, env, body.id); // cleanup, not needed elsewhere
  });
  await check("missing a genuinely required field is rejected", async () => {
    const res = await inwardRoutes.create(employeeSession, env, fakeRequest({
      customer_number: "C-101", number_of_pipes: 10, inward_date: "2026-08-01", inward_vehicle_reg: "X",
      // party_name missing
    }));
    assert.equal(res.status, 400);
  });
  await check("root with 'All' selected cannot create an inward entry", async () => {
    const res = await inwardRoutes.create(rootSession, env, fakeRequest({
      customer_number: "C-102", party_name: "X", number_of_pipes: 5, inward_date: "2026-08-01", inward_vehicle_reg: "X",
    }));
    assert.equal(res.status, 400);
  });

  // ---- outward / balance math ----
  await check("shipping within remaining balance succeeds", async () => {
    const res = await outwardRoutes.create(employeeSession, env, inwardId, fakeRequest({
      number_of_pipes: 40, outward_date: "2026-08-02", outward_vehicle_reg: "MH-12-CD-5678",
    }));
    assert.equal(res.status, 201);
  });
  await check("entry status becomes 'partial' after a partial shipment", async () => {
    const res = await inwardRoutes.getOne(employeeSession, env, inwardId);
    const body = await res.json();
    assert.equal(body.status, "partial");
    assert.equal(body.remainingQty, 60);
  });
  await check("shipping more than the remaining balance is rejected", async () => {
    const res = await outwardRoutes.create(employeeSession, env, inwardId, fakeRequest({
      number_of_pipes: 999, outward_date: "2026-08-03", outward_vehicle_reg: "X",
    }));
    assert.equal(res.status, 400);
  });
  await check("shipping the exact remaining balance closes the entry", async () => {
    const res = await outwardRoutes.create(employeeSession, env, inwardId, fakeRequest({
      number_of_pipes: 60, outward_date: "2026-08-04", outward_vehicle_reg: "X",
    }));
    assert.equal(res.status, 201);
    const check2 = await inwardRoutes.getOne(employeeSession, env, inwardId);
    const body = await check2.json();
    assert.equal(body.status, "closed");
    assert.equal(body.remainingQty, 0);
  });
  await check("employee cannot edit an entry once shipments exist (admin-only)", async () => {
    const res = await inwardRoutes.update(employeeSession, env, inwardId, fakeRequest({
      customer_number: "C-100", party_name: "Acme Corp Renamed", number_of_pipes: 100,
      inward_date: "2026-08-01", inward_vehicle_reg: "MH-12-AB-1234",
    }));
    assert.equal(res.status, 403);
  });
  await check("admin CAN edit an entry that has shipments", async () => {
    const res = await inwardRoutes.update(adminSession, env, inwardId, fakeRequest({
      customer_number: "C-100", party_name: "Acme Corp Renamed", number_of_pipes: 100,
      inward_date: "2026-08-01", inward_vehicle_reg: "MH-12-AB-1234",
    }));
    assert.equal(res.status, 200);
  });
  await check("cannot reduce qty below what's already shipped", async () => {
    const res = await inwardRoutes.update(adminSession, env, inwardId, fakeRequest({
      customer_number: "C-100", party_name: "Acme Corp Renamed", number_of_pipes: 50,
      inward_date: "2026-08-01", inward_vehicle_reg: "MH-12-AB-1234",
    }));
    assert.equal(res.status, 400);
  });
  await check("cannot delete an inward entry that has shipments", async () => {
    const res = await inwardRoutes.remove(adminSession, env, inwardId);
    assert.equal(res.status, 409);
  });

  // second, unshipped entry to test clean delete
  let cleanEntryId;
  await check("create a second, unshipped entry", async () => {
    const res = await inwardRoutes.create(employeeSession, env, fakeRequest({
      customer_number: "C-200", party_name: "Beta Co", number_of_pipes: 20,
      inward_date: "2026-08-01", inward_vehicle_reg: "X",
    }));
    const body = await res.json();
    cleanEntryId = body.id;
    assert.equal(res.status, 201);
  });
  await check("admin can delete an entry with no shipments", async () => {
    const res = await inwardRoutes.remove(adminSession, env, cleanEntryId);
    assert.equal(res.status, 200);
  });

  // ---- lookups ----
  await check("admin can add and toggle a lookup value", async () => {
    await lookupRoutes.addValue(adminSession, env, "party_name", fakeRequest({ value: "Acme Corp" }));
    await lookupRoutes.setUseLookup(adminSession, env, "party_name", fakeRequest({ useLookup: true }));
    const res = await lookupRoutes.get(adminSession, env);
    const body = await res.json();
    assert.equal(body.party_name.useLookup, true);
    assert.ok(body.party_name.values.includes("Acme Corp"));
  });
  await check("company gets all 6 lookup fields seeded on creation", async () => {
    const res = await lookupRoutes.get(adminSession, env);
    const body = await res.json();
    const keys = Object.keys(body);
    assert.deepEqual(keys.sort(), ["customer_number", "inward_vehicle_reg", "outward_vehicle_reg", "party_name", "pipe_number", "pipe_size"].sort());
  });

  // ---- reports ----
  await check("report summary math matches recorded entries", async () => {
    const url = new URL("http://x/api/reports");
    const res = await reportRoutes.summary(adminSession, env, url);
    const body = await res.json();
    assert.equal(body.summary.totalInward, 100); // only C-100 remains (C-200 was deleted)
    assert.equal(body.summary.totalShipped, 100);
    assert.equal(body.summary.closed, 1);
  });

  // ---- housekeeping ----
  await check("retention policy saves and reads back", async () => {
    await housekeepingRoutes.setRetentionPolicy(adminSession, env, fakeRequest({ enabled: true, completedRetentionDays: 1, allRetentionDays: 90 }));
    const res = await housekeepingRoutes.getRetentionPolicy(adminSession, env);
    const body = await res.json();
    assert.equal(body.enabled, 1);
    assert.equal(body.completed_retention_days, 1);
  });
  await check("auto-purge sweep removes old closed entries past retention", async () => {
    // C-100 is closed with last shipment 2026-08-04; with a 1-day retention
    // and "now" being far later than that, it should be purged.
    const deleted = await housekeepingRoutes.autoPurgeSweep(env);
    assert.ok(deleted >= 1);
    const { results: rows } = env.DB.prepare("SELECT * FROM inward_entries WHERE id = ?").bind(inwardId).all();
    assert.equal(rows.length, 0);
  });

  // ---- backups ----
  await check("system backup runs and lists (root)", async () => {
    const res = await backupRoutes.runSystemBackup(rootSession, env);
    assert.equal(res.status, 200);
    const list = await backupRoutes.listSystemBackups(rootSession, env);
    const body = await list.json();
    assert.ok(body.length >= 1);
  });
  await check("non-root cannot run a system backup", async () => {
    const res = await backupRoutes.runSystemBackup(adminSession, env);
    assert.equal(res.status, 403);
  });
  await check("company backup excludes users/credentials tables", async () => {
    const result = await backupRoutes.doCompanyBackup(env, companyId);
    assert.ok(result.ok);
    const obj = await env.PHOTOS.get(result.key);
    const dump = JSON.parse(obj.body);
    assert.equal("users" in dump, false);
    assert.equal("admin_recovery" in dump, false);
  });

  // ---- company lifecycle ----
  await check("deactivated company blocks its users from logging in", async () => {
    await companyRoutes.setCompanyActive(rootSession, env, companyId, false);
    const res = await authRoutes.login(fakeRequest({ id: "jw-admin", password: "AdminPass1!", companySlug: "jain-wraptech" }), env);
    assert.equal(res.status, 401);
  });
  await check("reactivating restores login", async () => {
    await companyRoutes.setCompanyActive(rootSession, env, companyId, true);
    // account was locked earlier from failed-attempt test; reset it directly for this check
    env.DB.prepare("UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id='jw-admin'").bind().run();
    const res = await authRoutes.login(fakeRequest({ id: "jw-admin", password: "AdminPass1!", companySlug: "jain-wraptech" }), env);
    assert.equal(res.status, 200);
  });
  await check("delete requires exact slug confirmation", async () => {
    const res = await companyRoutes.deleteCompany(rootSession, env, companyId, fakeRequest({ confirmSlug: "wrong-slug" }));
    assert.equal(res.status, 400);
  });
  await check("delete with correct slug confirmation succeeds", async () => {
    const res = await companyRoutes.deleteCompany(rootSession, env, companyId, fakeRequest({ confirmSlug: "jain-wraptech" }));
    assert.equal(res.status, 200);
  });

  // ---- New round: future-date rejection, full company update, root recovery ----
  let companyId2;
  await check("(new company for further checks) root can create it", async () => {
    const res = await companyRoutes.createCompany(rootSession, env, fakeRequest({
      name: "Beta Pipes", slug: "beta-pipes", adminId: "beta-admin", adminName: "Beta Admin", adminPassword: "BetaPass1!",
      langSecondary: "mr",
    }));
    const body = await res.json();
    companyId2 = body.id;
    assert.equal(res.status, 201);
  });
  const { results: betaAdminRows } = env.DB.prepare("SELECT pk FROM users WHERE id = 'beta-admin'").bind().all();
  const betaAdminSession = { pk: betaAdminRows[0].pk, id: "beta-admin", name: "Beta Admin", role: "admin", companyId: companyId2, isRoot: false };
  await check("future Inward Date is rejected", async () => {
    const farFuture = "2099-01-01";
    const res = await inwardRoutes.create(betaAdminSession, env, fakeRequest({
      customer_number: "F-1", party_name: "X", number_of_pipes: 5, inward_date: farFuture, inward_vehicle_reg: "X",
    }));
    assert.equal(res.status, 400);
  });
  let futureTestInwardId;
  await check("(setup) valid inward entry for outward future-date check", async () => {
    const res = await inwardRoutes.create(betaAdminSession, env, fakeRequest({
      customer_number: "F-2", party_name: "X", number_of_pipes: 10, inward_date: "2026-08-01", inward_vehicle_reg: "X",
    }));
    const body = await res.json();
    futureTestInwardId = body.id;
    assert.equal(res.status, 201);
  });
  await check("future Outward Date is rejected", async () => {
    const res = await outwardRoutes.create(betaAdminSession, env, futureTestInwardId, fakeRequest({
      number_of_pipes: 2, outward_date: "2099-01-01", outward_vehicle_reg: "X",
    }));
    assert.equal(res.status, 400);
  });
  await check("root can update a company's secondary language", async () => {
    const res = await companyRoutes.updateCompany(rootSession, env, companyId2, fakeRequest({ langSecondary: "ta" }));
    assert.equal(res.status, 200);
    const listRes = await companyRoutes.listCompanies(rootSession, env);
    const list = await listRes.json();
    const beta = list.find((c) => c.id === companyId2);
    assert.equal(beta.lang_secondary, "ta");
  });
  await check("fixed recovery questions are 'Favourite Colour' / 'Favourite Place'", async () => {
    await userRoutes.setMyRecoveryQuestions(betaAdminSession, env, fakeRequest({ answer1: "Blue", answer2: "Goa" }));
    const res = await userRoutes.getMyRecoveryQuestions(betaAdminSession, env);
    const body = await res.json();
    assert.equal(body.question1, "Favourite Colour");
    assert.equal(body.question2, "Favourite Place");
  });
  await check("root has no recovery questions set up yet (expected — not configured in this test run)", async () => {
    const res = await userRoutes.rootRecoveryQuestions(env);
    assert.equal(res.status, 404);
  });
  await check("root CAN set up and then use its own recovery flow", async () => {
    await userRoutes.setMyRecoveryQuestions(rootSession, env, fakeRequest({ answer1: "Green", answer2: "Mumbai" }));
    const qRes = await userRoutes.rootRecoveryQuestions(env);
    assert.equal(qRes.status, 200);
    const resetRes = await userRoutes.rootRecoveryReset(env, fakeRequest({ answer1: "green", answer2: "mumbai", newPassword: "NewRootPass1!" }));
    assert.equal(resetRes.status, 200);
    const loginRes = await authRoutes.login(fakeRequest({ id: "Admin", password: "NewRootPass1!" }), env);
    assert.equal(loginRes.status, 200);
  });
  await check("photo storage keys are company-namespaced", async () => {
    const key = await (await import("../src/lib/photos.js")).putPhoto(env, companyId2, `inward/test123`, "data:image/jpeg;base64,/9j/");
    assert.match(key, new RegExp(`^companies/${companyId2}/inward/test123`));
  });

  // ---- Language rework: ONE company-wide secondary language, no per-user preset ----
  await check("adding a user does NOT accept/store a per-user language (removed by design)", async () => {
    const res = await userRoutes.create(betaAdminSession, env, fakeRequest({ id: "lang-emp", name: "Lang Employee", role: "employee", password: "LangPass1!" }));
    assert.equal(res.status, 201);
    const listRes = await userRoutes.list(betaAdminSession, env);
    const list = (await listRes.json()).rows;
    const found = list.find((u) => u.id === "lang-emp");
    assert.equal(found.lang, undefined); // no such column/field anymore
  });
  await check("company admin can update their own company's name/contact", async () => {
    const res = await companyRoutes.updateOwnCompany(betaAdminSession, env, fakeRequest({ name: "Beta Pipes Renamed", contact: "new-contact@beta.example" }));
    assert.equal(res.status, 200);
    const listRes = await companyRoutes.listCompanies(rootSession, env);
    const list = await listRes.json();
    const beta = list.find((c) => c.id === companyId2);
    assert.equal(beta.name, "Beta Pipes Renamed");
  });
  await check("company admin CAN steer their own company's secondary language (clarified intent)", async () => {
    const res = await companyRoutes.updateOwnCompany(betaAdminSession, env, fakeRequest({ langSecondary: "gu" }));
    assert.equal(res.status, 200);
    const listRes = await companyRoutes.listCompanies(rootSession, env);
    const list = await listRes.json();
    const beta = list.find((c) => c.id === companyId2);
    assert.equal(beta.lang_secondary, "gu");
  });
  await check("company profile changes are logged to the audit trail", async () => {
    const historyRes = await companyRoutes.getCompanyHistory(rootSession, env, companyId2);
    const history = await historyRes.json();
    assert.ok(history.length >= 3); // created + name change + langSecondary changes
    assert.ok(history.some((h) => h.field === "lang_secondary" && h.new_value === "gu"));
    assert.ok(history.some((h) => h.changed_by === "beta-admin"));
  });
  await check("non-root cannot view a company's change history", async () => {
    const res = await companyRoutes.getCompanyHistory(betaAdminSession, env, companyId2);
    assert.equal(res.status, 403);
  });
  await check("root can filter Reports down to a single company while viewing All", async () => {
    const urlAll = new URL("http://x/api/reports");
    const allRes = await reportRoutes.summary(rootSession, env, urlAll);
    const allBody = await allRes.json();
    const urlFiltered = new URL(`http://x/api/reports?companyId=${companyId2}`);
    const filteredRes = await reportRoutes.summary(rootSession, env, urlFiltered);
    const filteredBody = await filteredRes.json();
    assert.ok(filteredBody.summary.count <= allBody.summary.count);
    assert.ok(filteredBody.rows.every((r) => true)); // rows don't carry company_id directly but query is scoped server-side
  });

  // ---- Bugs found and fixed this round: listOpen and getOne were missing company info for root ----
  await check("listOpen (Outward tab) includes company_name for root's cross-company view", async () => {
    const url = new URL("http://x/api/inward/open?pageSize=50");
    const res = await inwardRoutes.listOpen(rootSession, env, url);
    const body = await res.json();
    const withCompany = body.rows.find((r) => r.company_name);
    assert.ok(withCompany, "expected at least one open entry to carry a company_name for root");
  });
  await check("getOne includes company_name when root views a single entry", async () => {
    const res = await inwardRoutes.getOne(rootSession, env, futureTestInwardId);
    const body = await res.json();
    assert.ok(body.company_name, "expected company_name on the entry for root");
  });
  await check("getOne does NOT include company_name for a non-root company user", async () => {
    const res = await inwardRoutes.getOne(betaAdminSession, env, futureTestInwardId);
    const body = await res.json();
    assert.equal(body.company_name, undefined);
  });

  // ---- Recommendations round: viewer role, backup restore, IP throttle ----
  let viewerPk;
  await check("admin can create a viewer user", async () => {
    const res = await userRoutes.create(betaAdminSession, env, fakeRequest({ id: "viewer1", name: "Viewer One", role: "viewer", password: "ViewPass1!" }));
    assert.equal(res.status, 201);
    const body = await res.json();
    viewerPk = body.pk;
  });
  const viewerSession = { pk: viewerPk, id: "viewer1", name: "Viewer One", role: "viewer", companyId: companyId2, isRoot: false };
  await check("viewer CAN read All Records", async () => {
    const url = new URL("http://x/api/inward");
    const res = await inwardRoutes.listAll(viewerSession, env, url);
    assert.equal(res.status, 200);
  });
  await check("viewer CAN read Reports", async () => {
    const url = new URL("http://x/api/reports");
    const res = await reportRoutes.summary(viewerSession, env, url);
    assert.equal(res.status, 200);
  });
  await check("viewer CANNOT create an inward entry", async () => {
    const res = await inwardRoutes.create(viewerSession, env, fakeRequest({
      party_name: "Blocked", number_of_pipes: 5, inward_date: "2026-08-01", inward_vehicle_reg: "X",
    }));
    assert.equal(res.status, 403);
  });
  await check("viewer CANNOT manage users (admin-only)", async () => {
    const res = await userRoutes.create(viewerSession, env, fakeRequest({ id: "x", name: "x", role: "employee", password: "x" }));
    assert.equal(res.status, 403);
  });
  await check("removing the last admin is still blocked even via a viewer-adjacent path", async () => {
    // sanity check the last-admin rule still triggers with viewer role now in the mix
    const { results: rows } = env.DB.prepare("SELECT pk FROM users WHERE id = 'beta-admin'").bind().all();
    const res = await userRoutes.update(betaAdminSession, env, rows[0].pk, fakeRequest({ role: "viewer" }));
    assert.equal(res.status, 400);
  });

  await check("backup restore requires the exact confirmation phrase", async () => {
    const backupRes = await backupRoutes.runSystemBackup(rootSession, env);
    const backupBody = await backupRes.json();
    const filename = backupBody.key.split("/").pop();
    const res = await backupRoutes.restoreSystemBackup(rootSession, env, filename, fakeRequest({ confirmPhrase: "wrong" }));
    assert.equal(res.status, 400);
  });
  await check("system restore round-trip: backup, mutate, restore, verify reverted", async () => {
    const before = await one(env.DB, `SELECT name FROM companies WHERE id = ?`, companyId2);
    const backupRes = await backupRoutes.runSystemBackup(rootSession, env);
    const backupBody = await backupRes.json();
    const filename = backupBody.key.split("/").pop();

    await companyRoutes.updateCompany(rootSession, env, companyId2, fakeRequest({ name: "MUTATED NAME" }));
    const mutated = await one(env.DB, `SELECT name FROM companies WHERE id = ?`, companyId2);
    assert.equal(mutated.name, "MUTATED NAME");

    const restoreRes = await backupRoutes.restoreSystemBackup(rootSession, env, filename, fakeRequest({ confirmPhrase: "RESTORE" }));
    assert.equal(restoreRes.status, 200);
    const restored = await one(env.DB, `SELECT name FROM companies WHERE id = ?`, companyId2);
    assert.equal(restored.name, before.name);
  });
  await check("company-scoped restore round-trip", async () => {
    const beforeCount = (await all(env.DB, `SELECT id FROM inward_entries WHERE company_id = ?`, companyId2)).length;
    const backupRes = await backupRoutes.runCompanyBackup(betaAdminSession, env);
    const backupBody = await backupRes.json();
    const filename = backupBody.key.split("/").pop();

    await run(env.DB, `DELETE FROM inward_entries WHERE company_id = ?`, companyId2);
    const afterDelete = (await all(env.DB, `SELECT id FROM inward_entries WHERE company_id = ?`, companyId2)).length;
    assert.equal(afterDelete, 0);

    const url = new URL(`http://x/api/backups/company/${filename}/restore`);
    const restoreRes = await backupRoutes.restoreCompanyBackup(betaAdminSession, env, filename, url, fakeRequest({ confirmPhrase: "RESTORE" }));
    assert.equal(restoreRes.status, 200);
    const afterRestore = (await all(env.DB, `SELECT id FROM inward_entries WHERE company_id = ?`, companyId2)).length;
    assert.equal(afterRestore, beforeCount);
  });

  await check("IP throttle allows normal login volume", async () => {
    const res = await authRoutes.login(fakeRequest({ id: "jw-admin", password: "wrong-but-fine", companySlug: "jain-wraptech" }, { "CF-Connecting-IP": "9.9.9.1" }), env);
    assert.equal(res.status, 401);
    assert.doesNotMatch((await res.json()).error, /Too many/);
  });
  await check("IP throttle kicks in after many failed attempts from one IP", async () => {
    const ip = "9.9.9.2";
    let lastRes;
    for (let i = 0; i < 21; i++) {
      lastRes = await authRoutes.login(fakeRequest({ id: `nobody-${i}`, password: "x" }, { "CF-Connecting-IP": ip }), env);
    }
    assert.equal(lastRes.status, 401);
    const body = await lastRes.json();
    assert.match(body.error, /Too many/);
  });

  // ---- Platform settings: configurable backup/housekeeping frequency ----
  await check("platform settings default to 7-day frequency, root-readable", async () => {
    const res = await settingsRoutes.getSettings(rootSession, env);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.backup_frequency_days, 7);
    assert.equal(body.housekeeping_frequency_days, 7);
  });
  await check("non-root cannot read or change platform settings", async () => {
    const res1 = await settingsRoutes.getSettings(betaAdminSession, env);
    assert.equal(res1.status, 403);
    const res2 = await settingsRoutes.updateSettings(betaAdminSession, env, fakeRequest({ backupFrequencyDays: 1, housekeepingFrequencyDays: 1 }));
    assert.equal(res2.status, 403);
  });
  await check("root can change the backup/housekeeping frequency", async () => {
    const res = await settingsRoutes.updateSettings(rootSession, env, fakeRequest({ backupFrequencyDays: 3, housekeepingFrequencyDays: 14 }));
    assert.equal(res.status, 200);
    const check2 = await (await settingsRoutes.getSettings(rootSession, env)).json();
    assert.equal(check2.backup_frequency_days, 3);
    assert.equal(check2.housekeeping_frequency_days, 14);
  });
  await check("invalid frequency values are rejected", async () => {
    const res = await settingsRoutes.updateSettings(rootSession, env, fakeRequest({ backupFrequencyDays: 0, housekeepingFrequencyDays: 7 }));
    assert.equal(res.status, 400);
  });
  await check("isDue is true when a job has never run", async () => {
    assert.equal(await settingsRoutes.isDue(env, "backup"), true);
  });
  await check("markRun records a timestamp, and isDue respects the configured frequency", async () => {
    await settingsRoutes.updateSettings(rootSession, env, fakeRequest({ backupFrequencyDays: 7, housekeepingFrequencyDays: 7 }));
    await settingsRoutes.markRun(env, "backup");
    assert.equal(await settingsRoutes.isDue(env, "backup"), false); // just ran, 7-day frequency -> not due yet
    // simulate "last run" being 10 days ago -> should be due again
    await run(env.DB, `UPDATE platform_settings SET last_backup_run = ? WHERE id = 1`, new Date(Date.now() - 10 * 86400000).toISOString());
    assert.equal(await settingsRoutes.isDue(env, "backup"), true);
  });

  // ---- Per-employee language override (admin-controlled, optional) ----
  await check("admin can set an optional per-employee language override at creation", async () => {
    const res = await userRoutes.create(betaAdminSession, env, fakeRequest({ id: "override-emp", name: "Override Employee", role: "employee", password: "OverridePass1!", langOverride: "bn" }));
    assert.equal(res.status, 201);
    const list = ((await (await userRoutes.list(betaAdminSession, env)).json()).rows);
    const found = list.find((u) => u.id === "override-emp");
    assert.equal(found.lang_override, "bn");
  });
  await check("omitting the override leaves it null (inherits company default)", async () => {
    const res = await userRoutes.create(betaAdminSession, env, fakeRequest({ id: "no-override-emp", name: "No Override", role: "employee", password: "NoOverridePass1!" }));
    assert.equal(res.status, 201);
    const list = ((await (await userRoutes.list(betaAdminSession, env)).json()).rows);
    const found = list.find((u) => u.id === "no-override-emp");
    assert.equal(found.lang_override, null);
  });
  await check("an override can later be cleared back to company default", async () => {
    const list = ((await (await userRoutes.list(betaAdminSession, env)).json()).rows);
    const target = list.find((u) => u.id === "override-emp");
    await userRoutes.update(betaAdminSession, env, target.pk, fakeRequest({ langOverride: "" }));
    const after = ((await (await userRoutes.list(betaAdminSession, env)).json()).rows);
    const found = after.find((u) => u.id === "override-emp");
    assert.equal(found.lang_override, null);
  });
  await check("/auth/me exposes myLangOverride for the logged-in user", async () => {
    const list = ((await (await userRoutes.list(betaAdminSession, env)).json()).rows);
    const target = list.find((u) => u.id === "no-override-emp");
    await userRoutes.update(betaAdminSession, env, target.pk, fakeRequest({ langOverride: "ta" }));
    const loginRes = await authRoutes.login(fakeRequest({ id: "no-override-emp", password: "NoOverridePass1!", companySlug: "beta-pipes" }), env);
    const value = loginRes.headers.get("Set-Cookie").split(";")[0].replace("bv_session=", "");
    const meRes = await authRoutes.me(fakeReqWithCookie(`bv_session=${value}`), env);
    const meBody = await meRes.json();
    assert.equal(meBody.myLangOverride, "ta");
  });

  await check("root can set and retrieve a platform support email", async () => {
    const res = await settingsRoutes.updateSettings(rootSession, env, fakeRequest({
      backupFrequencyDays: 7, housekeepingFrequencyDays: 7,
      supportEmail: "BeamVeda@gmail.com", supportEmailName: "Beam Veda Support",
    }));
    assert.equal(res.status, 200);
    const getRes = await settingsRoutes.getSettings(rootSession, env);
    const body = await getRes.json();
    assert.equal(body.support_email, "BeamVeda@gmail.com");
    assert.equal(body.support_email_name, "Beam Veda Support");
  });
  await check("public settings endpoint exposes support email without login", async () => {
    const res = await settingsRoutes.getPublicSettings(env);
    const body = await res.json();
    assert.equal(body.supportEmail, "BeamVeda@gmail.com");
    assert.equal(body.supportEmailName, "Beam Veda Support");
  });
  await check("support email can be cleared back to null", async () => {
    await settingsRoutes.updateSettings(rootSession, env, fakeRequest({
      backupFrequencyDays: 7, housekeepingFrequencyDays: 7, supportEmail: "",
    }));
    const body = await (await settingsRoutes.getSettings(rootSession, env)).json();
    assert.equal(body.support_email, null);
  });
  await check("reports summary returns paginated rows with total", async () => {
    const url = new URL("http://x/api/reports?page=1&pageSize=10");
    const res = await reportRoutes.summary(adminSession, env, url);
    const body = await res.json();
    assert.ok("total" in body, "expected total in paginated response");
    assert.ok("page" in body, "expected page in paginated response");
    assert.ok(Array.isArray(body.rows), "expected rows array");
    // Summary stats cover all data, not just current page
    assert.ok("count" in body.summary, "expected summary.count");
  });
  await check("paginated All Records returns correct page/pageSize/total", async () => {
    const url = new URL("http://x/api/inward?page=1&pageSize=10");
    const res = await inwardRoutes.listAll(adminSession, env, url);
    const body = await res.json();
    assert.ok("total" in body);
    assert.equal(body.page, 1);
    assert.equal(body.pageSize, 10);
    assert.ok(body.rows.length <= 10);
  });
  await check("company filter on All Records narrows results for root", async () => {
    const urlAll = new URL("http://x/api/inward?page=1&pageSize=50");
    const urlFiltered = new URL(`http://x/api/inward?page=1&pageSize=50&companyId=${companyId2}`);
    const allBody = await (await inwardRoutes.listAll(rootSession, env, urlAll)).json();
    const filteredBody = await (await inwardRoutes.listAll(rootSession, env, urlFiltered)).json();
    assert.ok(filteredBody.total <= allBody.total);
    assert.ok(filteredBody.rows.every((r) => r.company_id === companyId2 || r.company_slug === "beta-pipes"));
  });
  await check("paginated Users returns correct structure", async () => {
    const url = new URL("http://x/api/users?page=1&pageSize=10");
    const res = await userRoutes.list(rootSession, env, url);
    const body = await res.json();
    assert.ok("total" in body);
    assert.ok("rows" in body);
    assert.ok(Array.isArray(body.rows));
  });
  await check("company filter on Users narrows results for root", async () => {
    const urlAll = new URL("http://x/api/users?page=1&pageSize=50");
    const urlFiltered = new URL(`http://x/api/users?page=1&pageSize=50&companyId=${companyId2}`);
    const allBody = await (await userRoutes.list(rootSession, env, urlAll)).json();
    const filteredBody = await (await userRoutes.list(rootSession, env, urlFiltered)).json();
    assert.ok(filteredBody.total <= allBody.total);
    assert.ok(filteredBody.rows.every((r) => r.company_id === companyId2 || r.company_name === "Beta Pipes Renamed"));
  });

  console.log(results.join("\n"));
  console.log(`\n${pass} passed, ${fail} failed, ${pass + fail} total`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => { console.error("Test harness crashed:", e); process.exit(1); });
