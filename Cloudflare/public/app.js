// ===== i18n =====
// Only STATIC UI text (tab names, buttons, headers) is translated.
// User-entered data (names, IDs, notes, etc.) is NEVER translated.
// Model (clarified in chat): each company has ONE secondary language, set
// by root at creation and steerable afterward by that company's own admin.
// The EN/<secondary> toggle in the header is the employee's own choice —
// nobody presets it per-person. Only Hindi has real translated strings
// right now; other secondary languages show their own name on the toggle
// button but fall back to English text until translated — stated plainly,
// not hidden.
const I18N = {
  en: {
    tab_companies: "Companies", tab_inward: "Inward", tab_outward: "Outward", tab_all: "All Records",
    tab_reports: "Reports", tab_users: "Users", tab_lookups: "Lookups", tab_housekeeping: "Housekeeping",
    tab_backups: "Backups", tab_companyinfo: "Company Info", tab_account: "My Account",
    logout: "Log out", save: "Save", cancel: "Cancel", add: "Add", edit: "Edit", delete: "Delete",
    new_inward_entry: "New Inward Entry", outward_pending: "Outward — Pending Shipment",
  },
  hi: {
    tab_companies: "कंपनियाँ", tab_inward: "इनवर्ड", tab_outward: "आउटवर्ड", tab_all: "सभी रिकॉर्ड",
    tab_reports: "रिपोर्ट्स", tab_users: "यूज़र्स", tab_lookups: "लुकअप्स", tab_housekeeping: "हाउसकीपिंग",
    tab_backups: "बैकअप", tab_companyinfo: "कंपनी जानकारी", tab_account: "माय अकाउंट",
    logout: "लॉग आउट", save: "सेव करें", cancel: "कैंसल", add: "ऐड करें", edit: "एडिट", delete: "डिलीट",
    new_inward_entry: "नई इनवर्ड एंट्री", outward_pending: "आउटवर्ड — पेंडिंग शिपमेंट",
  },
};
const INDIAN_LANGUAGES = [
  ["en", "English"], ["hi", "Hindi"], ["bn", "Bengali"],
  ["mr", "Marathi"], ["te", "Telugu"], ["ta", "Tamil"], ["gu", "Gujarati"], ["ur", "Urdu"],
  ["kn", "Kannada"], ["or", "Odia"], ["ml", "Malayalam"], ["pa", "Punjabi"], ["as", "Assamese"],
];
// Native-script button labels for the toggle itself (independent of whether
// full translation exists yet for that language).
const NATIVE_LABEL = {
  en: "EN", hi: "हिंदी", bn: "বাংলা", mr: "मराठी", te: "తెలుగు", ta: "தமிழ்", gu: "ગુજરાતી",
  ur: "اردو", kn: "ಕನ್ನಡ", or: "ଓଡ଼ିଆ", ml: "മലയാളം", pa: "ਪੰਜਾਬੀ", as: "অসমীয়া",
};
function languageOptions(selected) {
  return INDIAN_LANGUAGES.map(([code, label]) => `<option value="${code}" ${selected === code ? "selected" : ""}>${label}</option>`).join("");
}

let CURRENT_LANG = localStorage.getItem("bv_lang") || "en";
function t(key) {
  return (I18N[CURRENT_LANG] && I18N[CURRENT_LANG][key]) || I18N.en[key] || key;
}
// Builds EN + this company's ONE secondary language (root/admin-steered).
// Falls back to EN/Hindi generic toggle for root's own screens, which
// aren't scoped to any one company.
function renderLangToggle() {
  // An employee's own override (if their admin set one) wins over the
  // company-wide secondary language — still just EN + one other choice,
  // still the employee's to toggle either way.
  const secondary = (ME && (ME.myLangOverride || ME.companyLangSecondary)) || "hi";
  document.getElementById("lang-toggle").innerHTML = `
    <button class="${CURRENT_LANG === "en" ? "active" : ""}" onclick="setLang('en')">EN</button>
    <button class="${CURRENT_LANG === secondary ? "active" : ""}" onclick="setLang('${secondary}')">${NATIVE_LABEL[secondary] || secondary.toUpperCase()}</button>
  `;
}
window.setLang = (lang) => {
  CURRENT_LANG = lang;
  localStorage.setItem("bv_lang", lang);
  renderLangToggle();
  renderTabs();
  if (CURRENT_TAB) navigate(CURRENT_TAB);
};

// Pagination helper — renders a consistent page-size picker + prev/next bar.
// onNavigate(page, pageSize) is called when the user changes either control.
function paginationBar(total, page, pageSize, onNavigate) {
  const totalPages = Math.ceil(total / pageSize) || 1;
  const from = Math.min((page - 1) * pageSize + 1, total);
  const to = Math.min(page * pageSize, total);
  return `<div class="row-actions" style="justify-content:space-between;align-items:center;margin-top:12px;font-size:13px;color:var(--steel);">
    <span>${total === 0 ? "No records" : `${from}–${to} of ${total}`}</span>
    <div class="row-actions" style="gap:10px;">
      <label>Per page: <select id="pg-size" onchange="(${onNavigate.toString()})(1, parseInt(this.value,10))">
        ${[10,20,50].map((n) => `<option value="${n}" ${n === pageSize ? "selected" : ""}>${n}</option>`).join("")}
      </select></label>
      <button class="btn btn-sm" onclick="(${onNavigate.toString()})(${page - 1}, ${pageSize})" ${page <= 1 ? "disabled" : ""}>← Prev</button>
      <span>${page} / ${totalPages}</span>
      <button class="btn btn-sm" onclick="(${onNavigate.toString()})(${page + 1}, ${pageSize})" ${page >= totalPages ? "disabled" : ""}>Next →</button>
    </div>
  </div>`;
}

