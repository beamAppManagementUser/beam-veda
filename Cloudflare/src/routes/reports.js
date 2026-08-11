import { all, one } from "../lib/db.js";
import { withBalance } from "../lib/balance.js";
import { effectiveCompanyScope } from "../lib/session.js";
import { sendEmail } from "../lib/email.js";
import { json, badRequest, forbidden } from "../lib/http.js";

function requireAdmin(session) {
  if (!session || session.role !== "admin") return forbidden("Admin access required");
  return null;
}
// Viewer role (recommendation, implemented) — reports are read-only by
// nature (viewing, exporting, emailing a summary), so viewer gets full access.
function requireReader(session) {
  if (!session || !["admin", "viewer"].includes(session.role)) return forbidden("Admin or viewer access required");
  return null;
}

async function buildRows(session, env, url) {
  const scope = effectiveCompanyScope(session);
  const params = [];
  let where = `1=1`;
  if (!scope.all) { where += ` AND ie.company_id = ?`; params.push(scope.companyId); }
  // Root viewing "All" can still narrow to one company via this filter,
  // without leaving the cross-company view (item 5).
  const companyIdFilter = url.searchParams.get("companyId");
  if (scope.all && companyIdFilter) { where += ` AND ie.company_id = ?`; params.push(Number(companyIdFilter)); }
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from) { where += ` AND ie.inward_date >= ?`; params.push(from); }
  if (to) { where += ` AND ie.inward_date <= ?`; params.push(to); }

  const selectCols = scope.all ? `ie.*, c.name AS company_name` : `ie.*`;
  const fromClause = scope.all ? `inward_entries ie JOIN companies c ON c.id = ie.company_id` : `inward_entries ie`;
  const rows = await all(env.DB, `SELECT ${selectCols} FROM ${fromClause} WHERE ${where} ORDER BY ie.inward_date DESC`, ...params);
  let withBalances = await Promise.all(rows.map((r) => withBalance(env.DB, r)));

  const status = url.searchParams.get("status");
  if (status && status !== "all") withBalances = withBalances.filter((r) => r.status === status);
  return withBalances;
}

function summarize(rows) {
  return {
    count: rows.length,
    totalInward: rows.reduce((s, r) => s + r.number_of_pipes, 0),
    totalShipped: rows.reduce((s, r) => s + r.shippedQty, 0),
    open: rows.filter((r) => r.status === "open").length,
    partial: rows.filter((r) => r.status === "partial").length,
    closed: rows.filter((r) => r.status === "closed").length,
  };
}

export async function summary(session, env, url) {
  const err = requireReader(session);
  if (err) return err;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(10, parseInt(url.searchParams.get("pageSize") || "10", 10)));
  const allRows = await buildRows(session, env, url);
  const total = allRows.length;
  const start = (page - 1) * pageSize;
  const rows = allRows.slice(start, start + pageSize);
  // Summary stats always across ALL rows, not just the current page — so
  // the stat boxes (total in, total shipped, etc.) don't change as you page.
  return json({ rows, total, page, pageSize, summary: summarize(allRows) });
}

function toCsv(rows, includeCompany) {
  const headers = [
    ...(includeCompany ? ["Company"] : []),
    "Customer #", "Party", "Pipe #", "Inward Qty", "Shipped Qty", "Remaining Qty",
    "Size", "Inward Date", "Inward Vehicle", "Status",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const cells = [
      ...(includeCompany ? [r.company_name || ""] : []),
      r.customer_number, r.party_name, r.pipe_number || "", r.number_of_pipes,
      r.shippedQty, r.remainingQty, r.pipe_size, r.inward_date, r.inward_vehicle_reg, r.status,
    ];
    lines.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
  }
  return lines.join("\n");
}

export async function csv(session, env, url) {
  const err = requireReader(session);
  if (err) return err;
  const scope = effectiveCompanyScope(session);
  const rows = await buildRows(session, env, url);
  const body = toCsv(rows, scope.all);
  return new Response(body, {
    headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="beam-veda-report.csv"' },
  });
}

export async function emailReport(session, env, url, request) {
  const err = requireReader(session);
  if (err) return err;
  const body = await request.json().catch(() => null);
  if (!body || !body.to) return badRequest("to (recipient emails) is required");

  const rows = await buildRows(session, env, url);
  const stats = summarize(rows);
  const scope = effectiveCompanyScope(session);

  // Use the platform support email as reply-to if root has configured one.
  const settings = await one(env.DB, `SELECT support_email, support_email_name FROM platform_settings WHERE id = 1`).catch(() => null);
  const replyTo = settings?.support_email || null;
  const replyToName = settings?.support_email_name || "Beam Veda Support";

  const html = `
    <h2>Beam Veda Stock Report</h2>
    <p>${stats.count} entries &middot; ${stats.totalInward} pipes in &middot; ${stats.totalShipped} shipped
       &middot; Open: ${stats.open} &middot; Partial: ${stats.partial} &middot; Closed: ${stats.closed}</p>
    ${toCsv(rows, scope.all).split("\n").slice(0, 51).map((l) => `<div style="font-family:monospace;font-size:12px">${l}</div>`).join("")}
    ${rows.length > 50 ? "<p><em>Showing first 50 rows — download the full CSV from the Reports tab for everything.</em></p>" : ""}
    ${replyTo ? `<p style="font-size:12px;color:#666;">Need help? Contact <a href="mailto:${replyTo}">${replyToName}</a></p>` : ""}
  `;
  const toList = String(body.to).split(",").map((s) => s.trim()).filter(Boolean);

  try {
    await sendEmail(env, { to: toList, subject: "Beam Veda Stock Report", html, ...(replyTo ? { replyTo: `${replyToName} <${replyTo}>` } : {}) });
    return json({ ok: true });
  } catch (e) {
    return json({ error: "Failed to send email", detail: String(e) }, 502);
  }
}