async function api(path, opts = {}) {
  const res = await fetch(`/api${path}`, {
    method: opts.method || "GET",
    headers: opts.body ? { "Content-Type": "application/json" } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 204) return null;
  const isJson = (res.headers.get("Content-Type") || "").includes("application/json");
  const data = isJson ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}
function toast(msg, isError = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = msg;
  document.getElementById("toast-root").appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function pillClass(status) {
  return status === "open" ? "pill-open" : status === "partial" ? "pill-partial" : "pill-closed";
}

let ME = null;
let COMPANIES = [];
let CURRENT_TAB = null;

const rootToggleBtn = document.getElementById("root-toggle");
let isRootLogin = false;
const urlCompany = new URLSearchParams(location.search).get("company");
const rememberedCompany = sessionStorage.getItem("bv_last_company");
const lockedSlug = urlCompany || rememberedCompany;
if (lockedSlug) {
  document.getElementById("companySlug").value = lockedSlug;
  // Hide the field entirely (not just read-only) — the banner alone
  // identifies the company, per instruction. Value still submits via the
  // hidden input for the login request itself.
  document.getElementById("company-slug-field").classList.add("hidden");
  rootToggleBtn.classList.add("hidden");
  loadLoginBranding(lockedSlug);
}

// Load both company branding AND platform support email for the login screen.
// The support email comes from platform_settings (root-configurable) and
// is a platform-level contact, distinct from each company's own contact field.
async function loadLoginBranding(slug) {
  try {
    const [info, platformSettings] = await Promise.all([
      api(`/companies/public/${encodeURIComponent(slug)}`),
      api("/settings/public").catch(() => ({ supportEmail: null, supportEmailName: "Beam Veda Support" })),
    ]);
    document.getElementById("login-brand-name").textContent = info.name;
    document.getElementById("login-brand-sub").textContent = "Beam Pipe Stock Register";
    document.getElementById("login-contact").textContent = info.contact || "";
    if (platformSettings.supportEmail) {
      const el = document.getElementById("login-support-email");
      if (el) el.innerHTML = `Platform support: <a href="mailto:${esc(platformSettings.supportEmail)}">${esc(platformSettings.supportEmailName || platformSettings.supportEmail)}</a>`;
    }
    if (info.hasLogo) {
      document.getElementById("login-brand-logo").innerHTML = `<img src="/api/companies/public/${encodeURIComponent(slug)}/logo" alt="${esc(info.name)} logo" />`;
    }
    if (!info.active) {
      const errBox = document.getElementById("login-error");
      errBox.textContent = "This company account is currently inactive.";
      errBox.classList.remove("hidden");
    }
  } catch { /* unknown slug — leave default Beam Veda branding */ }
}

rootToggleBtn.addEventListener("click", () => {
  isRootLogin = !isRootLogin;
  document.getElementById("company-slug-field").classList.toggle("hidden", isRootLogin);
  document.getElementById("forgot-link").classList.remove("hidden");
  rootToggleBtn.textContent = isRootLogin ? "Company login" : "Root admin login";
});

document.getElementById("pw-toggle").addEventListener("click", () => {
  const pw = document.getElementById("password");
  const show = pw.type === "password";
  pw.type = show ? "text" : "password";
  document.getElementById("pw-toggle").textContent = show ? "Hide" : "Show";
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errBox = document.getElementById("login-error");
  errBox.classList.add("hidden");
  const id = document.getElementById("userId").value.trim();
  const password = document.getElementById("password").value;
  const companySlug = isRootLogin ? undefined : document.getElementById("companySlug").value.trim();
  if (!isRootLogin && !companySlug) {
    errBox.textContent = "Company is required for company login.";
    errBox.classList.remove("hidden");
    return;
  }
  try {
    await api("/auth/login", { method: "POST", body: { id, password, companySlug } });
    if (companySlug) sessionStorage.setItem("bv_last_company", companySlug);
    await bootApp();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove("hidden");
  }
});

document.getElementById("forgot-link").addEventListener("click", async () => {
  if (isRootLogin) {
    try {
      const qs = await api("/auth/recovery/root/questions");
      showRecoveryModal(null, null, qs, true);
    } catch (err) { toast(err.message, true); }
    return;
  }
  const slug = document.getElementById("companySlug").value.trim();
  const id = document.getElementById("userId").value.trim();
  if (!slug || !id) return toast("Enter Company and User ID first, then click Forgot password.", true);
  try {
    const qs = await api(`/auth/recovery/${encodeURIComponent(slug)}/${encodeURIComponent(id)}/questions`);
    showRecoveryModal(slug, id, qs, false);
  } catch (err) { toast(err.message, true); }
});

function showRecoveryModal(slug, id, qs, isRoot) {
  openModal(`
    <h3>Account Recovery</h3>
    <div class="field" style="margin-bottom:12px;"><label>${esc(qs.question1)}</label><input id="rec-a1" /></div>
    <div class="field" style="margin-bottom:12px;"><label>${esc(qs.question2)}</label><input id="rec-a2" /></div>
    <div class="field" style="margin-bottom:16px;"><label>New Password</label><input id="rec-newpw" type="password" /></div>
    <div class="row-actions" style="justify-content:flex-end;">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-accent" id="rec-submit">Reset Password</button>
    </div>
  `);
  document.getElementById("rec-submit").addEventListener("click", async () => {
    try {
      const path = isRoot ? "/auth/recovery/root/reset" : `/auth/recovery/${encodeURIComponent(slug)}/${encodeURIComponent(id)}/reset`;
      await api(path, { method: "POST", body: {
        answer1: document.getElementById("rec-a1").value,
        answer2: document.getElementById("rec-a2").value,
        newPassword: document.getElementById("rec-newpw").value,
      }});
      toast("Password reset. You can log in now.");
      closeModal();
    } catch (err) { toast(err.message, true); }
  });
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  const wasRoot = ME.isRoot;
  await api("/auth/logout", { method: "POST" });
  ME = null;
  if (!wasRoot) {
    const lastCompany = sessionStorage.getItem("bv_last_company");
    if (lastCompany) {
      location.href = `${location.origin}/?company=${encodeURIComponent(lastCompany)}`;
      return;
    }
  }
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("login-screen").style.display = "block";
});

function openModal(html) {
  document.getElementById("modal-root").innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><div class="modal">${html}</div></div>`;
  document.getElementById("modal-backdrop").addEventListener("click", (e) => { if (e.target.id === "modal-backdrop") closeModal(); });
}
function closeModal() { document.getElementById("modal-root").innerHTML = ""; }
window.closeModal = closeModal;

async function bootApp() {
  try { ME = await api("/auth/me"); } catch { return; }
  document.getElementById("login-screen").style.display = "none";
  document.getElementById("app-shell").classList.remove("hidden");
  document.getElementById("user-name").innerHTML = `${esc(ME.name)} &middot; <b>${ME.isRoot ? "Root" : ME.role === "admin" ? "Admin" : "Employee"}</b>`;

  if (ME.isRoot) COMPANIES = await api("/companies");
  renderHeader();
  renderLangToggle();
  renderTabs();
  navigate(ME.isRoot ? "companies" : "inward");
}

function renderHeader() {
  if (ME.isRoot) {
    const sel = COMPANIES.find((c) => c.id === ME.selectedCompanyId);
    document.getElementById("brand-name").textContent = sel ? sel.name : "Beam Veda";
    document.getElementById("brand-sub").textContent = sel ? "Beam Pipe Stock Register" : "Root Administration";
    document.getElementById("app-contact").textContent = sel ? (sel.contact || "") : "";
    document.getElementById("brand-logo").innerHTML = `<svg viewBox="0 0 48 48" width="30" height="30" fill="none"><circle cx="24" cy="24" r="20" stroke="#fff" stroke-width="2.5"/><circle cx="24" cy="24" r="12" stroke="#fff" stroke-width="2.5"/><circle cx="24" cy="24" r="4" fill="#fff"/></svg>`;
  } else {
    document.getElementById("brand-name").textContent = ME.companyName || "";
    document.getElementById("brand-sub").textContent = "Beam Pipe Stock Register";
    document.getElementById("app-contact").textContent = ME.companyContact || "";
    if (ME.hasLogo && ME.companySlug) {
      document.getElementById("brand-logo").innerHTML = `<img src="/api/companies/public/${encodeURIComponent(ME.companySlug)}/logo" alt="${esc(ME.companyName)} logo" />`;
    } else {
      document.getElementById("brand-logo").innerHTML = `<svg viewBox="0 0 48 48" width="30" height="30" fill="none"><circle cx="24" cy="24" r="20" stroke="#fff" stroke-width="2.5"/><circle cx="24" cy="24" r="12" stroke="#fff" stroke-width="2.5"/><circle cx="24" cy="24" r="4" fill="#fff"/></svg>`;
    }
  }
}

function tabConfig() {
  const rootWithCompany = ME.isRoot && ME.selectedCompanyId;
  if (ME.isRoot) {
    return rootWithCompany
      ? [["companies", t("tab_companies")], ["inward", t("tab_inward")], ["outward", t("tab_outward")], ["all", t("tab_all")], ["reports", t("tab_reports")], ["users", t("tab_users")], ["lookups", t("tab_lookups")], ["housekeeping", t("tab_housekeeping")], ["backups", t("tab_backups")], ["account", t("tab_account")]]
      : [["companies", t("tab_companies")], ["all", t("tab_all")], ["reports", t("tab_reports")], ["users", t("tab_users")], ["housekeeping", t("tab_housekeeping")], ["backups", t("tab_backups")], ["account", t("tab_account")]];
  }
  if (ME.role === "admin") {
    return [["inward", t("tab_inward")], ["outward", t("tab_outward")], ["all", t("tab_all")], ["reports", t("tab_reports")], ["users", t("tab_users")], ["lookups", t("tab_lookups")], ["housekeeping", t("tab_housekeeping")], ["company-info", t("tab_companyinfo")], ["account", t("tab_account")]];
  }
  if (ME.role === "viewer") {
    // Read-only role (recommendation, implemented) — Reports and All Records only.
    return [["all", t("tab_all")], ["reports", t("tab_reports")], ["account", t("tab_account")]];
  }
  return [["inward", t("tab_inward")], ["outward", t("tab_outward")], ["account", t("tab_account")]];
}

function renderTabs() {
  document.getElementById("tabs").innerHTML = tabConfig()
    .map(([key, label]) => `<button class="tab-btn ${key === CURRENT_TAB ? "active" : ""}" data-tab="${key}">${esc(label)}</button>`)
    .join("");
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => navigate(btn.dataset.tab)));
}

async function navigate(tab) {
  CURRENT_TAB = tab;
  renderTabs();
  document.getElementById("page-title").textContent = "Beam Veda";
  const content = document.getElementById("page-content");
  content.innerHTML = `<div class="card">Loading…</div>`;
  try {
    if (tab === "companies") return renderCompanies();
    if (tab === "inward") return renderInwardTab();
    if (tab === "outward") return renderOutwardTab();
    if (tab === "all") return renderAllRecords();
    if (tab === "reports") return renderReports();
    if (tab === "users") return renderUsers();
    if (tab === "lookups") return renderLookups();
    if (tab === "housekeeping") return renderHousekeeping();
    if (tab === "backups") return renderBackups();
    if (tab === "company-info") return renderCompanyInfo();
    if (tab === "account") return renderAccount();
  } catch (err) {
    content.innerHTML = `<div class="card banner banner-error">${esc(err.message)}</div>`;
  }
}

async function renderCompanies() {
  COMPANIES = await api("/companies");
  const rows = COMPANIES.map((c) => `
    <tr>
      <td data-label="Name">${esc(c.name)}</td><td data-label="Slug" class="mono">${esc(c.slug)}</td>
      <td data-label="Status">${c.active ? '<span class="pill pill-open">Active</span>' : '<span class="pill pill-closed">Inactive</span>'}</td>
      <td data-label="Actions">
        <button class="btn btn-sm" onclick="selectCompanyAndGo(${c.id})">Work in this company</button>
        <button class="btn btn-sm" onclick="showEditCompanyModal(${c.id})">Edit</button>
        <button class="btn btn-sm" onclick="copySignupLink('${esc(c.slug)}')">Copy Signup Link</button>
        <button class="btn btn-sm" onclick="toggleCompanyActive(${c.id}, ${!c.active})">${c.active ? "Deactivate" : "Reactivate"}</button>
        <button class="btn btn-sm btn-danger" onclick="promptDeleteCompany(${c.id}, '${esc(c.slug)}')">Delete</button>
      </td>
    </tr>`).join("");
  document.getElementById("page-content").innerHTML = `
    <div class="row-actions">
      <button class="btn btn-accent" onclick="showAddCompanyModal()">+ Add Company</button>
      <button class="btn" onclick="selectCompanyAndGo(null)">View All (cross-company)</button>
    </div>
    <div class="card table-wrap"><table><thead><tr><th>Name</th><th>Slug</th><th>Status</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No companies yet.</td></tr>'}</tbody></table></div>
  `;
}
window.selectCompanyAndGo = async (companyId) => {
  await api("/companies/select", { method: "POST", body: { companyId } });
  ME = await api("/auth/me"); // refresh so companyLangSecondary etc. reflect the newly selected company
  renderHeader();
  renderLangToggle();
  navigate(companyId ? "inward" : "companies");
};
window.toggleCompanyActive = async (id, makeActive) => {
  await api(`/companies/${id}/${makeActive ? "reactivate" : "deactivate"}`, { method: "POST" });
  toast(makeActive ? "Company reactivated" : "Company deactivated");
  renderCompanies();
};
window.promptDeleteCompany = (id, slug) => {
  openModal(`
    <h3>Delete Company</h3>
    <p>This permanently deletes <strong>${esc(slug)}</strong> and all its data. Type the slug to confirm:</p>
    <div class="field" style="margin-bottom:14px;"><input id="confirm-slug" placeholder="${esc(slug)}" /></div>
    <div class="row-actions" style="justify-content:flex-end;">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" id="confirm-delete-btn">Delete Permanently</button>
    </div>
  `);
  document.getElementById("confirm-delete-btn").addEventListener("click", async () => {
    try {
      await api(`/companies/${id}`, { method: "DELETE", body: { confirmSlug: document.getElementById("confirm-slug").value } });
      toast("Company deleted"); closeModal(); renderCompanies();
    } catch (err) { toast(err.message, true); }
  });
};
window.copySignupLink = (slug) => {
  const link = `${location.origin}/?company=${encodeURIComponent(slug)}`;
  navigator.clipboard.writeText(link).then(
    () => toast("Signup link copied — paste it to the company"),
    () => toast(`Copy failed — link: ${link}`, true)
  );
};
window.showAddCompanyModal = () => {
  openModal(`
    <h3>Add Company</h3>
    <div class="grid">
      <div class="field" style="grid-column:1/-1;"><label>Company Name</label><input id="c-name" /></div>
      <div class="field" style="grid-column:1/-1;"><label>Slug (used in login URL)</label><input id="c-slug" placeholder="e.g. jain-wraptech" /></div>
      <div class="field" style="grid-column:1/-1;"><label>Contact</label><input id="c-contact" /></div>
      <div class="field" style="grid-column:1/-1;"><label>Secondary Language (their EN/toggle choice)</label><select id="c-lang-secondary">${languageOptions("hi")}</select></div>
      <div class="field"><label>Admin User ID</label><input id="c-admin-id" /></div>
      <div class="field"><label>Admin Name</label><input id="c-admin-name" /></div>
      <div class="field" style="grid-column:1/-1;"><label>Admin Password</label><input id="c-admin-pw" type="password" /></div>
    </div>
    <p class="helper">This sets the initial steer — the company's own admin can change it afterward from their Company Info tab.</p>
    <div class="row-actions" style="justify-content:flex-end;">
      <button class="btn" onclick="closeModal()">Cancel</button>
      <button class="btn btn-accent" id="c-submit">Create</button>
    </div>
  `);
  document.getElementById("c-submit").addEventListener("click", async () => {
    try {
      await api("/companies", { method: "POST", body: {
        name: document.getElementById("c-name").value, slug: document.getElementById("c-slug").value,
        contact: document.getElementById("c-contact").value,
        langSecondary: document.getElementById("c-lang-secondary").value,
        adminId: document.getElementById("c-admin-id").value, adminName: document.getElementById("c-admin-name").value,
        adminPassword: document.getElementById("c-admin-pw").value,
      }});
      toast("Company created"); closeModal(); renderCompanies();
    } catch (err) { toast(err.message, true); }
  });
};
window.showCompanyHistoryModal = async (companyId, companyName) => {
  try {
    const rows = await api(`/companies/${companyId}/history`);
    openModal(`
      <h3>Change History — ${esc(companyName)}</h3>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>By</th><th>Field</th><th>From</th><th>To</th></tr></thead><tbody>
        ${rows.map((r) => `<tr><td>${esc(r.changed_at)}</td><td class="mono">${esc(r.changed_by)}</td><td>${esc(r.field)}</td><td>${esc(r.old_value || "—")}</td><td>${esc(r.new_value || "—")}</td></tr>`).join("") || '<tr><td colspan="5">No changes recorded yet.</td></tr>'}
      </tbody></table></div>
      <div class="row-actions" style="justify-content:flex-end; margin-top:14px;"><button class="btn" onclick="closeModal()">Close</button></div>
    `);
  } catch (err) { toast(err.message, true); }
};
window.showEditCompanyModal = (companyId) => {
  const c = COMPANIES.find((x) => x.id === companyId);
  if (!c) return;
  openModal(`
    <h3>Edit Company</h3>
    <div class="grid">
      <div class="field" style="grid-column:1/-1;"><label>Company Name</label><input id="ec-name" value="${esc(c.name)}" /></div>
      <div class="field" style="grid-column:1/-1;"><label>Contact</label><input id="ec-contact" value="${esc(c.contact || "")}" /></div>
      <div class="field" style="grid-column:1/-1;"><label>Secondary Language (their EN/toggle choice)</label><select id="ec-lang-secondary">${languageOptions(c.lang_secondary)}</select></div>
      <div class="field" style="grid-column:1/-1;"><label>Company Logo</label><input id="ec-logo" type="file" accept="image/*" /></div>
    </div>
    <p class="helper">This company's own admin can also change the secondary language later — this just sets/updates it now. Logo stays root-only.</p>
    <div class="row-actions" style="justify-content:space-between;">
      <button class="btn btn-sm" onclick="showCompanyHistoryModal(${companyId}, '${esc(c.name)}')">View Change History</button>
      <div class="row-actions"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-accent" id="ec-submit">Save</button></div>
    </div>
  `);
  document.getElementById("ec-submit").addEventListener("click", async () => {
    try {
      await api(`/companies/${companyId}`, { method: "PUT", body: {
        name: document.getElementById("ec-name").value, contact: document.getElementById("ec-contact").value,
        langSecondary: document.getElementById("ec-lang-secondary").value,
      }});
      const logoFile = document.getElementById("ec-logo").files[0];
      if (logoFile) {
        const logoBase64 = await resizeImageBeforeUpload(logoFile, 400, 0.85);
        await api(`/companies/${companyId}/logo`, { method: "POST", body: { logoBase64 } });
      }
      toast("Company updated"); closeModal(); renderCompanies();
    } catch (err) { toast(err.message, true); }
  });
};

function resizeImageBeforeUpload(file, maxDim = 1200, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = reject;
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height = Math.round(height * (maxDim / width)); width = maxDim; }
      else if (height > maxDim) { width = Math.round(width * (maxDim / height)); height = maxDim; }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Builds a <select> from lookup values when that field's "use dropdown"
// toggle is on (per company), otherwise a plain text <input> — the actual
// wiring that was missing before (Lookups management existed but was never
// consulted by the entry forms themselves).
function lookupField(fieldKey, id, lookups, currentValue = "") {
  const field = lookups && lookups[fieldKey];
  if (field && field.useLookup) {
    const options = field.values.map((v) => `<option value="${esc(v)}" ${v === currentValue ? "selected" : ""}>${esc(v)}</option>`).join("");
    return `<select id="${id}"><option value="">— select —</option>${options}</select>`;
  }
  return `<input id="${id}" value="${esc(currentValue)}" />`;
}

async function renderInwardTab() {
  const lookups = await api("/lookups").catch(() => ({}));
  document.getElementById("page-content").innerHTML = `
    <div class="card">
      <h3>${t("new_inward_entry")}</h3>
      <div class="grid">
        <div class="field"><label>Customer #</label>${lookupField("customer_number", "i-customer", lookups)}</div>
        <div class="field"><label>Party Name</label>${lookupField("party_name", "i-party", lookups)}</div>
        <div class="field"><label>Pipe #</label>${lookupField("pipe_number", "i-pipeno", lookups)}</div>
        <div class="field"><label>Number of Pipes</label><input id="i-qty" type="number" min="1" /></div>
        <div class="field"><label>Pipe Size (optional)</label>${lookupField("pipe_size", "i-size", lookups)}</div>
        <div class="field"><label>Inward Date</label><input id="i-date" type="date" max="TODAY" value="TODAY" /></div>
        <div class="field"><label>Inward Vehicle Reg</label>${lookupField("inward_vehicle_reg", "i-vehicle", lookups)}</div>
        <div class="field" style="grid-column:1/-1;"><label>Notes</label><input id="i-notes" /></div>
        <div class="field" style="grid-column:1/-1;"><label>Photo (optional)</label><input id="i-photo" type="file" accept="image/*" capture="environment" /></div>
      </div>
      <p class="helper">Outward shipments (including split shipments) are recorded later from the Outward tab.</p>
      <div class="row-actions"><button class="btn btn-accent" id="i-submit">Save Entry</button></div>
    </div>
  `.replace(/TODAY/g, new Date().toISOString().slice(0,10));
  document.getElementById("i-submit").addEventListener("click", async () => {
    try {
      const body = {
        customer_number: document.getElementById("i-customer").value,
        party_name: document.getElementById("i-party").value,
        pipe_number: document.getElementById("i-pipeno").value,
        number_of_pipes: parseInt(document.getElementById("i-qty").value, 10),
        pipe_size: document.getElementById("i-size").value,
        inward_date: document.getElementById("i-date").value,
        inward_vehicle_reg: document.getElementById("i-vehicle").value,
        notes: document.getElementById("i-notes").value,
      };
      const file = document.getElementById("i-photo").files[0];
      if (file) body.photoBase64 = await resizeImageBeforeUpload(file);
      await api("/inward", { method: "POST", body });
      toast("Entry saved");
      renderInwardTab();
    } catch (err) { toast(err.message, true); }
  });
}

function entryRow(r, showCompany) {
  return `<tr>
    ${showCompany ? `<td data-label="Company">${esc(r.company_name || "—")}</td>` : ""}
    <td data-label="Customer #">${esc(r.customer_number || "—")}</td><td data-label="Party">${esc(r.party_name)}</td><td data-label="Pipe #" class="mono">${esc(r.pipe_number || "—")}</td>
    <td data-label="Inward Qty">${r.number_of_pipes}</td><td data-label="Shipped Qty">${r.shippedQty}</td><td data-label="Remaining Qty"><b>${r.remainingQty}</b></td>
    <td data-label="Size">${esc(r.pipe_size || "—")}</td><td data-label="Inward Date">${esc(r.inward_date)}</td>
    <td data-label="Status"><span class="pill ${pillClass(r.status)}">${r.status}</span></td>
    <td data-label="Actions"><button class="btn btn-sm" onclick="openEntryDetail('${r.id}')">View</button></td>
  </tr>`;
}
async function renderOutwardTab() {
  const showCompany = ME.isRoot && !ME.selectedCompanyId;
  if (showCompany && !COMPANIES.length) COMPANIES = await api("/companies");
  const data = await api("/inward/open?page=1&pageSize=10");
  document.getElementById("page-content").innerHTML = `
    <div class="row-actions">
      ${showCompany ? `<label style="font-size:12px;color:var(--steel);display:flex;align-items:center;gap:6px;">Company: <select id="outward-company-filter" onchange="loadOpenEntries(1,10)"><option value="">All</option>${COMPANIES.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>` : ""}
      <input id="search-q" placeholder="Search customer #, party, pipe #, vehicle…" style="min-width:240px; padding:9px 10px; border:1px solid var(--line); border-radius:6px;" />
      <button class="btn btn-sm" onclick="loadOpenEntries(1,10)">Search</button>
    </div>
    <div class="card table-wrap" id="outward-table">
      <h3>${t("outward_pending")} <span style="color:var(--steel-light);font-size:14px;text-transform:none;">(${data.total} open)</span></h3>
      <table>
        <thead><tr>${showCompany ? "<th>Company</th>" : ""}<th>Customer #</th><th>Party</th><th>Pipe #</th><th>Inward Qty</th><th>Shipped Qty</th><th>Remaining Qty</th><th>Size</th><th>Inward Date</th><th>Status</th><th></th></tr></thead>
        <tbody>${data.rows.map((r) => entryRow(r, showCompany)).join("") || `<tr><td colspan="${showCompany ? 10 : 9}">No open entries.</td></tr>`}</tbody>
      </table>
      ${paginationBar(data.total, data.page, data.pageSize, window.loadOpenEntries)}
    </div>
  `;
  document.getElementById("search-q").addEventListener("keydown", (e) => { if (e.key === "Enter") loadOpenEntries(1, 10); });
}
window.loadOpenEntries = async (page = 1, pageSize = 10) => {
  const showCompany = ME.isRoot && !ME.selectedCompanyId;
  const q = document.getElementById("search-q")?.value || "";
  const companyId = document.getElementById("outward-company-filter")?.value || "";
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (q) params.set("q", q);
  if (companyId) params.set("companyId", companyId);
  const data = await api(`/inward/open?${params.toString()}`);
  document.querySelector("#outward-table tbody").innerHTML = data.rows.map((r) => entryRow(r, showCompany)).join("") || `<tr><td colspan="${showCompany ? 10 : 9}">No matches.</td></tr>`;
  document.querySelector("#outward-table h3").innerHTML = `${t("outward_pending")} <span style="color:var(--steel-light);font-size:14px;text-transform:none;">(${data.total} open)</span>`;
  const pgBar = document.querySelector("#outward-table .row-actions:last-child");
  if (pgBar) pgBar.outerHTML = paginationBar(data.total, data.page, data.pageSize, window.loadOpenEntries);
  else document.getElementById("outward-table").insertAdjacentHTML("beforeend", paginationBar(data.total, data.page, data.pageSize, window.loadOpenEntries));
};
window.searchOpen = window.loadOpenEntries; // backward compat

window.openEntryDetail = async (id) => {
  const entry = await api(`/inward/${id}`);
  const shipments = await api(`/outward/inward/${id}`);
  const companyLine = ME.isRoot && entry.company_name ? `<p class="helper">Company: <b>${esc(entry.company_name)}</b></p>` : "";

  // All related images gathered into one visible gallery (inward + every
  // shipment's photo) — not just a text link, so nothing is easy to miss.
  const galleryItems = [];
  if (entry.photo_key) galleryItems.push({ label: "Inward photo", url: `/api/inward/${id}/photo` });
  shipments.forEach((s, i) => { if (s.photo_key) galleryItems.push({ label: `Outward #${i + 1} (${esc(s.outward_date)})`, url: `/api/outward/${s.id}/photo` }); });
  const gallery = galleryItems.length ? `
    <div class="card" style="margin:12px 0;">
      <h3 style="font-size:15px;">Photos (${galleryItems.length})</h3>
      <div style="display:flex; gap:12px; flex-wrap:wrap;">
        ${galleryItems.map((g) => `
          <div style="text-align:center;">
            <a href="#" onclick="showPhotoModal('${g.url}');return false;"><img src="${g.url}" alt="${esc(g.label)}" style="width:110px;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--line);display:block;" /></a>
            <div style="font-size:11px;color:var(--steel-light);margin-top:4px;max-width:110px;">${esc(g.label)}</div>
          </div>`).join("")}
      </div>
    </div>` : `<p class="helper">No photos attached to this entry or its shipments yet.</p>`;

  const shipRows = shipments.map((s) => `
    <tr><td data-label="Pipe #" class="mono">${esc(s.pipe_number || "—")}</td><td data-label="Qty">${s.number_of_pipes}</td><td data-label="Outward Date">${esc(s.outward_date)}</td><td data-label="Outward Vehicle">${esc(s.outward_vehicle_reg)}</td>
    ${ME.role === "admin" || ME.isRoot ? `<td data-label="Actions"><button class="btn btn-sm btn-danger" onclick="deleteShipment('${s.id}','${id}')">Delete</button></td>` : "<td></td>"}</tr>`).join("");
  openModal(`
    <h3>${esc(entry.party_name)} — ${esc(entry.customer_number || "no customer #")}</h3>
    ${companyLine}
    <p class="helper">Inward Qty: ${entry.number_of_pipes} &middot; Shipped Qty: ${entry.shippedQty} &middot; Remaining Qty: <b>${entry.remainingQty}</b> &middot; <span class="pill ${pillClass(entry.status)}">${entry.status}</span></p>
    ${gallery}
    <div class="table-wrap"><table><thead><tr><th>Pipe #</th><th>Qty</th><th>Outward Date</th><th>Outward Vehicle</th><th></th></tr></thead><tbody>${shipRows || '<tr><td colspan="5">No shipments yet.</td></tr>'}</tbody></table></div>
    <div class="row-actions" style="justify-content:space-between; margin-top:14px;">
      <div>
        ${entry.remainingQty > 0 && ME.role !== "viewer" ? `<button class="btn btn-accent" onclick="showShipOutModal('${id}', ${entry.remainingQty})">Ship Out</button>` : ""}
        ${ME.role === "admin" || ME.isRoot ? `<button class="btn" onclick="showEditInwardModal('${id}')">Edit</button>` : ""}
      </div>
      <button class="btn" onclick="closeModal()">Close</button>
    </div>
  `);
};
window.showPhotoModal = (url) => {
  openModal(`<h3>Photo</h3><img src="${url}" style="max-width:100%;border-radius:6px;display:block;" alt="Entry photo" />
    <div class="row-actions" style="justify-content:flex-end; margin-top:14px;">
      <a class="btn" href="${url}?download=1" download>Download</a>
      <button class="btn" onclick="closeModal()">Close</button>
    </div>`);
};
window.deleteShipment = async (shipmentId, inwardId) => {
  if (!confirm("Delete this shipment?")) return;
  try { await api(`/outward/${shipmentId}`, { method: "DELETE" }); toast("Shipment deleted"); openEntryDetail(inwardId); }
  catch (err) { toast(err.message, true); }
};
window.showShipOutModal = async (inwardId, remaining) => {
  const lookups = await api("/lookups").catch(() => ({}));
  openModal(`
    <h3>Record an Outward Shipment (remaining: ${remaining})</h3>
    <div class="grid">
      <div class="field"><label>Pipe #</label>${lookupField("pipe_number", "o-pipeno", lookups)}</div>
      <div class="field"><label>Outward Qty</label><input id="o-qty" type="number" min="1" max="${remaining}" /></div>
      <div class="field"><label>Outward Date</label><input id="o-date" type="date" max="TODAY" value="TODAY" /></div>
      <div class="field"><label>Outward Vehicle Reg</label>${lookupField("outward_vehicle_reg", "o-vehicle", lookups)}</div>
      <div class="field" style="grid-column:1/-1;"><label>Notes</label><input id="o-notes" /></div>
      <div class="field" style="grid-column:1/-1;"><label>Photo (optional)</label><input id="o-photo" type="file" accept="image/*" capture="environment" /></div>
    </div>
    <div class="row-actions" style="justify-content:flex-end; margin-top:14px;">
      <button class="btn" onclick="openEntryDetail('${inwardId}')">Back</button>
      <button class="btn btn-accent" id="o-submit">Save Shipment</button>
    </div>
  `.replace(/TODAY/g, new Date().toISOString().slice(0,10)));
  document.getElementById("o-submit").addEventListener("click", async () => {
    try {
      const body = {
        pipe_number: document.getElementById("o-pipeno").value,
        number_of_pipes: parseInt(document.getElementById("o-qty").value, 10),
        outward_date: document.getElementById("o-date").value,
        outward_vehicle_reg: document.getElementById("o-vehicle").value,
        notes: document.getElementById("o-notes").value,
      };
      const file = document.getElementById("o-photo").files[0];
      if (file) body.photoBase64 = await resizeImageBeforeUpload(file);
      await api(`/outward/${inwardId}`, { method: "POST", body });
      toast("Shipment recorded"); closeModal(); navigate(CURRENT_TAB);
    } catch (err) { toast(err.message, true); }
  });
};
window.showEditInwardModal = async (id) => {
  const entry = await api(`/inward/${id}`);
  openModal(`
    <h3>Edit Entry</h3>
    <div class="grid">
      <div class="field"><label>Customer #</label><input id="i-customer" value="${esc(entry.customer_number || "")}" /></div>
      <div class="field"><label>Party Name</label><input id="i-party" value="${esc(entry.party_name)}" /></div>
      <div class="field"><label>Pipe #</label><input id="i-pipeno" value="${esc(entry.pipe_number || "")}" /></div>
      <div class="field"><label>Number of Pipes</label><input id="i-qty" type="number" min="${entry.shippedQty}" value="${entry.number_of_pipes}" /></div>
      <div class="field"><label>Pipe Size (optional)</label><input id="i-size" value="${esc(entry.pipe_size || "")}" /></div>
      <div class="field"><label>Inward Date</label><input id="i-date" type="date" max="TODAY" value="${entry.inward_date}" /></div>
      <div class="field" style="grid-column:1/-1;"><label>Inward Vehicle Reg</label><input id="i-vehicle" value="${esc(entry.inward_vehicle_reg)}" /></div>
      <div class="field" style="grid-column:1/-1;"><label>Notes</label><input id="i-notes" value="${esc(entry.notes || "")}" /></div>
    </div>
    <div class="row-actions" style="justify-content:flex-end; margin-top:14px;">
      <button class="btn" onclick="openEntryDetail('${id}')">Back</button>
      <button class="btn btn-accent" id="i-submit">Save Changes</button>
    </div>
  `.replace(/TODAY/g, new Date().toISOString().slice(0,10)));
  document.getElementById("i-submit").addEventListener("click", async () => {
    try {
      await api(`/inward/${id}`, { method: "PUT", body: {
        customer_number: document.getElementById("i-customer").value, party_name: document.getElementById("i-party").value,
        pipe_number: document.getElementById("i-pipeno").value, number_of_pipes: parseInt(document.getElementById("i-qty").value, 10),
        pipe_size: document.getElementById("i-size").value, inward_date: document.getElementById("i-date").value,
        inward_vehicle_reg: document.getElementById("i-vehicle").value, notes: document.getElementById("i-notes").value,
      }});
      toast("Entry updated"); closeModal(); navigate(CURRENT_TAB);
    } catch (err) { toast(err.message, true); }
  });
};

async function renderAllRecords() {
  const showCompany = ME.isRoot && !ME.selectedCompanyId;
  if (showCompany && !COMPANIES.length) COMPANIES = await api("/companies");
  document.getElementById("page-content").innerHTML = `
    <div class="card">
      <div class="grid">
        ${showCompany ? `<div class="field"><label>Company</label><select id="f-company"><option value="">All companies</option>${COMPANIES.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>` : ""}
        <div class="field"><label>Customer #</label><input id="f-customer" /></div>
        <div class="field"><label>Party</label><input id="f-party" /></div>
        <div class="field"><label>Pipe #</label><input id="f-pipeno" /></div>
        <div class="field"><label>Status</label><select id="f-status"><option value="all">All</option><option value="open">Open</option><option value="partial">Partial</option><option value="closed">Closed</option></select></div>
        <div class="field"><label>Inward from</label><input id="f-from" type="date" /></div>
        <div class="field"><label>Inward to</label><input id="f-to" type="date" /></div>
        <div class="field"><label>Outward from</label><input id="f-outward-from" type="date" /></div>
        <div class="field"><label>Outward to</label><input id="f-outward-to" type="date" /></div>
      </div>
      <div class="row-actions"><button class="btn btn-accent btn-sm" onclick="loadAllRecords(1,10)">Filter</button><button class="btn btn-sm" onclick="clearAllRecordsFilters()">Clear</button></div>
    </div>
    <div class="card table-wrap" id="all-records-table"></div>
  `;
  loadAllRecords(1, 10);
}
window.clearAllRecordsFilters = () => {
  ["f-customer","f-party","f-pipeno","f-from","f-to","f-outward-from","f-outward-to"].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
  const fc = document.getElementById("f-company"); if (fc) fc.value = "";
  document.getElementById("f-status").value = "all";
  loadAllRecords(1, 10);
};
window.loadAllRecords = async (page = 1, pageSize = 10) => {
  const showCompany = ME.isRoot && !ME.selectedCompanyId;
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const map = { "f-customer": "customerNumber", "f-party": "party", "f-pipeno": "pipeNumber", "f-from": "from", "f-to": "to", "f-outward-from": "outwardFrom", "f-outward-to": "outwardTo" };
  for (const [id, key] of Object.entries(map)) { const v = document.getElementById(id)?.value; if (v) params.set(key, v); }
  const status = document.getElementById("f-status")?.value;
  if (status && status !== "all") params.set("status", status);
  const companyId = document.getElementById("f-company")?.value;
  if (companyId) params.set("companyId", companyId);
  const data = await api(`/inward?${params.toString()}`);
  const rows = data.rows.map((r) => entryRow(r, showCompany)).join("");
  document.getElementById("all-records-table").innerHTML = `<table>
    <thead><tr>${showCompany ? "<th>Company</th>" : ""}<th>Customer #</th><th>Party</th><th>Pipe #</th><th>Inward Qty</th><th>Shipped Qty</th><th>Remaining Qty</th><th>Size</th><th>Inward</th><th>Status</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="${showCompany ? 10 : 9}">No records match.</td></tr>`}</tbody>
  </table>` + paginationBar(data.total, data.page, data.pageSize, window.loadAllRecords);
};

async function renderReports() {
  const showCompanyFilter = ME.isRoot && !ME.selectedCompanyId;
  if (showCompanyFilter && !COMPANIES.length) COMPANIES = await api("/companies");
  document.getElementById("page-content").innerHTML = `
    <div class="row-actions">
      ${showCompanyFilter ? `<label style="font-size:12px;color:var(--steel);display:flex;align-items:center;gap:6px;">Filter by Company: <select id="report-company-filter" onchange="loadReport()"><option value="">All companies</option>${COMPANIES.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>` : ""}
      <button class="btn btn-sm" onclick="loadReport()">Refresh</button>
      <button class="btn btn-sm" onclick="downloadReportCsv()">Download CSV</button>
      <input id="email-to" placeholder="Email address(es), comma separated" style="min-width:220px; padding:8px 10px; border:1px solid var(--line); border-radius:6px;" />
      <button class="btn btn-accent btn-sm" onclick="emailReport()">Email Report</button>
    </div>
    <div id="report-stats" class="stat-grid"></div>
    <div class="card table-wrap" id="report-table"></div>
  `;
  loadReport();
}
window.loadReport = async (page = 1, pageSize = 10) => {
  const companyFilterEl = document.getElementById("report-company-filter");
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (companyFilterEl && companyFilterEl.value) params.set("companyId", companyFilterEl.value);
  const data = await api(`/reports?${params.toString()}`);
  const showCompany = ME.isRoot && !ME.selectedCompanyId;
  document.getElementById("report-stats").innerHTML = [
    ["Entries", data.summary.count], ["Total In", data.summary.totalInward], ["Total Shipped", data.summary.totalShipped],
    ["Open", data.summary.open], ["Partial", data.summary.partial], ["Closed", data.summary.closed],
  ].map(([lbl, num]) => `<div class="stat-box"><div class="num">${num}</div><div class="lbl">${lbl}</div></div>`).join("");
  document.getElementById("report-table").innerHTML = `<table><thead><tr>${showCompany ? "<th>Company</th>" : ""}<th>Customer #</th><th>Party</th><th>Inward Qty</th><th>Shipped</th><th>Remaining</th><th>Status</th></tr></thead><tbody>${
    data.rows.map((r) => `<tr>${showCompany ? `<td>${esc(r.company_name || "—")}</td>` : ""}<td>${esc(r.customer_number || "—")}</td><td>${esc(r.party_name)}</td><td>${r.number_of_pipes}</td><td>${r.shippedQty}</td><td>${r.remainingQty}</td><td><span class="pill ${pillClass(r.status)}">${r.status}</span></td></tr>`).join("") || `<tr><td colspan="${showCompany ? 7 : 6}">No data.</td></tr>`
  }</tbody></table>` + (data.total !== undefined ? paginationBar(data.total, data.page || 1, data.pageSize || 10, window.loadReport) : "");
};
window.downloadReportCsv = () => {
  const companyFilterEl = document.getElementById("report-company-filter");
  const qs = companyFilterEl && companyFilterEl.value ? `?companyId=${companyFilterEl.value}` : "";
  window.open(`/api/reports/csv${qs}`, "_blank");
};
window.emailReport = async () => {
  const to = document.getElementById("email-to").value;
  if (!to) return toast("Enter at least one email address", true);
  const companyFilterEl = document.getElementById("report-company-filter");
  const qs = companyFilterEl && companyFilterEl.value ? `?companyId=${companyFilterEl.value}` : "";
  try { await api(`/reports/email${qs}`, { method: "POST", body: { to } }); toast("Report emailed"); }
  catch (err) { toast(err.message, true); }
};

async function renderUsers(page = 1, pageSize = 10) {
  const showFilter = ME.isRoot && !ME.selectedCompanyId;
  if (showFilter && !COMPANIES.length) COMPANIES = await api("/companies");
  const companyId = document.getElementById("user-company-filter")?.value || "";
  const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (companyId) qs.set("companyId", companyId);
  const data = await api(`/users?${qs.toString()}`);
  const rows = renderUserRows(data.rows);
  document.getElementById("page-content").innerHTML = `
    <div class="row-actions">
      ${showFilter ? `<label style="font-size:12px;color:var(--steel);display:flex;align-items:center;gap:6px;">Filter by Company: <select id="user-company-filter" onchange="renderUsers(1,${pageSize})"><option value="">All companies</option>${COMPANIES.map((c) => `<option value="${c.id}" ${c.id === Number(companyId) ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>` : ""}
      ${(!ME.isRoot || ME.selectedCompanyId) ? '<button class="btn btn-accent" onclick="showAddUserModal()">+ Add User</button>' : '<p class="helper">Select a company first to manage its users.</p>'}
    </div>
    <div class="card table-wrap">
      <table><thead><tr><th>ID</th><th>Name</th><th>Role</th><th>Status</th>${ME.isRoot ? "<th>Company</th>" : ""}<th></th></tr></thead>
      <tbody id="users-tbody">${rows}</tbody></table>
      ${paginationBar(data.total, data.page, data.pageSize, (p, ps) => renderUsers(p, ps))}
    </div>
  `;
}
function renderUserRows(users) {
  return users.map((u) => `
    <tr><td data-label="ID" class="mono">${esc(u.id)}</td><td data-label="Name">${esc(u.name)}</td><td data-label="Role">${esc(u.role)}</td>
    <td data-label="Status">${u.active ? '<span class="pill pill-open">Active</span>' : '<span class="pill pill-closed">Inactive</span>'}</td>
    ${ME.isRoot ? `<td data-label="Company">${esc(u.company_name || "—")}</td>` : ""}
    <td data-label="Actions"><button class="btn btn-sm" onclick="toggleUserActive(${u.pk}, ${!u.active})">${u.active ? "Deactivate" : "Reactivate"}</button>
    <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.pk})">Delete</button></td></tr>`).join("") || '<tr><td colspan="6">No users.</td></tr>';
}
window.filterUserRows = () => renderUsers(1, 10);
window.showAddUserModal = () => {
  openModal(`
    <h3>Add User</h3>
    <div class="grid">
      <div class="field"><label>User ID</label><input id="u-id" /></div>
      <div class="field"><label>Name</label><input id="u-name" /></div>
      <div class="field"><label>Role</label><select id="u-role"><option value="employee">Employee</option><option value="admin">Admin</option><option value="viewer">Viewer (read-only)</option></select></div>
      <div class="field"><label>Language Override (optional)</label><select id="u-lang-override"><option value="">Use company default</option>${languageOptions("")}</select></div>
      <div class="field" style="grid-column:1/-1;"><label>Password</label>
        <div class="pw-wrap"><input id="u-pw" type="password" /><button type="button" class="pw-toggle" onclick="const i=document.getElementById('u-pw'); i.type = i.type==='password'?'text':'password';">Show</button></div>
      </div>
    </div>
    <p class="helper">Everyone toggles EN vs. the company's secondary language themselves — this override is only for the rare case where one specific person needs a different second language than their teammates.</p>
    <div class="row-actions" style="justify-content:flex-end;"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-accent" id="u-submit">Create</button></div>
  `);
  document.getElementById("u-submit").addEventListener("click", async () => {
    try {
      await api("/users", { method: "POST", body: {
        id: document.getElementById("u-id").value, name: document.getElementById("u-name").value,
        role: document.getElementById("u-role").value, password: document.getElementById("u-pw").value,
        langOverride: document.getElementById("u-lang-override").value || null,
      }});
      toast("User created"); closeModal(); renderUsers();
    } catch (err) { toast(err.message, true); }
  });
};
window.toggleUserActive = async (pk, active) => {
  try { await api(`/users/${pk}`, { method: "PUT", body: { active } }); toast("Updated"); renderUsers(); }
  catch (err) { toast(err.message, true); }
};
window.deleteUser = async (pk) => {
  if (!confirm("Delete this user?")) return;
  try { await api(`/users/${pk}`, { method: "DELETE" }); toast("User deleted"); renderUsers(); }
  catch (err) { toast(err.message, true); }
};

async function renderLookups() {
  const fields = await api("/lookups");
  document.getElementById("page-content").innerHTML = Object.entries(fields).map(([key, f]) => `
    <div class="card">
      <div class="row-actions" style="justify-content:space-between;">
        <strong>${esc(f.label)}</strong>
        <label style="font-size:13px;"><input type="checkbox" ${f.useLookup ? "checked" : ""} onchange="toggleUseLookup('${key}', this.checked)" /> Use dropdown list</label>
      </div>
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin:10px 0;">
        ${f.values.map((v) => `<span class="pill pill-open">${esc(v)} <a href="#" onclick="removeLookupValue('${key}','${esc(v)}');return false;" style="color:inherit;margin-left:4px;">×</a></span>`).join("") || "<span class='helper'>No values yet</span>"}
      </div>
      <div style="display:flex; gap:8px;">
        <input id="new-val-${key}" placeholder="Add value…" style="flex:1; padding:8px 10px; border:1px solid var(--line); border-radius:6px;" />
        <button class="btn btn-sm" onclick="addLookupValue('${key}')">Add</button>
      </div>
    </div>`).join("");
}
window.toggleUseLookup = async (key, useLookup) => { await api(`/lookups/fields/${key}`, { method: "PUT", body: { useLookup } }); toast("Saved"); };
window.addLookupValue = async (key) => {
  const input = document.getElementById(`new-val-${key}`);
  if (!input.value) return;
  try { await api(`/lookups/fields/${key}/values`, { method: "POST", body: { value: input.value } }); renderLookups(); }
  catch (err) { toast(err.message, true); }
};
window.removeLookupValue = async (key, value) => { await api(`/lookups/fields/${key}/values/${encodeURIComponent(value)}`, { method: "DELETE" }); renderLookups(); };

async function renderHousekeeping() {
  const rootAllView = ME.isRoot && !ME.selectedCompanyId;
  if (rootAllView) {
    if (!COMPANIES.length) COMPANIES = await api("/companies");
    document.getElementById("page-content").innerHTML = `
      <div class="card">
        <h3>Housekeeping — Multiple Companies</h3>
        <p class="helper">Tick companies below (leave all unticked to mean "all companies"), then choose an action. To manage one company's automatic-purge schedule, use "Work in this company" from the Companies tab instead.</p>
        <div style="display:flex; flex-wrap:wrap; gap:10px; margin:10px 0;">${COMPANIES.map((c) => `<label style="font-size:13px;"><input type="checkbox" class="hk-company-cb" value="${c.id}" /> ${esc(c.name)}</label>`).join("")}</div>
        <div class="field" style="max-width:220px;"><label>Cutoff date</label><input id="hk-cutoff" type="date" value="${new Date().toISOString().slice(0,10)}" /></div>
        <div class="row-actions"><button class="btn" onclick="hkBulkClearPhotos()">Clear Photos (Selected/All)</button><button class="btn btn-danger" onclick="hkBulkDeleteOld()">Delete Old Entries (Selected/All)</button></div>
      </div>
    `;
    return;
  }
  const stats = await api("/housekeeping/stats");
  const policy = await api("/housekeeping/retention");
  document.getElementById("page-content").innerHTML = `
    <div class="stat-grid">
      <div class="stat-box"><div class="num">${stats.total}</div><div class="lbl">Total Entries</div></div>
      <div class="stat-box"><div class="num">${stats.closed}</div><div class="lbl">Closed</div></div>
      <div class="stat-box"><div class="num">${stats.withPhotos}</div><div class="lbl">With Photos</div></div>
    </div>
    <div class="card">
      <h3>Manual Cleanup</h3>
      <div class="field" style="max-width:220px;"><label>Cutoff date</label><input id="hk-cutoff" type="date" value="TODAY" /></div>
      <div class="row-actions"><button class="btn" onclick="hkClearPhotos()">Clear Photos</button><button class="btn btn-danger" onclick="hkDeleteOld()">Delete Old Entries</button></div>
    </div>
    <div class="card">
      <h3>Automatic Purge</h3>
      <label style="font-size:13px;"><input type="checkbox" id="ap-enabled" ${policy.enabled ? "checked" : ""} /> Enable automatic weekly purge</label>
      <div class="grid" style="margin-top:10px;"><div class="field"><label>Purge closed entries after (days)</label><input id="ap-days" type="number" value="${policy.completed_retention_days}" /></div></div>
      <div class="row-actions"><button class="btn btn-accent" onclick="saveRetentionPolicy()">Save</button></div>
    </div>
  `.replace(/TODAY/g, new Date().toISOString().slice(0,10));
}
window.hkBulkClearPhotos = async () => {
  const companyIds = [...document.querySelectorAll(".hk-company-cb:checked")].map((el) => parseInt(el.value, 10));
  const cutoff = document.getElementById("hk-cutoff").value;
  try { const r = await api("/housekeeping/bulk-clear-photos", { method: "POST", body: { companyIds, cutoff } }); toast(`Cleared photos across ${r.results.length} companies`); }
  catch (err) { toast(err.message, true); }
};
window.hkBulkDeleteOld = async () => {
  if (!confirm("This permanently deletes old closed entries across the chosen companies. Continue?")) return;
  const companyIds = [...document.querySelectorAll(".hk-company-cb:checked")].map((el) => parseInt(el.value, 10));
  const cutoff = document.getElementById("hk-cutoff").value;
  try { const r = await api("/housekeeping/bulk-delete-old", { method: "POST", body: { companyIds, cutoff } }); toast(`Deleted old entries across ${r.results.length} companies`); }
  catch (err) { toast(err.message, true); }
};
window.hkClearPhotos = async () => {
  try { const r = await api("/housekeeping/clear-photos", { method: "POST", body: { cutoff: document.getElementById("hk-cutoff").value } }); toast(`Cleared ${r.photosCleared} photos`); }
  catch (err) { toast(err.message, true); }
};
window.hkDeleteOld = async () => {
  if (!confirm("This permanently deletes old closed entries. Continue?")) return;
  try { const r = await api("/housekeeping/delete-old", { method: "POST", body: { cutoff: document.getElementById("hk-cutoff").value } }); toast(`Deleted ${r.entriesDeleted} entries`); renderHousekeeping(); }
  catch (err) { toast(err.message, true); }
};
window.saveRetentionPolicy = async () => {
  try { await api("/housekeeping/retention", { method: "PUT", body: { enabled: document.getElementById("ap-enabled").checked, completedRetentionDays: parseInt(document.getElementById("ap-days").value, 10) }}); toast("Retention policy saved"); }
  catch (err) { toast(err.message, true); }
};

async function renderBackups() {
  const health = await api("/backups/health");
  const healthRows = health.map((h) => `<tr><td>${h.kind}</td><td>${h.status}</td><td>${esc(h.ran_at)}</td></tr>`).join("");
  let systemSection = "", bulkSection = "", settingsSection = "";
  if (ME.isRoot) {
    const settings = await api("/settings/platform");
    settingsSection = `<div class="card"><h3>Platform Settings</h3>
      <div class="grid" style="max-width:600px;">
        <div class="field"><label>Run automatic backups every (days)</label><input id="settings-backup-days" type="number" min="1" value="${settings.backup_frequency_days}" /></div>
        <div class="field"><label>Run automatic housekeeping every (days)</label><input id="settings-housekeeping-days" type="number" min="1" value="${settings.housekeeping_frequency_days}" /></div>
        <div class="field"><label>Platform support email (shown on login screen)</label><input id="settings-support-email" type="email" value="${esc(settings.support_email || "")}" placeholder="e.g. BeamVeda@gmail.com" /></div>
        <div class="field"><label>Support contact name</label><input id="settings-support-name" value="${esc(settings.support_email_name || "Beam Veda Support")}" /></div>
      </div>
      <p class="helper">Last automatic backup: ${esc(settings.last_backup_run || "never yet")} &middot; Last automatic housekeeping: ${esc(settings.last_housekeeping_run || "never yet")}</p>
      <p class="helper">The support email appears on every company's login screen so employees have a platform contact. Each company also has its own contact set separately in Companies → Edit.</p>
      <div class="row-actions"><button class="btn btn-accent" onclick="saveScheduleSettings()">Save</button></div>
    </div>`;
    const list = await api("/backups/system");
    systemSection = `<div class="card"><h3>System Backups (root)</h3><button class="btn btn-accent" onclick="runSystemBackupNow()">Run Backup Now</button>
      <div class="table-wrap" style="margin-top:10px;"><table><thead><tr><th>File</th><th>Uploaded</th><th></th></tr></thead><tbody>
      ${list.map((f) => `<tr><td class="mono">${esc(f.filename)}</td><td>${esc(f.uploaded)}</td><td><a class="btn btn-sm" href="/api/backups/system/${encodeURIComponent(f.filename.split('/').pop())}">Download</a> <button class="btn btn-sm btn-danger" onclick="promptRestoreSystem('${esc(f.filename.split('/').pop())}')">Restore</button></td></tr>`).join("") || '<tr><td colspan="3">No backups yet.</td></tr>'}
      </tbody></table></div></div>`;
    if (!COMPANIES.length) COMPANIES = await api("/companies");
    bulkSection = `<div class="card"><h3>Backups for Multiple Companies</h3>
      <p class="helper">Tick companies below (leave all unticked to mean "all companies"). For housekeeping/cleanup actions across companies, see the Housekeeping tab.</p>
      <div style="display:flex; flex-wrap:wrap; gap:10px; margin:10px 0;">${COMPANIES.map((c) => `<label style="font-size:13px;"><input type="checkbox" class="bulk-company-cb" value="${c.id}" /> ${esc(c.name)}</label>`).join("")}</div>
      <div class="row-actions"><button class="btn btn-accent btn-sm" onclick="bulkBackupSelected()">Backup Selected/All</button></div>
      </div>`;
  }
  let companySection = "";
  if (!ME.isRoot || ME.selectedCompanyId) {
    const list = await api("/backups/company");
    companySection = `<div class="card"><h3>Company Data Backup</h3><button class="btn btn-accent" onclick="runCompanyBackupNow()">Run Backup Now</button>
      <div class="table-wrap" style="margin-top:10px;"><table><thead><tr><th>File</th><th>Uploaded</th><th></th></tr></thead><tbody>
      ${list.map((f) => `<tr><td class="mono">${esc(f.filename)}</td><td>${esc(f.uploaded)}</td><td><a class="btn btn-sm" href="/api/backups/company/${encodeURIComponent(f.filename)}">Download</a> <button class="btn btn-sm btn-danger" onclick="promptRestoreCompany('${esc(f.filename)}')">Restore</button></td></tr>`).join("") || '<tr><td colspan="3">No backups yet.</td></tr>'}
      </tbody></table></div></div>`;
  }
  document.getElementById("page-content").innerHTML = `${settingsSection}${systemSection}${bulkSection}${companySection}
    <div class="card"><h3>Recent Backup Runs (health check)</h3><table><thead><tr><th>Kind</th><th>Status</th><th>When</th></tr></thead><tbody>${healthRows || '<tr><td colspan="3">No runs yet.</td></tr>'}</tbody></table></div>`;
}
window.promptRestoreSystem = (filename) => {
  openModal(`
    <h3>Restore System Backup</h3>
    <p class="banner banner-error">This overwrites <strong>ALL current data</strong> with the contents of <span class="mono">${esc(filename)}</span>. There is no undo except restoring a different backup.</p>
    <div class="field" style="margin-bottom:14px;"><label>Type RESTORE to confirm</label><input id="restore-confirm" placeholder="RESTORE" /></div>
    <div class="row-actions" style="justify-content:flex-end;"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-danger" id="restore-submit">Restore</button></div>
  `);
  document.getElementById("restore-submit").addEventListener("click", async () => {
    try {
      await api(`/backups/system/${encodeURIComponent(filename)}/restore`, { method: "POST", body: { confirmPhrase: document.getElementById("restore-confirm").value } });
      toast("System restored"); closeModal(); renderBackups();
    } catch (err) { toast(err.message, true); }
  });
};
window.promptRestoreCompany = (filename) => {
  openModal(`
    <h3>Restore Company Backup</h3>
    <p class="banner banner-error">This overwrites this company's <strong>current stock records</strong> (Inward, Outward, Lookups) with the contents of <span class="mono">${esc(filename)}</span>. There is no undo except restoring a different backup.</p>
    <div class="field" style="margin-bottom:14px;"><label>Type RESTORE to confirm</label><input id="restore-confirm" placeholder="RESTORE" /></div>
    <div class="row-actions" style="justify-content:flex-end;"><button class="btn" onclick="closeModal()">Cancel</button><button class="btn btn-danger" id="restore-submit">Restore</button></div>
  `);
  document.getElementById("restore-submit").addEventListener("click", async () => {
    try {
      await api(`/backups/company/${encodeURIComponent(filename)}/restore`, { method: "POST", body: { confirmPhrase: document.getElementById("restore-confirm").value } });
      toast("Company data restored"); closeModal(); renderBackups();
    } catch (err) { toast(err.message, true); }
  });
};
function selectedCompanyIds() { return [...document.querySelectorAll(".bulk-company-cb:checked")].map((el) => parseInt(el.value, 10)); }
window.runSystemBackupNow = async () => { try { await api("/backups/system/run", { method: "POST" }); toast("Backup complete"); renderBackups(); } catch (err) { toast(err.message, true); } };
window.saveScheduleSettings = async () => {
  try {
    await api("/settings/platform", { method: "PUT", body: {
      backupFrequencyDays: parseInt(document.getElementById("settings-backup-days").value, 10),
      housekeepingFrequencyDays: parseInt(document.getElementById("settings-housekeeping-days").value, 10),
      supportEmail: document.getElementById("settings-support-email").value || null,
      supportEmailName: document.getElementById("settings-support-name").value || "Beam Veda Support",
    }});
    toast("Settings saved"); renderBackups();
  } catch (err) { toast(err.message, true); }
};
window.runCompanyBackupNow = async () => { try { await api("/backups/company/run", { method: "POST" }); toast("Backup complete"); renderBackups(); } catch (err) { toast(err.message, true); } };
window.bulkBackupSelected = async () => { try { const r = await api("/backups/company/bulk-run", { method: "POST", body: { companyIds: selectedCompanyIds() } }); toast(`Backed up ${r.results.length} companies`); renderBackups(); } catch (err) { toast(err.message, true); } };

async function renderCompanyInfo() {
  document.getElementById("page-content").innerHTML = `
    <div class="card">
      <h3>Company Profile</h3>
      <div class="grid">
        <div class="field"><label>Company Name</label><input id="ci-name" value="${esc(ME.companyName || "")}" /></div>
        <div class="field" style="grid-column:1/-1;"><label>Contact</label><input id="ci-contact" value="${esc(ME.companyContact || "")}" /></div>
        <div class="field" style="grid-column:1/-1;"><label>Secondary Language (what your team can toggle to, alongside English)</label><select id="ci-lang-secondary">${languageOptions(ME.companyLangSecondary)}</select></div>
      </div>
      <p class="helper">Logo is set by your root administrator — contact them for changes there.</p>
      <div class="row-actions"><button class="btn btn-accent" id="ci-submit">Save</button></div>
    </div>
  `;
  document.getElementById("ci-submit").addEventListener("click", async () => {
    try {
      await api("/companies/me", { method: "PUT", body: {
        name: document.getElementById("ci-name").value, contact: document.getElementById("ci-contact").value,
        langSecondary: document.getElementById("ci-lang-secondary").value,
      }});
      ME = await api("/auth/me");
      renderHeader();
      renderLangToggle();
      toast("Company profile saved");
    } catch (err) { toast(err.message, true); }
  });
}

async function renderAccount() {
  document.getElementById("page-content").innerHTML = `
    <div class="card"><h3>Profile</h3><div class="field" style="max-width:320px;"><label>Display Name</label><input id="acc-name" value="${esc(ME.name)}" /></div><div class="row-actions"><button class="btn btn-accent" onclick="saveProfile()">Save</button></div></div>
    ${ME.isRoot ? `
    <div class="card"><h3>Change Password (requires your security question answers)</h3>
      <div class="grid" style="max-width:500px;">
        <div class="field"><label>Security Answer 1 (Favourite Colour)</label><input id="acc-ra1" /></div>
        <div class="field"><label>Security Answer 2 (Favourite Place)</label><input id="acc-ra2" /></div>
        <div class="field" style="grid-column:1/-1;"><label>New Password</label><input id="acc-newpw" type="password" /></div>
      </div>
      <div class="row-actions"><button class="btn btn-accent" onclick="changeRootPassword()">Change Password</button></div>
    </div>` : ME.role === "admin" ? `
    <div class="card"><h3>Change Password</h3><div class="field" style="max-width:320px;"><label>New Password</label><input id="acc-newpw" type="password" /></div><div class="row-actions"><button class="btn btn-accent" onclick="changeMyPassword()">Change Password</button></div></div>` : ""}
    ${ME.role === "admin" || ME.isRoot ? `
    <div class="card"><h3>Security Questions (used for password recovery)</h3>
      <div class="grid" style="max-width:500px;">
        <div class="field"><label>Favourite Colour</label><input id="acc-a1" /></div>
        <div class="field"><label>Favourite Place</label><input id="acc-a2" /></div>
      </div>
      <div class="row-actions"><button class="btn btn-accent" onclick="saveRecoveryQuestions()">Save Answers</button></div>
    </div>` : ""}
  `;
}
window.changeRootPassword = async () => {
  try { await api("/users/me/password-verified", { method: "PUT", body: { answer1: document.getElementById("acc-ra1").value, answer2: document.getElementById("acc-ra2").value, newPassword: document.getElementById("acc-newpw").value }}); toast("Password changed"); }
  catch (err) { toast(err.message, true); }
};
window.saveProfile = async () => {
  try { await api("/users/me/profile", { method: "PUT", body: { name: document.getElementById("acc-name").value } }); toast("Profile saved"); }
  catch (err) { toast(err.message, true); }
};
window.changeMyPassword = async () => {
  const newPassword = document.getElementById("acc-newpw").value;
  if (!newPassword) return;
  try { await api(`/users/${ME.pk}`, { method: "PUT", body: { password: newPassword } }); toast("Password changed"); }
  catch (err) { toast(err.message, true); }
};
window.saveRecoveryQuestions = async () => {
  try { await api("/users/me/recovery-questions", { method: "PUT", body: { answer1: document.getElementById("acc-a1").value, answer2: document.getElementById("acc-a2").value }}); toast("Security answers saved"); }
  catch (err) { toast(err.message, true); }
};

(async function init() {
  try { ME = await api("/auth/me"); await bootApp(); }
  catch { /* not logged in — show login screen (default state) */ }
})();
