(() => {
  "use strict";

  const PAGE = document.body?.dataset?.page || "";

  const SESSION_KEY = "jixels_departments_session_v1";
  const ACCOUNTS_KEY = "jixels_departments_accounts_v1";
  const ERP_KEY = "jixels_erp_v1";
  const HR_KEY = "jixels_hr_v1";
  const BRANCH_ACCOUNTS_KEY = "jixels_branch_accounts_v1";
  const AGENT_ACCOUNTS_KEY = "jixels_agent_accounts_v1";
  const DIRECTOR_ACCOUNT_KEY = "jixels_director_account_v1";
  const AUDIT_KEY = "jixels_audit_v1";
  const AUDIT_MAX = 1200;
  const NOTIFY_KEY = "jixels_notify_v1";
  const NOTIFY_SEEN_KEY = "jixels_notify_seen_v1";
  const SMS_OUTBOX_KEY = "jixels_sms_outbox_v1";
  const SMS_OUTBOX_MAX = 800;
  const API_ENABLED_KEY = "jixels_api_enabled_v1";
  const DIRECTOR_SESSION_LOCAL_KEY = "jixels_session_director_v1";
  const DIRECTOR_SESSION_SESSION_KEY = "jixels_session_director_tmp_v1";

  const $ = (sel, root = document) => root.querySelector(sel);

  const safeJsonParse = (raw, fallback) => {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };

  const getStore = () => {
    try {
      return window.JixelsStore || null;
    } catch {
      return null;
    }
  };

  const readBrowserJson = (key, fallback) => {
    for (const storage of [sessionStorage, localStorage]) {
      try {
        const raw = storage.getItem(key);
        if (!raw) continue;
        return safeJsonParse(raw, fallback);
      } catch {
        // Try the next storage.
      }
    }
    return fallback;
  };

  const mirrorBrowserJson = (key, value) => {
    try {
      const raw = JSON.stringify(value ?? null);
      sessionStorage.setItem(key, raw);
      localStorage.setItem(key, raw);
    } catch {
      // Browser storage can be blocked; KV remains the source of truth.
    }
  };

  const removeBrowserJson = (key) => {
    for (const storage of [sessionStorage, localStorage]) {
      try {
        storage.removeItem(key);
      } catch {
        // ignore
      }
    }
  };

  const loadJson = (key, fallback) => {
    const store = getStore();
    if (store?.getJson) {
      const fromStore = store.getJson(key, undefined);
      if (typeof fromStore !== "undefined" && fromStore !== null) return fromStore;
    }
    return readBrowserJson(key, fallback);
  };

  const loadJsonAnyStorage = (key, fallback) => {
    // Director session is still stored in browser session/local storage.
    let raw = null;
    try {
      raw = localStorage.getItem(key);
    } catch {
      raw = null;
    }

    if (raw === null) {
      try {
        raw = sessionStorage.getItem(key);
      } catch {
        raw = null;
      }
    }

    if (!raw) return fallback;
    return safeJsonParse(raw, fallback);
  };

  const removeJson = (key) => {
    if (isDirectorReadOnly()) return false;
    const store = getStore();
    try {
      if (store?.remove) {
        store.remove(key);
        removeBrowserJson(key);
        return true;
      }
    } catch {
      // ignore
    }
    removeBrowserJson(key);
    return true;
  };

  const isDirectorReadOnly = () => Boolean(getDirectorSession() && !getSession());

  const saveJson = (key, value) => {
    if (isDirectorReadOnly()) return false;
    mirrorBrowserJson(key, value);
    const store = getStore();
    try {
      if (store?.setJson) {
        store.setJson(key, value);
        return true;
      }
    } catch (err) {
      console.error("Store write failed:", key, err);
      return false;
    }

    return true;
  };

  const bootstrapFromApi = (() => {
    const keys = [
      ACCOUNTS_KEY,
      BRANCH_ACCOUNTS_KEY,
      AGENT_ACCOUNTS_KEY,
      DIRECTOR_ACCOUNT_KEY,
      ERP_KEY,
      HR_KEY,
      AUDIT_KEY,
      NOTIFY_KEY,
      SMS_OUTBOX_KEY,
    ];
    return async () => {
      const store = getStore();
      if (store?.bootstrap) {
        const res = await store.bootstrap(keys);
        return !!res?.ok;
      }
      return false;
    };
  })();

  const isoNow = () => new Date().toISOString();

  const currentRole = () => {
    const s = getActorSession();
    return s?.role ? normalizeRole(s.role) : "";
  };

  const toast = (title, body) => {
    const existing = $(".toast");
    if (existing) existing.remove();

    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<p class="t-title"></p><p class="t-body"></p>`;
    el.querySelector(".t-title").textContent = String(title || "Notification");
    el.querySelector(".t-body").textContent = String(body || "");
    document.body.appendChild(el);

    window.setTimeout(() => el.remove(), 3400);
  };

  const notify = (title, body, meta = {}) => {
    const makeId = () => {
      try {
        return `n-${crypto.getRandomValues(new Uint32Array(1))[0]}-${Date.now()}`;
      } catch {
        return `n-${Math.random().toString(16).slice(2)}-${Date.now()}`;
      }
    };

    const metaObj = meta && typeof meta === "object" ? meta : {};
    const rawAudience = metaObj.audienceRoles ?? metaObj.audience ?? null;
    const audienceRoles = Array.isArray(rawAudience)
      ? rawAudience.map((x) => normalizeRole(x)).filter(Boolean)
      : typeof rawAudience === "string" && rawAudience.trim()
        ? [normalizeRole(rawAudience)]
        : [];

    const payload = {
      id: makeId(),
      at: isoNow(),
      title: String(title || "Notification"),
      body: String(body || ""),
      meta: { ...metaObj, audienceRoles },
    };

    saveJson(NOTIFY_KEY, payload);

    const role = currentRole();
    const allow =
      role === "director" ||
      !audienceRoles.length ||
      audienceRoles.includes(role) ||
      audienceRoles.includes("all");
    if (allow) toast(payload.title, payload.body);
  };

  const queueSms = (to, message, meta = {}) => {
    const phone = String(to || "").trim();
    const text = String(message || "").trim();
    const digits = phone.replace(/\D/g, "");
    if (!phone || !digits || digits.length < 7 || !text) return null;

    const entry = {
      id: `sms-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: isoNow(),
      to: phone,
      message: text,
      status: "queued",
      meta: meta && typeof meta === "object" ? meta : {},
    };

    const existing = loadJson(SMS_OUTBOX_KEY, []);
    const list = Array.isArray(existing) ? existing : [];
    list.push(entry);
    const trimmed = list.length > SMS_OUTBOX_MAX ? list.slice(list.length - SMS_OUTBOX_MAX) : list;
    saveJson(SMS_OUTBOX_KEY, trimmed);
    audit("sms_queued", { to: phone, messagePreview: text.slice(0, 80), meta: entry.meta });
    return entry;
  };

  const postJson = async (url, body) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok && data?.ok !== false, status: res.status, data };
  };

  const notifyDepartmentsOfTransaction = (tx, branch) => {
    const amount = Number(tx?.amount || 0) || 0;
    const ref = String(tx?.ref || tx?.receipt || "transaction");
    const branchName = String(branch?.name || tx?.branchId || "Branch");
    const title = "Transaction recorded";
    const body = `${branchName}: KES ${formatInt(amount)} via ${String(tx?.channel || "payment").toUpperCase()} (${ref})`;
    notify(title, body, {
      audienceRoles: ["finance", "sales", "operations", "admin", "director"],
      type: "transaction",
      branchId: branch?.id || tx?.branchId || "",
      amountKes: amount,
      reference: ref,
    });
    postJson("/api/onesignal/notify", {
      included_segments: ["Finance", "Sales", "Branches"],
      headings: { en: title },
      contents: { en: body },
      data: { type: "transaction", branchId: branch?.id || "", amountKes: amount, reference: ref },
    }).catch(() => null);
  };

  const buildPaymentSms = ({ amountKes, paidAtIso }) => {
    const dt = paidAtIso ? new Date(paidAtIso) : new Date();
    const date = dt.toLocaleDateString();
    const time = dt.toLocaleTimeString();
    const year = String(dt.getFullYear());
    const amt = Number(amountKes || 0) || 0;
    return `Jixels Technologies: You have received KES ${formatInt(amt)}. Date: ${date}, Time: ${time}, Year: ${year}.`;
  };

  const normalizeRole = (role) => String(role || "").toLowerCase();

  const roleHome = (role) => {
    const r = normalizeRole(role);
    const homes = {
      hr: "departments-hr.html",
      finance: "departments-finance.html",
      operations: "departments-operations.html",
      sales: "departments-sales.html",
      admin: "departments-admin.html",
    };
    return homes[r] || "departments.html";
  };

  const getSession = () => {
    const s = loadJson(SESSION_KEY, null);
    if (!s || typeof s !== "object") return null;
    if (!s.role || !s.userId) return null;
    return s;
  };

  const getDirectorSession = () => {
    const s =
      loadJsonAnyStorage(DIRECTOR_SESSION_SESSION_KEY, null) ||
      loadJsonAnyStorage(DIRECTOR_SESSION_LOCAL_KEY, null);
    if (!s || typeof s !== "object") return null;
    if (normalizeRole(s.role) !== "director") return null;
    if (!s.userId) return null;
    return s;
  };

  const getActorSession = () => getSession() || getDirectorSession();

  const setSession = (session) => {
    saveJson(SESSION_KEY, { ...session, createdAt: isoNow() });
  };

  const clearSession = () => removeJson(SESSION_KEY);

  const audit = (action, details = {}) => {
    try {
      const events = loadJson(AUDIT_KEY, []);
      const list = Array.isArray(events) ? events : [];
      const s = getActorSession();
      list.push({
        at: isoNow(),
        page: PAGE,
        action: String(action || ""),
        actor: s ? { role: String(s.role || ""), userId: String(s.userId || ""), username: String(s.username || "") } : null,
        details,
      });
      const trimmed = list.length > AUDIT_MAX ? list.slice(list.length - AUDIT_MAX) : list;
      saveJson(AUDIT_KEY, trimmed);
    } catch (err) {
      console.error("Audit log failed:", err);
    }
  };

  const safe = (label, fn) => (...args) => {
    const showError = (err) => {
      const msg = String(err?.userMessage || err?.message || "Action could not complete. Please try again.").trim();
      toast("Action failed", msg);
    };
    try {
      const result = fn(...args);
      if (result && typeof result.then === "function") {
        return result.catch((err) => {
          console.error(label, err);
          audit("error", { label, message: String(err?.message || err), stack: String(err?.stack || "") });
          showError(err);
          return null;
        });
      }
      return result;
    } catch (err) {
      console.error(label, err);
      audit("error", { label, message: String(err?.message || err), stack: String(err?.stack || "") });
      // Keep UI alive.
      showError(err);
      return null;
    }
  };

  let lastNotifyId = "";
  const initNotificationListener = () => {
    try {
      lastNotifyId = String(sessionStorage.getItem(NOTIFY_SEEN_KEY) || "");
    } catch {
      // ignore
    }

    // Show the latest notification on load (useful when HR opens after an event).
    const latest = loadJson(NOTIFY_KEY, null);
    if (latest && typeof latest === "object") {
      const id = String(latest.id || "");
      if (id && id !== lastNotifyId) {
        const role = currentRole();
        const audience = Array.isArray(latest?.meta?.audienceRoles) ? latest.meta.audienceRoles.map((x) => normalizeRole(x)) : [];
        const allow = role === "director" || !audience.length || audience.includes(role) || audience.includes("all");
        if (allow) {
          lastNotifyId = id;
          try {
            sessionStorage.setItem(NOTIFY_SEEN_KEY, id);
          } catch {
            // ignore
          }
          toast(String(latest.title || "Notification"), String(latest.body || ""));
        }
      }
    }

    const store = getStore();
    if (store?.subscribe) {
      store.subscribe(
        safe("dept_notify_store", (ev) => {
          if (!ev || ev.type !== "set" || ev.key !== NOTIFY_KEY) return;
          const next = ev.value;
          if (!next || typeof next !== "object") return;
          const id = String(next.id || "");
          if (!id || id === lastNotifyId) return;
          lastNotifyId = id;
          const role = currentRole();
          const audience = Array.isArray(next?.meta?.audienceRoles)
            ? next.meta.audienceRoles.map((x) => normalizeRole(x))
            : [];
          const allow = role === "director" || !audience.length || audience.includes(role) || audience.includes("all");
          if (!allow) return;
          try {
            sessionStorage.setItem(NOTIFY_SEEN_KEY, id);
          } catch {
            // ignore
          }
          toast(String(next.title || "Notification"), String(next.body || ""));
        }),
      );
    } else {
      window.addEventListener(
        "storage",
        safe("dept_notify_storage", (e) => {
          if (e.key !== NOTIFY_KEY) return;
          const next = safeJsonParse(e.newValue, null);
          if (!next || typeof next !== "object") return;
          const id = String(next.id || "");
          if (!id || id === lastNotifyId) return;
          lastNotifyId = id;
          const role = currentRole();
          const audience = Array.isArray(next?.meta?.audienceRoles)
            ? next.meta.audienceRoles.map((x) => normalizeRole(x))
            : [];
          const allow = role === "director" || !audience.length || audience.includes(role) || audience.includes("all");
          if (!allow) return;
          try {
            sessionStorage.setItem(NOTIFY_SEEN_KEY, id);
          } catch {
            // ignore
          }
          toast(String(next.title || "Notification"), String(next.body || ""));
        }),
      );
    }
  };

  window.addEventListener("error", (e) => {
    audit("window_error", { message: e?.message || "Unknown error", source: e?.filename || "", line: e?.lineno || 0 });
  });

  window.addEventListener("unhandledrejection", (e) => {
    const reason = e?.reason;
    audit("unhandled_rejection", { reason: typeof reason === "string" ? reason : String(reason?.message || reason || "Unknown") });
  });

  const loadAccounts = () => {
    const raw = loadJson(ACCOUNTS_KEY, []);
    return Array.isArray(raw) ? raw : [];
  };

  const ensureDefaultAccounts = () => {
    const existing = loadAccounts();
    if (existing.length) return;
    saveJson(ACCOUNTS_KEY, [
      { id: "hr-1", role: "hr", username: "hr", password: "hr123" },
      { id: "fin-1", role: "finance", username: "finance", password: "finance123" },
      { id: "ops-1", role: "operations", username: "ops", password: "ops123" },
      { id: "sales-1", role: "sales", username: "sales", password: "sales123" },
      { id: "admin-1", role: "admin", username: "admin", password: "admin123" },
    ]);
  };

  const ensureERP = () => {
    const existing = loadJson(ERP_KEY, null);
    if (existing && typeof existing === "object" && Array.isArray(existing.branches)) return existing;

    const BRANCH_COUNT = 47;
    const makeId = (prefix, index) => `${prefix}${String(index).padStart(2, "0")}`;
    const branches = Array.from({ length: BRANCH_COUNT }, (_, idx) => {
      const i = idx + 1;
      return {
        id: makeId("b", i),
        name: `Branch ${String(i).padStart(2, "0")}`,
        city: "",
        area: "",
        employees: 0,
        inventory: [],
        phones: [],
        soldPhones: [],
        transactions: [],
        txLog: [],
        damageLoss: [],
        financeSummary: { mpesaIn: 0, bankIn: 0, txCount: 0, lastTxAt: "" },
        ledger: { head: "GENESIS" },
        updatedAt: isoNow(),
      };
    });

    const seeded = { version: 1, lastUpdated: isoNow(), branches, departments: {} };
    saveJson(ERP_KEY, seeded);
    return seeded;
  };

  const ensureHR = () => {
    const seeded = { version: 3, updatedAt: isoNow(), employees: [], payrollQueue: [] };
    const existing = loadJson(HR_KEY, null);

    if (!existing || typeof existing !== "object" || !Array.isArray(existing.employees)) {
      saveJson(HR_KEY, seeded);
      return seeded;
    }

    const toMoney = (value, fallback = 0) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return fallback;
      return Math.max(0, num);
    };

    const hr = { ...seeded, ...existing };
    hr.version = Math.max(3, Number(existing.version || 1) || 1);
    hr.updatedAt = existing.updatedAt || hr.updatedAt;
    hr.employees = Array.isArray(existing.employees) ? existing.employees : [];
    hr.payrollQueue = Array.isArray(existing.payrollQueue) ? existing.payrollQueue : [];

    hr.employees = hr.employees.map((e) => {
      const salary = toMoney(e.salary, 0);
      const debtAmount = toMoney(e.debtAmount, 0);
      const payAmount = toMoney(e.payAmount, salary || 0);
      const debtAt = debtAmount > 0 ? String(e.debtAt || e.debtWhen || isoNow()) : "";
      const forwardedToFinance = Boolean(e.forwardedToFinance);
      const financeReviewRaw = String(e.financeReview || e.financeStatus || "").trim().toLowerCase();
      const financeReview =
        financeReviewRaw === "accepted" || financeReviewRaw === "rejected" || financeReviewRaw === "pending"
          ? financeReviewRaw
          : forwardedToFinance
            ? "pending"
            : "";
      const financeReviewAt = financeReview ? String(e.financeReviewAt || "") : "";
      const financeReviewBy = financeReview ? String(e.financeReviewBy || "") : "";
      return {
        id: String(e.id || ""),
        name: String(e.name || ""),
        phone: String(e.phone || ""),
        department: String(e.department || e.dept || "HR"),
        role: String(e.role || ""),
        branchId: String(e.branchId || ""),
        salary,
        payAmount,
        debtType: String(e.debtType || ""),
        debtAmount,
        debtAt,
        status: String(e.status || "active"),
        forwardedToFinance,
        financeReview,
        financeReviewAt,
        financeReviewBy,
        createdAt: String(e.createdAt || isoNow()),
      };
    });

    hr.payrollQueue = hr.payrollQueue.map((item) => {
      if (!item || typeof item !== "object") return null;
      const employeeId = String(item.employeeId || item.empId || "");
      const at = String(item.at || item.sentAt || isoNow());
      const id = String(item.id || `${employeeId}::${at}`);
      const salary = toMoney(item.salary, 0);
      const payAmount = toMoney(item.payAmount ?? item.amount, salary || 0);
      const debtAmount = toMoney(item.debtAmount, 0);
      const debtType = String(item.debtType || "");
      const debtAt = debtAmount > 0 ? String(item.debtAt || isoNow()) : "";
      const financeReviewRaw = String(item.financeReview || item.financeStatus || item.review || "").trim().toLowerCase();
      const financeReview =
        financeReviewRaw === "accepted" || financeReviewRaw === "rejected" || financeReviewRaw === "pending"
          ? financeReviewRaw
          : "pending";
      return {
        id,
        employeeId,
        name: String(item.name || ""),
        phone: String(item.phone || ""),
        role: String(item.role || ""),
        branchId: String(item.branchId || ""),
        branchName: String(item.branchName || ""),
        salary,
        payAmount,
        debtType,
        debtAmount,
        debtAt,
        at,
        financeReview,
        financeReviewAt: item.financeReviewAt ? String(item.financeReviewAt) : "",
        financeReviewBy: item.financeReviewBy ? String(item.financeReviewBy) : "",
        paid: Boolean(item.paid),
        paidAt: item.paidAt ? String(item.paidAt) : "",
      };
    }).filter(Boolean);

    saveJson(HR_KEY, hr);
    return hr;
  };

  const requireRole = (role) => {
    const wanted = normalizeRole(role);
    const s = getSession();
    if (s && normalizeRole(s.role) === wanted) return s;

    // Director can access all department pages without a separate departments login.
    const director = getDirectorSession();
    if (director) {
      return {
        role: wanted,
        userId: String(director.userId || ""),
        username: String(director.username || "director"),
        director: true,
      };
    }

    if (!s) {
      window.location.href = `departments.html?role=${encodeURIComponent(String(role || ""))}`;
      return null;
    }

    audit("role_mismatch_redirect", { have: String(s.role || ""), need: String(role || "") });
    clearSession();
    window.location.href = `departments.html?role=${encodeURIComponent(String(role || ""))}&mismatch=1`;
    return null;
  };

  const initLogin = () => {
    ensureDefaultAccounts();

    const form = $("#dept-login-form");
    const roleSel = $("#dept-role");
    const username = $("#dept-username");
    const password = $("#dept-password");
    const error = $("#dept-login-error");
    const registerLink = $("#dept-register-link");

    if (!form || !roleSel || !username || !password || !error) return;

    // Always allow switching departments from the login page.
    const existing = getSession();
    if (existing?.role) {
      clearSession();
      error.textContent = "Previous session cleared. Please login.";
      error.style.color = "var(--warn)";
      audit("session_cleared", { role: existing.role, userId: existing.userId, username: existing.username });
    }

    // Prefill after registration (or deep links).
    const params = new URLSearchParams(window.location.search || "");
    const roleParam = normalizeRole(params.get("role") || "");
    const userParam = String(params.get("username") || "").trim().toLowerCase();
    if (roleParam && Array.from(roleSel.options).some((o) => normalizeRole(o.value) === roleParam)) {
      roleSel.value = roleParam;
    }
    if (registerLink) {
      registerLink.href = roleParam
        ? `departments-register.html?role=${encodeURIComponent(roleParam)}`
        : "departments-register.html";
    }
    if (userParam) username.value = userParam;
    if (params.get("registered") === "1") {
      error.textContent = "Account created successfully. Please login.";
      error.style.color = "var(--ok)";
    }
    if (params.get("mismatch") === "1") {
      error.textContent = "Please login to access the selected department.";
      error.style.color = "var(--warn)";
    }
    if ([...params.keys()].length) {
      try {
        const cleanUrl = new URL(window.location.href);
        cleanUrl.search = "";
        window.history.replaceState({}, "", cleanUrl.toString());
      } catch {
        // ignore
      }
    }

    form.addEventListener("submit", safe("dept_login_submit", async (e) => {
      e.preventDefault();
      error.textContent = "";
      error.style.color = "";

      const selectedRole = normalizeRole(roleSel.value);
      const u = String(username.value || "").trim().toLowerCase();
      const p = String(password.value || "");

      const accounts = loadAccounts();
      const acc =
        accounts.find(
          (a) =>
            selectedRole &&
            normalizeRole(a.role) === selectedRole &&
            String(a.username || "").toLowerCase() === u &&
            String(a.password || "") === p,
        ) ||
        accounts.find(
          (a) =>
            String(a.username || "").toLowerCase() === u &&
            String(a.password || "") === p,
        ) || null;

      if (!acc) {
        error.textContent = "Username or password is incorrect.";
        audit("login_failed", { role: selectedRole || "auto", username: u });
        return;
      }

      const role = normalizeRole(acc.role);
      setSession({ role, userId: acc.id, username: acc.username });
      ensureERP();
      ensureHR();
      audit("login_success", { role, userId: acc.id, username: acc.username });

      try {
        await getStore()?.flush?.();
      } catch {
        // ignore
      }
      window.location.href = roleHome(role);
    }));
  };

  const initRegister = () => {
    ensureDefaultAccounts();

    const form = $("#dept-register-form");
    const roleSel = $("#reg-role");
    const username = $("#reg-username");
    const password = $("#reg-password");
    const password2 = $("#reg-password2");
    const error = $("#dept-register-error");
    if (!form || !roleSel || !username || !password || !password2 || !error) return;

    const params = new URLSearchParams(window.location.search || "");
    const roleParam = normalizeRole(params.get("role") || "");
    if (roleParam && Array.from(roleSel.options).some((o) => normalizeRole(o.value) === roleParam)) {
      roleSel.value = roleParam;
    }

    form.addEventListener("submit", safe("dept_register_submit", async (e) => {
      e.preventDefault();
      error.textContent = "";

      const role = normalizeRole(roleSel.value);
      const u = String(username.value || "").trim().toLowerCase();
      const p1 = String(password.value || "");
      const p2 = String(password2.value || "");

      if (u.length < 2) return (error.textContent = "Username is required.");
      if (p1.length < 6) return (error.textContent = "Password must be at least 6 characters.");
      if (p1 !== p2) return (error.textContent = "Passwords do not match.");

      const accounts = loadAccounts();
      const taken = accounts.some(
        (a) =>
          normalizeRole(a.role) === role &&
          String(a.username || "").toLowerCase() === u,
      );
      if (taken) return (error.textContent = "Username already exists for that department.");

      const account = {
        id: `dept-${crypto.getRandomValues(new Uint32Array(1))[0]}`,
        role,
        username: u,
        password: p1,
        createdAt: isoNow(),
      };
      accounts.push(account);
      saveJson(ACCOUNTS_KEY, accounts);
      audit("register_success", { role, userId: account.id, username: u });
      setSession({ role, userId: account.id, username: account.username });
      ensureERP();
      ensureHR();
      try {
        await getStore()?.flush?.();
      } catch {
        // ignore
      }
      window.location.href = roleHome(role);
    }));
  };

  const initLogout = () => {
    const btn = $("#dept-logout-btn");
    if (!btn) return;

    const director = getDirectorSession();
    const dept = getSession();
    if (director && !dept) {
      btn.textContent = "Back";
      btn.addEventListener("click", safe("dept_back_to_director", () => {
        window.location.href = "Director.html";
      }));
      return;
    }

    btn.addEventListener("click", safe("dept_logout", () => {
      const s = getSession();
      clearSession();
      audit("logout", { role: s?.role || "", userId: s?.userId || "" });
      window.location.href = "departments.html";
    }));
  };

  const applyDirectorReadOnlyMode = () => {
    if (!isDirectorReadOnly()) return;
    document.body.dataset.readonly = "director";
    const allowedIds = new Set([
      "dept-logout-btn",
      "dept-report-btn",
      "dept-report-doc-btn",
      "dept-report-pdf-btn",
      "dept-report-period",
      "dept-report-due-date",
    ]);
    for (const el of document.querySelectorAll("button, input, select, textarea")) {
      if (allowedIds.has(el.id)) continue;
      const text = String(el.textContent || el.value || "").toLowerCase();
      const ident = `${el.id || ""} ${el.name || ""} ${el.getAttribute("placeholder") || ""}`.toLowerCase();
      const isReadAction =
        text.includes("view") ||
        text.includes("show") ||
        text.includes("hide") ||
        text.includes("search") ||
        ident.includes("search") ||
        ident.includes("query") ||
        text.includes("download") ||
        text.includes("print") ||
        text.includes("report");
      if (isReadAction) continue;
      el.disabled = true;
      el.setAttribute("aria-disabled", "true");
    }
    const allowed = (target) => {
      const el = target?.closest?.("button, input, select, textarea, a");
      if (!el) return true;
      if (allowedIds.has(el.id)) return true;
      const text = String(el.textContent || el.value || "").toLowerCase();
      const ident = `${el.id || ""} ${el.name || ""} ${el.getAttribute("placeholder") || ""}`.toLowerCase();
      return (
        text.includes("view") ||
        text.includes("show") ||
        text.includes("hide") ||
        text.includes("search") ||
        ident.includes("search") ||
        ident.includes("query") ||
        text.includes("download") ||
        text.includes("print") ||
        text.includes("report") ||
        el.tagName === "A"
      );
    };
    const block = (e) => {
      if (allowed(e.target)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      toast("Read only", "Director can view department data but cannot change it here.");
    };
    document.addEventListener("click", block, true);
    document.addEventListener("change", block, true);
    document.addEventListener("submit", block, true);
  };

  const initRolePage = (role) => {
    const s = requireRole(role);
    if (!s) return;
    initLogout();
    applyDirectorReadOnlyMode();
  };

  const formatInt = (value) => {
    const num = Number(value || 0);
    return Number.isFinite(num) ? num.toLocaleString("en-US") : "0";
  };

  const escapeHtml = (value) =>
    String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const downloadWordDocFile = (filename, reportHtml, title = "Report") => {
    const doc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; }
    h3 { margin: 0 0 6px; }
    p { margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; }
    th { background: #f6f6f6; text-align: left; }
    .num { text-align: right; }
  </style>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument xmlns:w="urn:schemas-microsoft-com:office:word">
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
    </w:WordDocument>
  </xml>
  <![endif]-->
</head>
<body>${reportHtml}</body>
</html>`;
    const blob = new Blob([doc], { type: "application/msword;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const downloadText = (filename, text, type = "text/plain;charset=utf-8") => {
    const blob = new Blob([String(text ?? "")], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const printHtmlReport = (reportHtml, title = "Report") => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.open();
    w.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; padding: 18px; }
    h3 { margin: 0 0 6px; }
    p { margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; }
    th { background: #f6f6f6; text-align: left; }
    .num { text-align: right; }
  </style>
</head>
<body>${reportHtml}</body>
</html>`);
    w.document.close();
    w.focus();
    w.print();
  };

  const initDeptReportCenter = ({ title, filenameBase, buildHtml }) => {
    const reportBtn = $("#dept-report-btn");
    const reportDocBtn = $("#dept-report-doc-btn");
    const reportPdfBtn = $("#dept-report-pdf-btn");
    const periodSelect = $("#dept-report-period");
    const dueDateInput = $("#dept-report-due-date");
    const reportOut = $("#dept-report-output");

    if (!reportOut || typeof buildHtml !== "function") return null;

    let lastHtml = "";
    const today = new Date().toISOString().slice(0, 10);

    const expandDetailsForExport = (html) =>
      String(html || "").replace(/<details\b(?![^>]*\bopen\b)/g, "<details open");

    const getReportRange = () => {
      const key = String(periodSelect?.value || "all").trim().toLowerCase();
      const now = new Date();
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      if (key === "monthly") {
        start.setDate(1);
        return { key, label: "This month", startMs: start.getTime(), endMs: now.getTime() };
      }
      if (key === "yearly") {
        start.setMonth(0, 1);
        return { key, label: "This year", startMs: start.getTime(), endMs: now.getTime() };
      }
      return { key: "all", label: "All time", startMs: -Infinity, endMs: Infinity };
    };

    const generate = () => {
      const dueDate = String(dueDateInput?.value || "").trim();
      const range = getReportRange();
      try {
        const html = expandDetailsForExport(String(buildHtml({ dueDate, period: range.key, range }) || ""));
        lastHtml = html;
        reportOut.innerHTML = html || "<p>No data.</p>";
        audit("report_generated", { title: String(title || "Report"), dueDate, period: range.key });
        return html;
      } catch (err) {
        const msg = String(err?.message || err || "Report generation failed.");
        const html = `<h3>${escapeHtml(title || "Report")}</h3><p>Report could not be generated: ${escapeHtml(msg)}</p>`;
        lastHtml = html;
        reportOut.innerHTML = html;
        audit("report_failed", { title: String(title || "Report"), dueDate, period: range.key, error: msg });
        return html;
      }
    };

    const ensureHtml = () => lastHtml || generate();
    const refreshIfGenerated = () => (lastHtml ? generate() : "");

    if (reportBtn) reportBtn.addEventListener("click", safe("dept_report_generate", () => generate()));
    if (periodSelect) periodSelect.addEventListener("change", safe("dept_report_period_change", () => generate()));
    if (reportDocBtn) {
      reportDocBtn.addEventListener("click", safe("dept_report_download_word", () => {
        const html = expandDetailsForExport(ensureHtml());
        if (!html) return;
        const filename = `${filenameBase || "jixels-report"}-${today}.doc`;
        downloadWordDocFile(filename, html, title || "Report");
        audit("report_export_word", { title: String(title || "Report"), filename });
      }));
    }
    if (reportPdfBtn) {
      reportPdfBtn.addEventListener("click", safe("dept_report_print_pdf", () => {
        const html = expandDetailsForExport(ensureHtml());
        if (!html) return;
        printHtmlReport(html, title || "Report");
        audit("report_export_pdf", { title: String(title || "Report") });
      }));
    }

    generate();
    return { generate, refreshIfGenerated };
  };

  const computeFinanceTotals = (erp) => {
    let mpesa = 0;
    let bank = 0;
    let tx = 0;
    let creditCount = 0;
    let creditBalance = 0;
    for (const b of erp.branches || []) {
      const fin = b.financeSummary || {};
      mpesa += Number(fin.mpesaIn || 0) || 0;
      bank += Number(fin.bankIn || 0) || 0;
      tx += Number(fin.txCount || 0) || 0;
      for (const sale of b.txLog || []) {
        if (String(sale.saleType || "").toLowerCase() !== "credit") continue;
        creditCount += 1;
        creditBalance += Number(sale.balance || 0) || 0;
      }
    }
    return { mpesa, bank, tx, creditCount, creditBalance };
  };

  const computeStockSold = (erp) => {
    let stock = 0;
    let sold = 0;
    for (const b of erp.branches || []) {
      for (const r of b.inventory || []) {
        stock += Number(r.stock || 0) || 0;
        sold += Number(r.sold || 0) || 0;
      }
    }
    return { stock, sold };
  };

  const rebuildInventoryFromPhones = (branch) => {
    const phones = Array.isArray(branch?.phones) ? branch.phones : [];
    const soldPhones = Array.isArray(branch?.soldPhones) ? branch.soldPhones : [];
    const byModel = new Map();
    for (const p of [...phones, ...soldPhones]) {
      const model = String(p.model || "").trim() || "—";
      const row = byModel.get(model) || { model, stock: 0, sold: 0 };
      if (String(p.status || "in_stock") === "sold") row.sold += 1;
      else row.stock += 1;
      byModel.set(model, row);
    }
    branch.inventory = Array.from(byModel.values()).sort((a, z) => String(a.model).localeCompare(String(z.model)));
  };

  const computeBranchInventoryTotals = (branchRaw) => {
    const branch = branchRaw && typeof branchRaw === "object" ? branchRaw : {};
    if (!Array.isArray(branch.inventory)) rebuildInventoryFromPhones(branch);

    const inventory = Array.isArray(branch.inventory) ? branch.inventory : [];
    const dl = Array.isArray(branch.damageLoss) ? branch.damageLoss : [];

    let stock = 0;
    let sold = 0;
    let damaged = 0;
    let lost = 0;
    let topModel = { model: "—", sold: -1 };

    for (const row of inventory) {
      const rowStock = Number(row.stock || 0) || 0;
      const rowSold = Number(row.sold || 0) || 0;
      stock += rowStock;
      sold += rowSold;
      if (rowSold > topModel.sold) topModel = { model: row.model || "—", sold: rowSold };
    }

    for (const r of dl) {
      const qty = Number(r.qty || 0);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (r.type === "lost") lost += qty;
      else damaged += qty;
    }

    return {
      models: inventory.length,
      stock,
      sold,
      damaged,
      lost,
      topModel: topModel.model || "—",
    };
  };

  const initHRPage = () => {
    const s = requireRole("hr");
    if (!s) return;
    initLogout();

    ensureERP();
    let hr = ensureHR();

    const name = $("#hr-name");
    const phone = $("#hr-phone");
    const department = $("#hr-dept");
    const role = $("#hr-role");
    const branch = $("#hr-branch");
    const salary = $("#hr-salary");
    const debtType = $("#hr-debt-type");
    const debtAmount = $("#hr-debt-amount");
    const addBtn = $("#hr-add");
    const tbody = $("#hr-tbody");

    const employeesPanel = $("#hr-employees-panel");
    const employeesToggle = $("#hr-employees-toggle");

    const payrollPanel = $("#hr-payroll-panel");
    const payrollToggle = $("#hr-payroll-toggle");
    const branchQuery = $("#hr-branch-query");
    const viewBranchBtn = $("#hr-view-branch");
    const forwardBranchBtn = $("#hr-forward-branch");
    const viewAllBtn = $("#hr-view-all");
    const forwardAllBtn = $("#hr-forward-all");
    const payrollStatus = $("#hr-payroll-status");
    const payrollTbody = $("#hr-payroll-tbody");

    const toMoney = (value, fallback = 0) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return fallback;
      return Math.max(0, num);
    };

    const branchNameById = (erp) => {
      const map = new Map();
      for (const b of erp?.branches || []) map.set(String(b.id), String(b.name || b.id));
      return map;
    };

    const findBranchByQuery = (erp, queryRaw) => {
      const q = String(queryRaw || "").trim().toLowerCase();
      if (!q) return null;
      const branches = Array.isArray(erp?.branches) ? erp.branches : [];
      const digits = q.replace(/\D/g, "");
      const exact = branches.find((b) => String(b.id).toLowerCase() === q) ||
        branches.find((b) => String(b.name || "").trim().toLowerCase() === q);
      if (exact) return exact;
      if (digits) {
        const byNumber = branches.find((b) => {
          const idDigits = String(b.id || "").replace(/\D/g, "");
          const nameDigits = String(b.name || "").replace(/\D/g, "");
          return idDigits === digits || nameDigits === digits || Number(idDigits) === Number(digits) || Number(nameDigits) === Number(digits);
        });
        if (byNumber) return byNumber;
      }
      return branches.find((b) => String(b.name || "").toLowerCase().includes(q)) || null;
    };

    let preview = { mode: "none", branchId: "", branchName: "" };

    const setPayrollStatus = (text) => {
      if (!payrollStatus) return;
      payrollStatus.textContent = String(text || "");
    };

    const showPayrollEmpty = (message, colSpan = 9) => {
      if (payrollTbody) {
        payrollTbody.innerHTML = `<tr><td colspan="${colSpan}">${escapeHtml(message || "No records found.")}</td></tr>`;
      }
      setPayrollStatus(message);
    };

    const syncEmployeeCountsToERP = (hrState, erpState) => {
      const erp = erpState || loadJson(ERP_KEY, null);
      if (!erp || !Array.isArray(erp.branches)) return;

      const counts = new Map();
      for (const emp of hrState?.employees || []) {
        if (String(emp.status || "active") !== "active") continue;
        const bId = String(emp.branchId || "").trim();
        if (!bId) continue;
        counts.set(bId, (counts.get(bId) || 0) + 1);
      }

      let changed = false;
      for (const b of erp.branches) {
        const next = counts.get(String(b.id)) || 0;
        if (Number(b.employees || 0) === next) continue;
        b.employees = next;
        b.updatedAt = isoNow();
        changed = true;
      }

      if (!changed) return;
      erp.lastUpdated = isoNow();
      saveJson(ERP_KEY, erp);
    };

    const renderEmployeesTable = () => {
      hr = ensureHR();
      hr = loadJson(HR_KEY, hr);
      const erp = loadJson(ERP_KEY, null);
      const bMap = branchNameById(erp);

      syncEmployeeCountsToERP(hr, erp);

      if (branch && erp?.branches) {
        const current = String(branch.value || "");
        branch.innerHTML = erp.branches
          .map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name || b.id)}</option>`)
          .join("");
        if (current) branch.value = current;
      }

      if (!tbody) return;
      tbody.textContent = "";
      for (const emp of (hr.employees || []).slice().reverse().slice(0, 80)) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td></td><td></td><td></td><td></td><td></td><td class="num"></td><td class="num"></td><td></td><td></td>`;
        tr.children[0].textContent = bMap.get(String(emp.branchId)) || emp.branchId || "—";
        tr.children[1].textContent = emp.name || "—";
        tr.children[2].textContent = emp.phone || "—";
        tr.children[3].textContent = emp.role || "—";
        tr.children[4].textContent = emp.department || "—";
        tr.children[5].textContent = formatInt(emp.salary || 0);
        tr.children[6].textContent = formatInt(emp.debtAmount || 0);
        let financeStatus = "Pending";
        if (emp.forwardedToFinance) {
          const review = String(emp.financeReview || "").toLowerCase();
          if (review === "accepted") financeStatus = "Accepted";
          else if (review === "rejected") financeStatus = "Rejected";
          else financeStatus = "Forwarded";
        }
        tr.children[7].textContent = financeStatus;

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn danger";
        delBtn.textContent = "Delete";
        delBtn.dataset.empId = String(emp.id || "");
        tr.children[8].appendChild(delBtn);

        tbody.appendChild(tr);
      }
    };

    const addEmployee = () => {
      hr = ensureHR();
      hr = loadJson(HR_KEY, hr);
      const erp = loadJson(ERP_KEY, null);
      const branchId = String(branch?.value || "").trim();

      const salaryValue = toMoney(salary?.value, 0);
      const debtAmountValue = toMoney(debtAmount?.value, 0);
      const emp = {
        id: `emp-${crypto.getRandomValues(new Uint32Array(1))[0]}`,
        name: String(name?.value || "").trim(),
        phone: String(phone?.value || "").trim(),
        department: String(department?.value || "HR").trim(),
        role: String(role?.value || "").trim(),
        branchId,
        salary: salaryValue,
        payAmount: salaryValue,
        debtType: String(debtType?.value || "").trim(),
        debtAmount: debtAmountValue,
        debtAt: debtAmountValue > 0 ? isoNow() : "",
        status: "active",
        forwardedToFinance: false,
        financeReview: "",
        financeReviewAt: "",
        financeReviewBy: "",
        createdAt: isoNow(),
      };

      if (!emp.name) return name?.focus?.();
      if (!emp.phone) return phone?.focus?.();
      if (!emp.role) return role?.focus?.();
      if (!branchId) return branch?.focus?.();
      if (!Number.isFinite(emp.salary) || emp.salary <= 0) return salary?.focus?.();

      // keep debt type empty when there is no debt amount
      if (!emp.debtAmount) {
        emp.debtType = "";
        emp.debtAt = "";
      }

      hr.employees = Array.isArray(hr.employees) ? hr.employees : [];
      hr.employees.push(emp);
      hr.updatedAt = isoNow();
      saveJson(HR_KEY, hr);
      audit("employee_added", {
        employeeId: emp.id,
        branchId: emp.branchId,
        department: emp.department,
        role: emp.role,
      });

      if (name) name.value = "";
      if (phone) phone.value = "";
      if (role) role.value = "";
      if (salary) salary.value = "";
      if (debtType) debtType.value = "";
      if (debtAmount) debtAmount.value = "";

      // keep ERP seeded (and available for branch search), but no deep coupling here.
      const erpState = erp || ensureERP();
      syncEmployeeCountsToERP(hr, erpState);

      renderEmployeesTable();
      if (preview.mode === "branch") viewBranch();
      if (preview.mode === "all") viewAll();
      reportApi?.refreshIfGenerated?.();
    };

    const deleteEmployee = (empId) => {
      const id = String(empId || "").trim();
      if (!id) return;
      if (!window.confirm("Delete this employee? Unpaid payroll items will be removed too.")) return;

      hr = ensureHR();
      hr = loadJson(HR_KEY, hr);
      hr.employees = Array.isArray(hr.employees) ? hr.employees : [];
      const before = hr.employees.length;
      hr.employees = hr.employees.filter((e) => String(e.id) !== id);
      if (hr.employees.length === before) return;

      hr.payrollQueue = Array.isArray(hr.payrollQueue) ? hr.payrollQueue : [];
      hr.payrollQueue = hr.payrollQueue.filter((item) => {
        if (!item || typeof item !== "object") return false;
        if (String(item.employeeId || "") !== id) return true;
        return Boolean(item.paid);
      });

      hr.updatedAt = isoNow();
      saveJson(HR_KEY, hr);
      audit("employee_deleted", { employeeId: id });

      syncEmployeeCountsToERP(hr);
      renderEmployeesTable();
      if (preview.mode === "branch") viewBranch();
      if (preview.mode === "all") viewAll();
      reportApi?.refreshIfGenerated?.();
    };

    const renderPayrollPreview = (rows, label) => {
      if (!payrollTbody) return;
      const erp = loadJson(ERP_KEY, null);
      const bMap = branchNameById(erp);

      payrollTbody.textContent = "";
      const list = Array.isArray(rows) ? rows : [];
      for (const emp of list) {
        const tr = document.createElement("tr");
        tr.innerHTML =
          `<td></td><td></td><td></td><td></td>` +
          `<td class="num"></td>` +
          `<td></td>` +
          `<td class="num"></td>` +
          `<td></td>` +
          `<td class="num"></td>`;

        tr.children[0].textContent = bMap.get(String(emp.branchId)) || emp.branchId || "—";
        tr.children[1].textContent = emp.name || "—";
        tr.children[2].textContent = emp.phone || "—";
        tr.children[3].textContent = emp.role || "—";
        tr.children[4].textContent = formatInt(emp.salary || 0);

        const debtTypeInput = document.createElement("input");
        debtTypeInput.type = "text";
        debtTypeInput.value = String(emp.debtType || "");
        debtTypeInput.placeholder = "e.g. Loan";
        debtTypeInput.dataset.empId = String(emp.id || "");
        debtTypeInput.dataset.field = "debtType";
        tr.children[5].appendChild(debtTypeInput);

        const debtAmtInput = document.createElement("input");
        debtAmtInput.type = "number";
        debtAmtInput.min = "0";
        debtAmtInput.step = "1";
        debtAmtInput.value = String(toMoney(emp.debtAmount, 0));
        debtAmtInput.dataset.empId = String(emp.id || "");
        debtAmtInput.dataset.field = "debtAmount";
        tr.children[6].appendChild(debtAmtInput);

        tr.children[7].textContent = emp.debtAt ? new Date(emp.debtAt).toLocaleString() : "—";

        const payAmtInput = document.createElement("input");
        payAmtInput.type = "number";
        payAmtInput.min = "0";
        payAmtInput.step = "1";
        payAmtInput.value = String(toMoney(emp.payAmount, toMoney(emp.salary, 0)));
        payAmtInput.dataset.empId = String(emp.id || "");
        payAmtInput.dataset.field = "payAmount";
        tr.children[8].appendChild(payAmtInput);

        payrollTbody.appendChild(tr);
      }

      setPayrollStatus(`${label} • ${list.length} employee(s)`);
    };

    const viewBranch = () => {
      hr = ensureHR();
      hr = loadJson(HR_KEY, hr);
      const erp = loadJson(ERP_KEY, null);
      const b = findBranchByQuery(erp, branchQuery?.value);
      const branches = Array.isArray(erp?.branches) ? erp.branches : [];
      if (!branches.length) {
        preview = { mode: "none", branchId: "", branchName: "" };
        showPayrollEmpty("There is no branch registered yet.");
        return;
      }
      if (!String(branchQuery?.value || "").trim()) {
        preview = { mode: "none", branchId: "", branchName: "" };
        showPayrollEmpty("Enter a branch name or ID first.");
        branchQuery?.focus?.();
        return;
      }
      if (!b) {
        preview = { mode: "none", branchId: "", branchName: "" };
        showPayrollEmpty("Branch not found. Try Branch 01, b01, or the exact branch name.");
        return;
      }
      preview = { mode: "branch", branchId: String(b.id), branchName: String(b.name || b.id) };
      const list = (hr.employees || []).filter((e) => e.status === "active" && String(e.branchId) === String(b.id));
      if (!list.length) {
        showPayrollEmpty(`Branch: ${preview.branchName} • no active employees found.`);
        return;
      }
      renderPayrollPreview(list, `Branch: ${preview.branchName}`);
    };

    const viewAll = () => {
      hr = ensureHR();
      hr = loadJson(HR_KEY, hr);
      preview = { mode: "all", branchId: "", branchName: "" };
      const list = (hr.employees || []).filter((e) => e.status === "active");
      if (!list.length) {
        showPayrollEmpty("No active employees found.");
        return;
      }
      renderPayrollPreview(list, "All employees");
    };

    const forwardEmployees = (list, scopeLabel) => {
      const now = isoNow();
      hr = ensureHR();
      hr = loadJson(HR_KEY, hr);
      const erp = loadJson(ERP_KEY, null);
      const bMap = branchNameById(erp);

      const employees = Array.isArray(list) ? list : [];
      if (!employees.length) {
        setPayrollStatus(`Nothing to forward (${scopeLabel}).`);
        return;
      }

      const forwardIds = new Set(employees.map((e) => String(e.id)));

      hr.employees = Array.isArray(hr.employees) ? hr.employees : [];
      for (const e of hr.employees) {
        if (!forwardIds.has(String(e.id))) continue;
        e.forwardedToFinance = true;
        e.financeReview = "pending";
        e.financeReviewAt = "";
        e.financeReviewBy = "";
      }

      hr.payrollQueue = Array.isArray(hr.payrollQueue) ? hr.payrollQueue : [];
      hr.payrollQueue = hr.payrollQueue.filter((item) => {
        if (!item || typeof item !== "object") return false;
        const id = String(item.employeeId || "");
        if (!forwardIds.has(id)) return true;
        return Boolean(item.paid);
      });

      const batchId = `batch-${crypto.getRandomValues(new Uint32Array(1))[0]}`;
      for (const emp of employees) {
        const branchName = bMap.get(String(emp.branchId)) || emp.branchId || "—";
        hr.payrollQueue.push({
          id: `${batchId}::${emp.id}`,
          employeeId: String(emp.id || ""),
          name: String(emp.name || ""),
          phone: String(emp.phone || ""),
          role: String(emp.role || ""),
          branchId: String(emp.branchId || ""),
          branchName,
          salary: toMoney(emp.salary, 0),
          payAmount: toMoney(emp.payAmount, toMoney(emp.salary, 0)),
          debtType: String(emp.debtType || ""),
          debtAmount: toMoney(emp.debtAmount, 0),
          debtAt: emp.debtAmount > 0 ? String(emp.debtAt || now) : "",
          at: now,
          financeReview: "pending",
          financeReviewAt: "",
          financeReviewBy: "",
          paid: false,
          paidAt: "",
        });
      }

      hr.updatedAt = now;
      saveJson(HR_KEY, hr);
      audit("payroll_forwarded", { scope: scopeLabel, count: employees.length });
      notify(
        "Forwarded to Finance",
        `${scopeLabel} • Employee details forwarded to Finance successfully (${employees.length}).`,
        { audienceRoles: ["finance", "hr"], scope: scopeLabel, count: employees.length },
      );
      renderEmployeesTable();
      renderPayrollPreview(employees, `${scopeLabel} forwarded to Finance`);
      reportApi?.refreshIfGenerated?.();
    };

    const forwardBranch = () => {
      hr = ensureHR();
      hr = loadJson(HR_KEY, hr);
      const erp = loadJson(ERP_KEY, null);
      const b = findBranchByQuery(erp, branchQuery?.value);
      const branches = Array.isArray(erp?.branches) ? erp.branches : [];
      if (!branches.length) return showPayrollEmpty("There is no branch registered yet.");
      if (!String(branchQuery?.value || "").trim()) {
        branchQuery?.focus?.();
        return showPayrollEmpty("Enter a branch name or ID first.");
      }
      if (!b) return showPayrollEmpty("Branch not found. Try Branch 01, b01, or the exact branch name.");
      const list = (hr.employees || []).filter((e) => e.status === "active" && String(e.branchId) === String(b.id));
      if (!list.length) return showPayrollEmpty(`Branch: ${String(b.name || b.id)} • no active employees found.`);
      forwardEmployees(list, `Branch: ${String(b.name || b.id)}`);
    };

    const forwardAll = () => {
      hr = ensureHR();
      hr = loadJson(HR_KEY, hr);
      const list = (hr.employees || []).filter((e) => e.status === "active");
      forwardEmployees(list, "All employees");
    };

    const onPayrollEdit = (e) => {
      const target = e.target;
      if (!target || typeof target !== "object") return;
      const empId = target.dataset?.empId;
      const field = target.dataset?.field;
      if (!empId || !field) return;

      hr = ensureHR();
      hr = loadJson(HR_KEY, hr);
      hr.employees = Array.isArray(hr.employees) ? hr.employees : [];
      const emp = hr.employees.find((x) => String(x.id) === String(empId)) || null;
      if (!emp) return;

      if (field === "debtType") {
        emp.debtType = String(target.value || "").trim();
        if (!toMoney(emp.debtAmount, 0)) {
          emp.debtType = "";
          emp.debtAt = "";
        }
      }

      if (field === "debtAmount") {
        const amt = toMoney(target.value, 0);
        emp.debtAmount = amt;
        if (amt > 0 && !emp.debtAt) emp.debtAt = isoNow();
        if (!amt) {
          emp.debtType = "";
          emp.debtAt = "";
        }
      }

      if (field === "payAmount") {
        emp.payAmount = toMoney(target.value, toMoney(emp.salary, 0));
      }

      hr.updatedAt = isoNow();
      saveJson(HR_KEY, hr);
      audit("employee_payroll_edited", { employeeId: String(empId), field: String(field) });
      renderEmployeesTable();
      if (preview.mode === "branch") viewBranch();
      if (preview.mode === "all") viewAll();
      reportApi?.refreshIfGenerated?.();
    };

    const togglePayrollPanel = () => {
      if (!payrollPanel || !payrollToggle) return;
      payrollPanel.classList.toggle("collapsed");
      const expanded = !payrollPanel.classList.contains("collapsed");
      payrollToggle.textContent = expanded ? "Hide" : "Show";
      payrollToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      if (!expanded) {
        preview = { mode: "none", branchId: "", branchName: "" };
        if (payrollTbody) payrollTbody.textContent = "";
        setPayrollStatus("");
      }
    };

    const toggleEmployeesPanel = () => {
      if (!employeesPanel || !employeesToggle) return;
      employeesPanel.classList.toggle("collapsed");
      const expanded = !employeesPanel.classList.contains("collapsed");
      employeesToggle.textContent = expanded ? "Hide" : "Show";
      employeesToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    };

    if (addBtn) addBtn.addEventListener("click", safe("hr_add_employee", () => addEmployee()));
    if (tbody) {
      tbody.addEventListener("click", safe("hr_employee_table_click", (e) => {
        const btn = e.target?.closest?.("button[data-emp-id]");
        if (!btn) return;
        deleteEmployee(btn.dataset.empId);
      }));
    }
    if (employeesToggle) employeesToggle.addEventListener("click", safe("hr_toggle_employees_panel", () => toggleEmployeesPanel()));
    if (payrollToggle) payrollToggle.addEventListener("click", safe("hr_toggle_payroll_panel", () => togglePayrollPanel()));
    if (viewBranchBtn) viewBranchBtn.addEventListener("click", safe("hr_view_branch", () => viewBranch()));
    if (viewAllBtn) viewAllBtn.addEventListener("click", safe("hr_view_all", () => viewAll()));
    if (forwardBranchBtn) forwardBranchBtn.addEventListener("click", safe("hr_forward_branch", () => forwardBranch()));
    if (forwardAllBtn) forwardAllBtn.addEventListener("click", safe("hr_forward_all", () => forwardAll()));
    if (payrollTbody) payrollTbody.addEventListener("change", safe("hr_payroll_edit", (e) => onPayrollEdit(e)));

    // Convenience: Enter in branch query loads branch list.
    if (branchQuery) {
      branchQuery.addEventListener("keydown", safe("hr_branch_query_enter", (e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        viewBranch();
      }));
    }

    const inReportRange = (value, range) => {
      if (!range || range.key === "all") return true;
      const ms = new Date(value).getTime();
      return Number.isFinite(ms) && ms >= range.startMs && ms <= range.endMs;
    };

    const buildHRReportHtml = ({ dueDate, range }) => {
      let hrData = ensureHR();
      hrData = loadJson(HR_KEY, hrData);
      const erp = loadJson(ERP_KEY, null);
      const bMap = branchNameById(erp);

      syncEmployeeCountsToERP(hrData, erp);

      const employees = Array.isArray(hrData.employees) ? hrData.employees : [];
      const active = employees.filter((e) => String(e.status || "active") === "active");

      let salaryTotal = 0;
      let debtTotal = 0;
      let forwarded = 0;
      for (const e of active) {
        salaryTotal += toMoney(e.salary, 0);
        debtTotal += toMoney(e.debtAmount, 0);
        if (e.forwardedToFinance) forwarded += 1;
      }

      const queue = Array.isArray(hrData.payrollQueue) ? hrData.payrollQueue : [];
      const pendingQueue = queue.filter((x) => !x?.paid && inReportRange(x.at || x.debtAt || x.paidAt, range));
      let pendingQueueTotal = 0;
      for (const item of pendingQueue) pendingQueueTotal += toMoney(item?.payAmount ?? item?.amount, 0);

      const byBranch = new Map();
      for (const e of active) {
        const bId = String(e.branchId || "");
        const key = bId || "—";
        const row = byBranch.get(key) || {
          branchId: bId,
          branchName: bMap.get(bId) || bId || "—",
          count: 0,
          salary: 0,
          debt: 0,
        };
        row.count += 1;
        row.salary += toMoney(e.salary, 0);
        row.debt += toMoney(e.debtAmount, 0);
        byBranch.set(key, row);
      }

      const branchRows = Array.from(byBranch.values()).sort((a, z) =>
        String(a.branchName).localeCompare(String(z.branchName)),
      );

      const branchTableRowsHtml = branchRows
        .map(
          (r) => `
          <tr>
            <td>${escapeHtml(r.branchName)}</td>
            <td class="num">${formatInt(r.count)}</td>
            <td class="num">${formatInt(r.salary)}</td>
            <td class="num">${formatInt(r.debt)}</td>
          </tr>`,
        )
        .join("");

      const recentRowsHtml = active
        .slice()
        .filter((e) => inReportRange(e.createdAt || e.updatedAt || e.debtAt, range))
        .reverse()
        .map(
          (e) => `
          <tr>
            <td>${escapeHtml(bMap.get(String(e.branchId)) || e.branchId || "—")}</td>
            <td>${escapeHtml(e.name || "—")}</td>
            <td>${escapeHtml(e.phone || "—")}</td>
            <td>${escapeHtml(e.role || "—")}</td>
            <td>${escapeHtml(e.department || "—")}</td>
            <td class="num">${formatInt(toMoney(e.salary, 0))}</td>
            <td class="num">${formatInt(toMoney(e.debtAmount, 0))}</td>
            <td>${e.forwardedToFinance ? "Forwarded" : "Pending"}</td>
            <td>—</td>
          </tr>`,
        )
        .join("");

      const now = new Date().toLocaleString();
      const due = String(dueDate || "").trim();
      const dueLine = due ? `<p><strong>Due date:</strong> ${escapeHtml(due)}</p>` : "";
      const periodLine = `<p><strong>Period:</strong> ${escapeHtml(range?.label || "All time")}</p>`;

      return `
        <h3>HR Department Report</h3>
        <p><strong>Generated:</strong> ${escapeHtml(now)}</p>
        ${periodLine}
        ${dueLine}
        <div class="report-grid">
          <div class="report-card">
            <div class="label">Active employees</div>
            <div class="value">${formatInt(active.length)}</div>
          </div>
          <div class="report-card">
            <div class="label">Forwarded to Finance</div>
            <div class="value">${formatInt(forwarded)}</div>
          </div>
          <div class="report-card">
            <div class="label">Total salary (KES)</div>
            <div class="value">${formatInt(salaryTotal)}</div>
          </div>
          <div class="report-card">
            <div class="label">Total debt (KES)</div>
            <div class="value">${formatInt(debtTotal)}</div>
          </div>
          <div class="report-card">
            <div class="label">Payroll queue pending (KES)</div>
            <div class="value">${formatInt(pendingQueueTotal)}</div>
          </div>
        </div>

        <details class="report-details" open style="margin-top: 14px;">
          <summary class="report-summary">
            <span>Employees by Branch</span>
            <span class="btn">Show / Hide</span>
          </summary>
          <table class="table" aria-label="Employees by branch report" style="margin-top: 10px;">
            <thead>
              <tr>
                <th>Branch</th>
                <th class="num">Employees</th>
                <th class="num">Salary total</th>
                <th class="num">Debt total</th>
              </tr>
            </thead>
            <tbody>
              ${branchTableRowsHtml || `<tr><td colspan="4">No employees found.</td></tr>`}
            </tbody>
          </table>
        </details>

        <details class="report-details" open style="margin-top: 12px;">
          <summary class="report-summary">
            <span>Recent Employees</span>
            <span class="btn">Show / Hide</span>
          </summary>
          <table class="table" aria-label="Employees list report" style="margin-top: 10px;">
            <thead>
              <tr>
                <th>Branch</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Role</th>
                <th>Department</th>
                <th class="num">Salary</th>
                <th class="num">Debt</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${recentRowsHtml || `<tr><td colspan="9">No employees found.</td></tr>`}
            </tbody>
          </table>
        </details>
      `;
    };

    const reportApi = initDeptReportCenter({
      title: "HR Department Report",
      filenameBase: "jixels-hr-report",
      buildHtml: buildHRReportHtml,
    });

    renderEmployeesTable();
    const store = getStore();
    if (store?.subscribe) {
      store.subscribe(
        safe("hr_store", (ev) => {
          if (!ev || ev.type !== "set") return;
          if (ev.key !== HR_KEY && ev.key !== ERP_KEY) return;
          renderEmployeesTable();
          if (preview.mode === "branch") viewBranch();
          if (preview.mode === "all") viewAll();
        }),
      );
    } else {
      window.addEventListener(
        "storage",
        safe("hr_storage", (e) => {
          if (e.key !== HR_KEY && e.key !== ERP_KEY) return;
          renderEmployeesTable();
          if (preview.mode === "branch") viewBranch();
          if (preview.mode === "all") viewAll();
        }),
      );
    }
  };

  const initFinancePage = () => {
    const s = requireRole("finance");
    if (!s) return;
    initLogout();
    ensureERP();
    ensureHR();

    const kpiMpesa = $("#fin-kpi-mpesa");
    const kpiBank = $("#fin-kpi-bank");
    const kpiTx = $("#fin-kpi-tx");
    const branchesTbody = $("#fin-branches-tbody");
    const branchesToggle = $("#fin-branches-toggle");
    const branchesPanel = $("#fin-branches-panel");
    const payrollTbody = $("#fin-payroll-tbody");
    const payrollTotal = $("#fin-payroll-total");
    const payrollToggle = $("#fin-payroll-toggle");
    const payrollPanel = $("#fin-payroll-panel");
    const payAllBtn = $("#fin-payroll-payall");

    const toMoney = (value, fallback = 0) => {
      const num = Number(value);
      if (!Number.isFinite(num)) return fallback;
      return Math.max(0, num);
    };

    const branchNameById = (erp) => {
      const map = new Map();
      for (const b of erp?.branches || []) map.set(String(b.id), String(b.name || b.id));
      return map;
    };

    const setBranchesExpanded = (expanded) => {
      if (!branchesPanel || !branchesToggle) return;
      if (expanded) branchesPanel.removeAttribute("hidden");
      else branchesPanel.setAttribute("hidden", "");
      branchesToggle.textContent = expanded ? "Hide" : "Show";
      branchesToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    };

    const toggleBranches = () => {
      if (!branchesPanel) return;
      setBranchesExpanded(branchesPanel.hasAttribute("hidden"));
    };

    const setPayrollExpanded = (expanded) => {
      if (!payrollPanel || !payrollToggle) return;
      if (expanded) payrollPanel.removeAttribute("hidden");
      else payrollPanel.setAttribute("hidden", "");
      payrollToggle.textContent = expanded ? "Hide" : "Show";
      payrollToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
    };

    const togglePayroll = () => {
      if (!payrollPanel) return;
      setPayrollExpanded(payrollPanel.hasAttribute("hidden"));
    };

    const setFinanceReview = (payId, nextStatus) => {
      const next = String(nextStatus || "").trim().toLowerCase();
      if (next !== "accepted" && next !== "rejected") return;

      let hr = ensureHR();
      hr = loadJson(HR_KEY, hr);
      hr.payrollQueue = Array.isArray(hr.payrollQueue) ? hr.payrollQueue : [];
      hr.employees = Array.isArray(hr.employees) ? hr.employees : [];

      const item = hr.payrollQueue.find((x) => String(x.id) === String(payId)) || null;
      if (!item) return;

      if (item.paid && next === "rejected") {
        toast("Not allowed", "Paid items cannot be rejected.");
        return;
      }

      const prev = String(item.financeReview || "pending").toLowerCase();
      if (prev === next) return;

      const at = isoNow();
      item.financeReview = next;
      item.financeReviewAt = at;
      item.financeReviewBy = String(s?.username || "");

      const emp = hr.employees.find((e) => String(e.id) === String(item.employeeId || "")) || null;
      if (emp) {
        emp.forwardedToFinance = true;
        emp.financeReview = next;
        emp.financeReviewAt = at;
        emp.financeReviewBy = String(s?.username || "");
      }

      hr.updatedAt = at;
      saveJson(HR_KEY, hr);
      audit("payroll_item_reviewed", { id: String(item.id || ""), employeeId: String(item.employeeId || ""), status: next });

      notify(
        "Finance Review",
        `${String(item.name || item.employeeId || "Employee")} ${next === "accepted" ? "accepted" : "rejected"} by Finance.`,
        { audienceRoles: ["finance", "hr"], employeeId: String(item.employeeId || ""), id: String(item.id || ""), status: next },
      );
      render();
    };

    const togglePaid = (payId) => {
      let hr = ensureHR();
      hr = loadJson(HR_KEY, hr);
      hr.payrollQueue = Array.isArray(hr.payrollQueue) ? hr.payrollQueue : [];
      hr.employees = Array.isArray(hr.employees) ? hr.employees : [];

      const item = hr.payrollQueue.find((x) => String(x.id) === String(payId)) || null;
      if (!item) return;

      const review = String(item.financeReview || "pending").toLowerCase();
      if (!item.paid && review === "rejected") {
        toast("Cannot pay", "This payroll item is rejected. Accept it first.");
        return;
      }

      const at = isoNow();
      item.paid = !item.paid;
      item.paidAt = item.paid ? at : "";

      // Paying implies accepted.
      if (item.paid && review !== "accepted") {
        item.financeReview = "accepted";
        item.financeReviewAt = at;
        item.financeReviewBy = String(s?.username || "");
      }

      const emp = hr.employees.find((e) => String(e.id) === String(item.employeeId || "")) || null;
      if (emp && item.paid && String(item.financeReview || "").toLowerCase() === "accepted") {
        emp.forwardedToFinance = true;
        emp.financeReview = "accepted";
        emp.financeReviewAt = item.financeReviewAt || at;
        emp.financeReviewBy = String(item.financeReviewBy || s?.username || "");
      }

      hr.updatedAt = at;
      saveJson(HR_KEY, hr);
      audit("payroll_item_paid_toggled", { id: String(item.id || ""), employeeId: String(item.employeeId || ""), paid: item.paid });

      if (item.paid) {
        const amountKes = toMoney(item.payAmount ?? item.amount, 0);
        const sms = buildPaymentSms({ amountKes, paidAtIso: at });
        const queued = queueSms(String(item.phone || ""), sms, {
          kind: "payroll_payment",
          employeeId: String(item.employeeId || ""),
          payId: String(item.id || ""),
          amountKes,
        });
        if (!queued) audit("sms_skipped", { reason: "missing_phone_or_message", employeeId: String(item.employeeId || ""), payId: String(item.id || "") });

        notify(
          "Payment successful",
          `${String(item.name || item.employeeId || "Employee")} payment successful.`,
          { audienceRoles: ["finance"], employeeId: String(item.employeeId || ""), id: String(item.id || ""), amountKes },
        );
        notify(
          "HR Alert",
          `Payment was successful and approved by Finance for ${String(item.name || item.employeeId || "Employee")} (KES ${formatInt(amountKes)}).`,
          { audienceRoles: ["hr"], employeeId: String(item.employeeId || ""), id: String(item.id || ""), amountKes },
        );
      }

      render();
    };

    const payAllPending = () => {
      let hr = ensureHR();
      hr = loadJson(HR_KEY, hr);
      hr.payrollQueue = Array.isArray(hr.payrollQueue) ? hr.payrollQueue : [];
      hr.employees = Array.isArray(hr.employees) ? hr.employees : [];

      const queue = hr.payrollQueue;
      const toPay = queue.filter((x) => !x?.paid && String(x?.financeReview || "pending").toLowerCase() !== "rejected");
      if (!toPay.length) {
        toast("Nothing to pay", "No pending payroll items to pay.");
        return;
      }

      const confirmMsg = `Pay ${toPay.length} employee(s) now?`;
      if (!window.confirm(confirmMsg)) return;

      const at = isoNow();
      const by = String(s?.username || "");
      for (const item of toPay) {
        item.paid = true;
        item.paidAt = at;
        item.financeReview = "accepted";
        item.financeReviewAt = at;
        item.financeReviewBy = by;

        const emp = hr.employees.find((e) => String(e.id) === String(item.employeeId || "")) || null;
        if (emp) {
          emp.forwardedToFinance = true;
          emp.financeReview = "accepted";
          emp.financeReviewAt = at;
          emp.financeReviewBy = by;
        }
      }

      hr.updatedAt = at;
      saveJson(HR_KEY, hr);
      audit("payroll_paid_all", { count: toPay.length });

      for (const item of toPay) {
        const amountKes = toMoney(item.payAmount ?? item.amount, 0);
        const sms = buildPaymentSms({ amountKes, paidAtIso: at });
        const queued = queueSms(String(item.phone || ""), sms, {
          kind: "payroll_payment",
          employeeId: String(item.employeeId || ""),
          payId: String(item.id || ""),
          amountKes,
          batch: "pay_all",
        });
        if (!queued) audit("sms_skipped", { reason: "missing_phone_or_message", employeeId: String(item.employeeId || ""), payId: String(item.id || "") });
      }

      notify("Payment successful", `Payment successful for ${toPay.length} employee(s).`, { audienceRoles: ["finance"], count: toPay.length });
      notify("HR Alert", `Payment was successful and approved by Finance for ${toPay.length} employee(s).`, { audienceRoles: ["hr"], count: toPay.length });
      render();
    };

    const render = () => {
      const erp = loadJson(ERP_KEY, null);
      let hr = ensureHR();
      hr = loadJson(HR_KEY, hr);
      if (erp) {
        const totals = computeFinanceTotals(erp);
        if (kpiMpesa) kpiMpesa.textContent = `KES ${formatInt(totals.mpesa)}`;
        if (kpiBank) kpiBank.textContent = `KES ${formatInt(totals.bank)}`;
        if (kpiTx) kpiTx.textContent = formatInt(totals.tx);
      }

      if (branchesTbody && erp?.branches) {
        branchesTbody.textContent = "";
        const rows = (erp.branches || []).slice().sort((a, z) => String(a.name || "").localeCompare(String(z.name || "")));
        let totalMpesa = 0;
        let totalBank = 0;
        let totalTx = 0;
        for (const b of rows) {
          const fin = b.financeSummary || {};
          const mpesa = toMoney(fin.mpesaIn || 0, 0);
          const bank = toMoney(fin.bankIn || 0, 0);
          const tx = toMoney(fin.txCount || 0, 0);
          totalMpesa += mpesa;
          totalBank += bank;
          totalTx += tx;
          const tr = document.createElement("tr");
          tr.innerHTML = `<td></td><td class="num"></td><td class="num"></td><td class="num"></td><td></td>`;
          tr.children[0].textContent = b.name || b.id || "—";
          tr.children[1].textContent = formatInt(mpesa);
          tr.children[2].textContent = formatInt(bank);
          tr.children[3].textContent = formatInt(tx);
          tr.children[4].textContent = fin.lastTxAt ? new Date(fin.lastTxAt).toLocaleString() : "—";
          branchesTbody.appendChild(tr);
        }

        if (rows.length) {
          const tr = document.createElement("tr");
          tr.style.fontWeight = "800";
          tr.innerHTML = `<td></td><td class="num"></td><td class="num"></td><td class="num"></td><td></td>`;
          tr.children[0].textContent = "TOTAL";
          tr.children[1].textContent = formatInt(totalMpesa);
          tr.children[2].textContent = formatInt(totalBank);
          tr.children[3].textContent = formatInt(totalTx);
          tr.children[4].textContent = "—";
          branchesTbody.appendChild(tr);
        }
      }

      const queue = Array.isArray(hr?.payrollQueue) ? hr.payrollQueue : [];

      let pendingTotal = 0;
      for (const item of queue) {
        if (item?.paid) continue;
        const review = String(item?.financeReview || "pending").toLowerCase();
        if (review === "rejected") continue;
        pendingTotal += toMoney(item?.payAmount ?? item?.amount, 0);
      }
      if (payrollTotal) payrollTotal.textContent = `KES ${formatInt(pendingTotal)}`;

      if (!payrollTbody) return;
      payrollTbody.textContent = "";

      const employees = Array.isArray(hr?.employees) ? hr.employees : [];
      const empById = new Map(employees.map((e) => [String(e.id), e]));
      const bMap = branchNameById(erp);

      for (const item of queue.slice().reverse().slice(0, 80)) {
        const emp = empById.get(String(item.employeeId || "")) || null;

        const branchId = String(item.branchId || emp?.branchId || "");
        const branchName = String(item.branchName || bMap.get(branchId) || branchId || "—");
        const fullName = String(item.name || emp?.name || "—");
        const phone = String(item.phone || emp?.phone || "—");
        const role = String(item.role || emp?.role || "—");
        const salary = toMoney(item.salary ?? emp?.salary, 0);
        const payAmount = toMoney(item.payAmount ?? item.amount ?? emp?.payAmount, salary);
        const debtAmount = toMoney(item.debtAmount ?? emp?.debtAmount, 0);
        const debtType = String(item.debtType || emp?.debtType || "");
        const debtLabel = debtAmount > 0 ? `${debtType || "Debt"} • KES ${formatInt(debtAmount)}` : "—";
        const review = String(item.financeReview || "pending").toLowerCase();
        const isRejected = review === "rejected";

        const tr = document.createElement("tr");
        tr.innerHTML =
          `<td></td><td></td><td></td><td></td><td></td>` +
          `<td class="num"></td><td class="num"></td>` +
          `<td></td><td></td><td></td><td></td>`;

        tr.children[0].textContent = String(item.employeeId || "—");
        tr.children[1].textContent = branchName;
        tr.children[2].textContent = fullName;
        tr.children[3].textContent = phone;
        tr.children[4].textContent = role;
        tr.children[5].textContent = formatInt(salary);
        tr.children[6].textContent = formatInt(payAmount);
        tr.children[7].textContent = debtLabel;
        tr.children[8].textContent = item.at ? new Date(item.at).toLocaleString() : "—";

        const acceptBtn = document.createElement("button");
        acceptBtn.type = "button";
        acceptBtn.className = `btn${review === "accepted" ? " primary" : ""}`;
        acceptBtn.dataset.reviewId = String(item.id || "");
        acceptBtn.dataset.reviewAction = "accepted";
        acceptBtn.textContent = "Accept";

        const rejectBtn = document.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = `btn${review === "rejected" ? " danger" : ""}`;
        rejectBtn.dataset.reviewId = String(item.id || "");
        rejectBtn.dataset.reviewAction = "rejected";
        rejectBtn.textContent = "Reject";
        rejectBtn.disabled = Boolean(item.paid);

        const reviewTag = document.createElement("span");
        reviewTag.className = "muted";
        reviewTag.style.fontSize = "12px";
        reviewTag.textContent = review === "accepted" ? "Accepted" : isRejected ? "Rejected" : "Pending";

        const reviewWrap = document.createElement("div");
        reviewWrap.style.display = "flex";
        reviewWrap.style.alignItems = "center";
        reviewWrap.style.gap = "8px";
        reviewWrap.style.flexWrap = "wrap";
        reviewWrap.appendChild(acceptBtn);
        reviewWrap.appendChild(rejectBtn);
        reviewWrap.appendChild(reviewTag);
        tr.children[9].appendChild(reviewWrap);

        const statusBtn = document.createElement("button");
        statusBtn.type = "button";
        statusBtn.className = `btn${item.paid ? " primary" : ""}`;
        statusBtn.dataset.payId = String(item.id || "");
        statusBtn.textContent = item.paid ? "Paid" : "Pending";
        statusBtn.disabled = isRejected;
        if (isRejected) statusBtn.title = "Rejected — cannot pay";
        tr.children[10].appendChild(statusBtn);

        payrollTbody.appendChild(tr);
      }
    };

    const inReportRange = (value, range) => {
      if (!range || range.key === "all") return true;
      const ms = new Date(value).getTime();
      return Number.isFinite(ms) && ms >= range.startMs && ms <= range.endMs;
    };

    const buildFinanceReportHtml = ({ dueDate, range }) => {
      const erp = loadJson(ERP_KEY, null);
      let hr = ensureHR();
      hr = loadJson(HR_KEY, hr);

      const now = new Date().toLocaleString();
      const due = String(dueDate || "").trim();
      const dueLine = due ? `<p><strong>Due date:</strong> ${escapeHtml(due)}</p>` : "";
      const periodLine = `<p><strong>Period:</strong> ${escapeHtml(range?.label || "All time")}</p>`;

      const periodTotals = { mpesa: 0, bank: 0, tx: 0, creditCount: 0, creditBalance: 0 };
      for (const b of erp?.branches || []) {
        for (const tx of b.txLog || []) {
          if (!inReportRange(tx.at, range)) continue;
          const amount = toMoney(tx.amountPaid ?? tx.amount, 0);
          if (String(tx.channel || "").toLowerCase() === "bank") periodTotals.bank += amount;
          else periodTotals.mpesa += amount;
          periodTotals.tx += 1;
          if (String(tx.saleType || "").toLowerCase() === "credit") {
            periodTotals.creditCount += 1;
            periodTotals.creditBalance += toMoney(tx.balance, 0);
          }
        }
      }
      const totals = range?.key === "all" && erp ? computeFinanceTotals(erp) : periodTotals;
      const queue = Array.isArray(hr?.payrollQueue) ? hr.payrollQueue : [];
      const periodQueue = queue.filter((item) => inReportRange(item?.paidAt || item?.at || item?.debtAt, range));

      let pendingTotal = 0;
      let paidTotal = 0;
      let pendingCount = 0;
      let paidCount = 0;
      for (const item of periodQueue) {
        const amt = toMoney(item?.payAmount ?? item?.amount, 0);
        if (item?.paid) {
          paidTotal += amt;
          paidCount += 1;
        } else {
          pendingTotal += amt;
          pendingCount += 1;
        }
      }

      const totalMoney = totals.mpesa + totals.bank;

      const branchRowsHtml = (erp?.branches || [])
        .slice()
        .sort((a, z) => String(a.name || "").localeCompare(String(z.name || "")))
        .map((b) => {
          const fin = b.financeSummary || {};
          const rowTotals = { mpesa: 0, bank: 0, tx: 0, creditCount: 0, creditBalance: 0, last: "" };
          if (range?.key === "all") {
            for (const tx of b.txLog || []) {
              if (String(tx.saleType || "").toLowerCase() !== "credit") continue;
              rowTotals.creditCount += 1;
              rowTotals.creditBalance += toMoney(tx.balance, 0);
            }
          }
          if (range?.key !== "all") {
            for (const tx of b.txLog || []) {
              if (!inReportRange(tx.at, range)) continue;
              const amount = toMoney(tx.amountPaid ?? tx.amount, 0);
              if (String(tx.channel || "").toLowerCase() === "bank") rowTotals.bank += amount;
              else rowTotals.mpesa += amount;
              rowTotals.tx += 1;
              if (String(tx.saleType || "").toLowerCase() === "credit") {
                rowTotals.creditCount += 1;
                rowTotals.creditBalance += toMoney(tx.balance, 0);
              }
              if (!rowTotals.last || String(tx.at || "") > rowTotals.last) rowTotals.last = String(tx.at || "");
            }
          }
          const mpesa = range?.key === "all" ? toMoney(fin.mpesaIn || 0, 0) : rowTotals.mpesa;
          const bank = range?.key === "all" ? toMoney(fin.bankIn || 0, 0) : rowTotals.bank;
          const txCount = range?.key === "all" ? toMoney(fin.txCount || 0, 0) : rowTotals.tx;
          const creditCount = rowTotals.creditCount;
          const creditBalance = rowTotals.creditBalance;
          const lastTxAt = range?.key === "all" ? fin.lastTxAt : rowTotals.last;
          return `
            <tr>
              <td>${escapeHtml(b.name || b.id || "—")}</td>
              <td class="num">${formatInt(mpesa)}</td>
              <td class="num">${formatInt(bank)}</td>
              <td class="num">${formatInt(txCount)}</td>
              <td class="num">${formatInt(creditCount)}</td>
              <td class="num">${formatInt(creditBalance)}</td>
              <td>${lastTxAt ? escapeHtml(new Date(lastTxAt).toLocaleString()) : "—"}</td>
            </tr>`;
        })
        .join("");

      const branchTotalRowHtml = (erp?.branches || []).length
        ? `
            <tr style="font-weight: 800;">
              <td>Total</td>
              <td class="num">${formatInt(totals.mpesa)}</td>
              <td class="num">${formatInt(totals.bank)}</td>
              <td class="num">${formatInt(totals.tx)}</td>
              <td class="num">${formatInt(totals.creditCount || 0)}</td>
              <td class="num">${formatInt(totals.creditBalance || 0)}</td>
              <td>—</td>
            </tr>`
        : "";

      const payrollRowsHtml = periodQueue
        .slice()
        .reverse()
        .map((item) => {
          const branchName = String(item.branchName || item.branchId || "—");
          const amt = toMoney(item?.payAmount ?? item?.amount, 0);
          return `
            <tr>
              <td>${escapeHtml(item.employeeId || "—")}</td>
              <td>${escapeHtml(branchName)}</td>
              <td>${escapeHtml(item.name || "—")}</td>
              <td class="num">${formatInt(amt)}</td>
              <td>${item.paid ? "Paid" : "Pending"}</td>
              <td>${item.at ? escapeHtml(new Date(item.at).toLocaleString()) : "—"}</td>
            </tr>`;
        })
        .join("");

      return `
        <h3>Finance Department Report</h3>
        <p><strong>Generated:</strong> ${escapeHtml(now)}</p>
        ${periodLine}
        ${dueLine}

        <div class="report-grid">
          <div class="report-card">
            <div class="label">M-Pesa total (KES)</div>
            <div class="value">${formatInt(totals.mpesa)}</div>
          </div>
          <div class="report-card">
            <div class="label">Bank total (KES)</div>
            <div class="value">${formatInt(totals.bank)}</div>
          </div>
          <div class="report-card">
            <div class="label">Total money (KES)</div>
            <div class="value">${formatInt(totalMoney)}</div>
          </div>
          <div class="report-card">
            <div class="label">Transactions</div>
            <div class="value">${formatInt(totals.tx)}</div>
          </div>
          <div class="report-card">
            <div class="label">Credit phones</div>
            <div class="value">${formatInt(totals.creditCount || 0)}</div>
          </div>
          <div class="report-card">
            <div class="label">Credit balance (KES)</div>
            <div class="value">${formatInt(totals.creditBalance || 0)}</div>
          </div>
          <div class="report-card">
            <div class="label">Payroll pending (KES)</div>
            <div class="value">${formatInt(pendingTotal)}</div>
          </div>
          <div class="report-card">
            <div class="label">Payroll paid (KES)</div>
            <div class="value">${formatInt(paidTotal)}</div>
          </div>
          <div class="report-card">
            <div class="label">Queue (pending/paid)</div>
            <div class="value">${formatInt(pendingCount)}/${formatInt(paidCount)}</div>
          </div>
        </div>

        <details class="report-details" open style="margin-top: 14px;">
          <summary class="report-summary">
            <span>Branch Finance Summary</span>
            <span class="btn">Show / Hide</span>
          </summary>
          <table class="table" aria-label="Branch finance report" style="margin-top: 10px;">
            <thead>
              <tr>
                <th>Branch</th>
                <th class="num">M-Pesa</th>
                <th class="num">Bank</th>
                <th class="num">Tx</th>
                <th class="num">Credit phones</th>
                <th class="num">Credit balance</th>
                <th>Last tx</th>
              </tr>
            </thead>
            <tbody>
              ${branchRowsHtml || `<tr><td colspan="7">No branch data.</td></tr>`}
              ${branchTotalRowHtml}
            </tbody>
          </table>
        </details>

        <h3 style="margin-top: 14px;">Payroll Queue (${escapeHtml(range?.label || "All time")})</h3>
        <table class="table" aria-label="Payroll queue report">
          <thead>
            <tr>
              <th>Employee ID</th>
              <th>Branch</th>
              <th>Name</th>
              <th class="num">Pay (KES)</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            ${payrollRowsHtml || `<tr><td colspan="6">No payroll items.</td></tr>`}
          </tbody>
        </table>
      `;
    };

    setBranchesExpanded(false);
    setPayrollExpanded(false);

    initDeptReportCenter({
      title: "Finance Department Report",
      filenameBase: "jixels-finance-report",
      buildHtml: buildFinanceReportHtml,
    });

    if (branchesToggle) branchesToggle.addEventListener("click", safe("finance_toggle_branches_panel", () => toggleBranches()));
    if (payrollToggle) payrollToggle.addEventListener("click", safe("finance_toggle_payroll_panel", () => togglePayroll()));
    if (payAllBtn) payAllBtn.addEventListener("click", safe("finance_pay_all", () => payAllPending()));
    if (payrollTbody) {
      payrollTbody.addEventListener("click", safe("finance_payroll_table_click", (e) => {
        const reviewBtn = e.target?.closest?.("button[data-review-id]");
        if (reviewBtn) {
          setFinanceReview(reviewBtn.dataset.reviewId, reviewBtn.dataset.reviewAction);
          return;
        }

        const payBtn = e.target?.closest?.("button[data-pay-id]");
        if (!payBtn) return;
        togglePaid(payBtn.dataset.payId);
      }));
    }

    render();
    const store = getStore();
    if (store?.subscribe) {
      store.subscribe(
        safe("finance_store", (ev) => {
          if (!ev || ev.type !== "set") return;
          if (ev.key === HR_KEY || ev.key === ERP_KEY) render();
        }),
      );
    } else {
      window.addEventListener(
        "storage",
        safe("finance_storage", (e) => {
          if (e.key === HR_KEY || e.key === ERP_KEY) render();
        }),
      );
    }
  };

  const initOpsOrSalesPage = (role) => {
    const s = requireRole(role);
    if (!s) return;
    initLogout();
    ensureERP();

    const stockOut = $("#dept-stock");
    const soldOut = $("#dept-sold");
    const updatedOut = $("#dept-updated");
    const branchSearch = $("#dept-branch-search");
    const branchesTbody = $("#dept-branches-tbody");

    const roleLabel = String(role || "").trim() ? String(role).toUpperCase() : "DEPARTMENT";

    const renderBranches = (erp) => {
      if (!branchesTbody || !erp?.branches) return;
      const q = String(branchSearch?.value || "").trim().toLowerCase();
      const rows = (erp.branches || [])
        .slice()
        .sort((a, z) => String(a.name || "").localeCompare(String(z.name || "")))
        .filter((b) => {
          if (!q) return true;
          const name = String(b.name || "").toLowerCase();
          const id = String(b.id || "").toLowerCase();
          return name.includes(q) || id.includes(q);
        });

      branchesTbody.textContent = "";
      let aggStock = 0;
      let aggSold = 0;
      for (const b of rows) {
        const totals = computeBranchInventoryTotals(b);
        aggStock += totals.stock;
        aggSold += totals.sold;
        const tr = document.createElement("tr");
        tr.innerHTML =
          `<td></td>` +
          `<td class="num"></td>` +
          `<td class="num"></td>` +
          `<td class="num"></td>` +
          `<td class="num"></td>` +
          `<td class="num"></td>` +
          `<td></td>`;
        tr.children[0].textContent = b.name || b.id || "—";
        tr.children[1].textContent = formatInt(totals.models);
        tr.children[2].textContent = formatInt(totals.stock);
        tr.children[3].textContent = formatInt(totals.sold);
        tr.children[4].textContent = formatInt(totals.damaged);
        tr.children[5].textContent = formatInt(totals.lost);
        tr.children[6].textContent = totals.topModel || "—";
        branchesTbody.appendChild(tr);
      }

      return { stock: aggStock, sold: aggSold };
    };

    const render = () => {
      const erp = loadJson(ERP_KEY, null);
      if (!erp) return;
      const totals = renderBranches(erp) || { stock: 0, sold: 0 };
      if (stockOut) stockOut.textContent = formatInt(totals.stock);
      if (soldOut) soldOut.textContent = formatInt(totals.sold);
      if (updatedOut) updatedOut.textContent = erp.lastUpdated ? new Date(erp.lastUpdated).toLocaleString() : "—";
    };

    const inReportRange = (value, range) => {
      if (!range || range.key === "all") return true;
      const ms = new Date(value).getTime();
      return Number.isFinite(ms) && ms >= range.startMs && ms <= range.endMs;
    };

    const buildOpsSalesReportHtml = ({ dueDate, range }) => {
      const erp = loadJson(ERP_KEY, null);
      const now = new Date().toLocaleString();
      const due = String(dueDate || "").trim();
      const dueLine = due ? `<p><strong>Due date:</strong> ${escapeHtml(due)}</p>` : "";
      const periodLine = `<p><strong>Period:</strong> ${escapeHtml(range?.label || "All time")}</p>`;

      if (!erp || !Array.isArray(erp.branches)) {
        return `<h3>${escapeHtml(roleLabel)} Report</h3><p>No ERP data.</p>`;
      }

      let totalStock = 0;
      let totalSold = 0;
      let periodSold = 0;
      let periodRevenue = 0;
      let periodCreditCount = 0;
      let periodCreditBalance = 0;
      let totalDamaged = 0;
      let totalLost = 0;

      const rows = (erp.branches || []).slice().sort((a, z) => String(a.name || "").localeCompare(String(z.name || "")));
      const tableRowsHtml = rows
        .map((b) => {
          const t = computeBranchInventoryTotals(b);
          totalStock += t.stock;
          totalSold += t.sold;
          let branchPeriodSold = 0;
          let branchPeriodRevenue = 0;
          let branchCreditCount = 0;
          let branchCreditBalance = 0;
          for (const p of b.soldPhones || []) {
            if (!inReportRange(p.soldAt, range)) continue;
            branchPeriodSold += 1;
            if (!Array.isArray(b.txLog) || !b.txLog.length) {
              branchPeriodRevenue += toMoney(p.soldPaid ?? p.soldAmount ?? p.price, 0);
            }
            if ((!Array.isArray(b.txLog) || !b.txLog.length) && String(p.saleType || "").toLowerCase() === "credit") {
              branchCreditCount += 1;
              branchCreditBalance += toMoney(p.creditBalance, 0);
            }
          }
          for (const tx of b.txLog || []) {
            if (!inReportRange(tx.at, range)) continue;
            branchPeriodRevenue += toMoney(tx.amountPaid ?? tx.amount, 0);
            if (String(tx.saleType || "").toLowerCase() === "credit") {
              branchCreditCount += 1;
              branchCreditBalance += toMoney(tx.balance, 0);
            }
          }
          periodSold += branchPeriodSold;
          periodRevenue += branchPeriodRevenue;
          periodCreditCount += branchCreditCount;
          periodCreditBalance += branchCreditBalance;
          totalDamaged += t.damaged;
          totalLost += t.lost;
          return `
            <tr>
              <td>${escapeHtml(b.name || b.id || "—")}</td>
              <td class="num">${formatInt(t.models)}</td>
              <td class="num">${formatInt(t.stock)}</td>
              <td class="num">${formatInt(t.sold)}</td>
              <td class="num">${formatInt(branchPeriodSold)}</td>
              <td class="num">${formatInt(branchCreditCount)}</td>
              <td class="num">${formatInt(branchCreditBalance)}</td>
              <td class="num">${formatInt(t.damaged)}</td>
              <td class="num">${formatInt(t.lost)}</td>
              <td>${escapeHtml(t.topModel || "—")}</td>
            </tr>`;
        })
        .join("");

      return `
        <h3>${escapeHtml(roleLabel)} Department Report</h3>
        <p><strong>Generated:</strong> ${escapeHtml(now)}</p>
        ${periodLine}
        ${dueLine}

        <div class="report-grid">
          <div class="report-card">
            <div class="label">Total stock</div>
            <div class="value">${formatInt(totalStock)}</div>
          </div>
          <div class="report-card">
            <div class="label">Total sold</div>
            <div class="value">${formatInt(totalSold)}</div>
          </div>
          <div class="report-card">
            <div class="label">Sold in period</div>
            <div class="value">${formatInt(periodSold)}</div>
          </div>
          <div class="report-card">
            <div class="label">Period revenue (KES)</div>
            <div class="value">${formatInt(periodRevenue)}</div>
          </div>
          <div class="report-card">
            <div class="label">Credit phones</div>
            <div class="value">${formatInt(periodCreditCount)}</div>
          </div>
          <div class="report-card">
            <div class="label">Credit balance (KES)</div>
            <div class="value">${formatInt(periodCreditBalance)}</div>
          </div>
          <div class="report-card">
            <div class="label">Damaged / Lost</div>
            <div class="value">${formatInt(totalDamaged)}/${formatInt(totalLost)}</div>
          </div>
        </div>

        <h3 style="margin-top: 14px;">Inventory by Branch</h3>
        <table class="table" aria-label="Inventory by branch report">
          <thead>
            <tr>
              <th>Branch</th>
              <th class="num">Models</th>
              <th class="num">In stock</th>
              <th class="num">Sold</th>
              <th class="num">Period sold</th>
              <th class="num">Credit phones</th>
              <th class="num">Credit balance</th>
              <th class="num">Damaged</th>
              <th class="num">Lost</th>
              <th>Top model</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml || `<tr><td colspan="10">No branches found.</td></tr>`}
          </tbody>
        </table>
      `;
    };

    initDeptReportCenter({
      title: `${roleLabel} Department Report`,
      filenameBase: `jixels-${normalizeRole(role)}-report`,
      buildHtml: buildOpsSalesReportHtml,
    });

    if (branchSearch) branchSearch.addEventListener("input", safe("dept_branch_search", () => render()));

    render();
    const store = getStore();
    if (store?.subscribe) {
      store.subscribe(
        safe("dept_store", (ev) => {
          if (!ev || ev.type !== "set" || ev.key !== ERP_KEY) return;
          render();
        }),
      );
    } else {
      window.addEventListener(
        "storage",
        safe("dept_storage", (e) => {
          if (e.key !== ERP_KEY) return;
          render();
        }),
      );
    }
  };

  const initAdminPage = () => {
    const s = requireRole("admin");
    if (!s) return;
    initLogout();
    let erp = ensureERP();

    const branchSelect = $("#admin-branch");
    const model = $("#admin-model");
    const color = $("#admin-color");
    const storage = $("#admin-storage");
    const serial = $("#admin-serial");
    const price = $("#admin-price");
    const addBtn = $("#admin-add-phone");
    const tbody = $("#admin-inv-tbody");
    const accountsTbody = $("#admin-accounts-tbody");
    const refreshAccountsBtn = $("#admin-refresh-accounts");
    const exportDataBtn = $("#admin-export-data");
    const deleteDataBtn = $("#admin-delete-data");

    const render = () => {
      erp = loadJson(ERP_KEY, erp);
      if (branchSelect) {
        const branches = Array.isArray(erp.branches) ? erp.branches : [];
        branchSelect.innerHTML = branches.length
          ? branches.map((b) => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name || b.id)}</option>`).join("")
          : `<option value="">No branches registered</option>`;
      }
      const bId = String(branchSelect?.value || erp.branches?.[0]?.id || "");
      const branch = (erp.branches || []).find((b) => b.id === bId) || null;
      if (!branch || !tbody) return;

      tbody.textContent = "";
      for (const p of (branch.phones || []).slice().sort((a, z) => String(a.serial).localeCompare(String(z.serial)))) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td></td><td></td><td></td><td></td><td class="num"></td>`;
        tr.children[0].textContent = p.serial || "—";
        tr.children[1].textContent = p.model || "—";
        tr.children[2].textContent = p.color || "—";
        tr.children[3].textContent = p.storage || "—";
        tr.children[4].textContent = formatInt(p.price || 0);
        tbody.appendChild(tr);
      }
    };

    const addPhone = () => {
      erp = loadJson(ERP_KEY, erp);
      const bId = String(branchSelect?.value || "").trim();
      const branch = (erp.branches || []).find((b) => b.id === bId) || null;
      if (!branch) {
        toast("No branch selected", "Create or approve a branch before adding phones.");
        return;
      }

      const m = String(model?.value || "").trim();
      const c = String(color?.value || "").trim();
      const s = String(storage?.value || "").trim();
      const sn = String(serial?.value || "").trim();
      const pr = Math.max(0, Number(price?.value || 0));

      if (!m) {
        toast("Missing phone data", "Model is required.");
        return model?.focus?.();
      }
      if (!c) {
        toast("Missing phone data", "Color is required.");
        return color?.focus?.();
      }
      if (!s) {
        toast("Missing phone data", "Storage is required.");
        return storage?.focus?.();
      }
      if (!sn) {
        toast("Missing phone data", "Serial number is required.");
        return serial?.focus?.();
      }
      if (!Number.isFinite(pr) || pr <= 0) {
        toast("Missing phone data", "Enter a valid price greater than zero.");
        return price?.focus?.();
      }

      branch.phones = Array.isArray(branch.phones) ? branch.phones : [];
      branch.soldPhones = Array.isArray(branch.soldPhones) ? branch.soldPhones : [];

      const exists =
        branch.phones.some((p) => String(p.serial || "").toLowerCase() === sn.toLowerCase()) ||
        branch.soldPhones.some((p) => String(p.serial || "").toLowerCase() === sn.toLowerCase());
      if (exists) {
        toast("Duplicate serial", "This phone serial already exists or was already sold.");
        return serial?.focus?.();
      }

      branch.phones.push({
        serial: sn,
        model: m,
        color: c,
        storage: s,
        price: pr,
        status: "in_stock",
        createdAt: isoNow(),
      });

      rebuildInventoryFromPhones(branch);
      audit("admin_phone_added", { branchId: bId, serial: sn, model: m, price: pr });

      branch.updatedAt = isoNow();
      erp.lastUpdated = isoNow();
      saveJson(ERP_KEY, erp);

      if (serial) serial.value = "";
      if (model) model.value = "";
      if (color) color.value = "";
      if (storage) storage.value = "";
      if (price) price.value = "";
      render();
    };

    const loadAccountRows = () => {
      const branchAccounts = loadJson(BRANCH_ACCOUNTS_KEY, []);
      const agentAccounts = loadJson(AGENT_ACCOUNTS_KEY, []);
      const deptAccounts = loadJson(ACCOUNTS_KEY, []);
      const director = loadJson(DIRECTOR_ACCOUNT_KEY, null);
      const seen = new Set();
      return [
        ...(Array.isArray(branchAccounts) ? branchAccounts : []).map((a) => ({ type: "branch", key: BRANCH_ACCOUNTS_KEY, account: a })),
        ...(Array.isArray(agentAccounts) ? agentAccounts : []).map((a) => ({ type: "agent", key: AGENT_ACCOUNTS_KEY, account: a })),
        ...(Array.isArray(deptAccounts) ? deptAccounts : []).map((a) => ({ type: "department", key: ACCOUNTS_KEY, account: a })),
        ...(director ? [{ type: "director", key: DIRECTOR_ACCOUNT_KEY, account: director }] : []),
      ].filter((row) => {
        const a = row.account || {};
        const id = String(a.id || "").trim();
        const username = String(a.username || a.name || "").trim().toLowerCase();
        const email = String(a.email || "").trim().toLowerCase();
        if (!id && !username && !email) return false;
        const dedupeKey = `${row.type}:${id || email || username}`;
        if (seen.has(dedupeKey)) return false;
        seen.add(dedupeKey);
        return true;
      });
    };

    const updateAccountStatus = async (key, accountId, status) => {
      if (key === DIRECTOR_ACCOUNT_KEY) return;
      const nextStatus = String(status || "").trim().toLowerCase();
      if (nextStatus !== "approved" && nextStatus !== "rejected") return;
      const list = loadJson(key, []);
      const rows = Array.isArray(list) ? list : [];
      const idx = rows.findIndex((a) => String(a.id || "") === String(accountId || ""));
      if (idx === -1) return;
      if (String(rows[idx].status || "").toLowerCase() === nextStatus) return;
      rows[idx] = { ...rows[idx], status: nextStatus, reviewedAt: isoNow(), reviewedBy: "admin" };
      saveJson(key, rows);

      if (key === BRANCH_ACCOUNTS_KEY) {
        erp = loadJson(ERP_KEY, erp);
        const branch = (erp.branches || []).find((b) => b.id === rows[idx].branchId);
        if (branch) {
          branch.registrationStatus = nextStatus;
          branch.updatedAt = isoNow();
          erp.lastUpdated = isoNow();
          saveJson(ERP_KEY, erp);
        }
      }
      audit("admin_account_status", { accountId, key, status: nextStatus });
      try {
        await getStore()?.flush?.();
      } catch {
        // IndexedDB already has the approval locally.
      }
      if (nextStatus === "approved") toast("Account approved", "The user can log in now.");
      if (nextStatus === "rejected") toast("Account rejected", "The user cannot log in until approved.");
      renderAccounts();
      render();
    };

    const deleteAccount = (key, accountId) => {
      if (key === DIRECTOR_ACCOUNT_KEY) {
        if (!confirm("Delete the director account?")) return;
        saveJson(DIRECTOR_ACCOUNT_KEY, null);
        audit("admin_director_deleted", { accountId });
        renderAccounts();
        return;
      }
      if (!confirm("Delete this user account?")) return;
      const list = loadJson(key, []);
      const rows = Array.isArray(list) ? list : [];
      const next = rows.filter((a) => String(a.id || "") !== String(accountId || ""));
      saveJson(key, next);
      audit("admin_account_deleted", { accountId, key });
      renderAccounts();
    };

    const renderAccounts = () => {
      if (!accountsTbody) return;
      accountsTbody.textContent = "";
      const rows = loadAccountRows();
      if (!rows.length) {
        accountsTbody.innerHTML = `<tr><td colspan="7">No account registrations found.</td></tr>`;
        return;
      }
      for (const row of rows) {
        const a = row.account || {};
        const status = String(a.status || "approved").toLowerCase();
        const tr = document.createElement("tr");
        tr.innerHTML = `<td></td><td></td><td></td><td></td><td></td><td></td><td></td>`;
        tr.children[0].textContent = row.type;
        tr.children[1].textContent = a.username || a.name || "—";
        tr.children[2].textContent = a.email || "—";
        tr.children[3].textContent = a.branchId || a.department || "—";
        tr.children[4].textContent = status.charAt(0).toUpperCase() + status.slice(1);
        tr.children[5].textContent = a.createdAt ? new Date(a.createdAt).toLocaleString() : "—";

        const actions = document.createElement("div");
        actions.className = "report-buttons";
        actions.style.justifyContent = "flex-start";

        if (row.key !== DIRECTOR_ACCOUNT_KEY && status !== "approved") {
          const approve = document.createElement("button");
          approve.className = "btn primary";
          approve.type = "button";
          approve.textContent = "Approve";
          approve.addEventListener("click", () => updateAccountStatus(row.key, a.id, "approved"));
          actions.appendChild(approve);
        }

        if (row.key !== DIRECTOR_ACCOUNT_KEY && status !== "rejected") {
          const reject = document.createElement("button");
          reject.className = "btn";
          reject.type = "button";
          reject.textContent = "Reject";
          reject.addEventListener("click", () => updateAccountStatus(row.key, a.id, "rejected"));
          actions.appendChild(reject);
        }

        const del = document.createElement("button");
        del.className = "btn";
        del.type = "button";
        del.textContent = "Delete";
        del.addEventListener("click", () => deleteAccount(row.key, a.id));
        actions.appendChild(del);

        tr.children[6].appendChild(actions);
        accountsTbody.appendChild(tr);
      }
    };

    const exportAllData = async () => {
      const keys = [
        ERP_KEY,
        HR_KEY,
        ACCOUNTS_KEY,
        BRANCH_ACCOUNTS_KEY,
        AGENT_ACCOUNTS_KEY,
        DIRECTOR_ACCOUNT_KEY,
        AUDIT_KEY,
        NOTIFY_KEY,
        NOTIFY_SEEN_KEY,
        SMS_OUTBOX_KEY,
      ];
      try {
        await getStore()?.refresh?.(keys);
      } catch {
        // Export whatever is available locally if the shared API is offline.
      }
      const payload = {
        exportedAt: isoNow(),
        source: {
          apiState: getStore()?.apiState || "unknown",
          idbState: getStore()?.idbState || "unknown",
          keys,
        },
        erp: loadJson(ERP_KEY, null),
        hr: loadJson(HR_KEY, null),
        departmentAccounts: loadJson(ACCOUNTS_KEY, []),
        branchAccounts: loadJson(BRANCH_ACCOUNTS_KEY, []),
        agentAccounts: loadJson(AGENT_ACCOUNTS_KEY, []),
        directorAccount: loadJson(DIRECTOR_ACCOUNT_KEY, null),
        audit: loadJson(AUDIT_KEY, []),
        notifications: loadJson(NOTIFY_KEY, null),
        notificationSeen: loadJson(NOTIFY_SEEN_KEY, null),
        smsOutbox: loadJson(SMS_OUTBOX_KEY, []),
      };
      downloadText(
        `jixels-data-export-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(payload, null, 2),
        "application/json;charset=utf-8",
      );
      toast("Export ready", "JSON data export downloaded.");
    };

    const deleteAllData = async () => {
      const phrase = prompt("Type DELETE ALL JIXELS DATA to confirm.");
      if (phrase !== "DELETE ALL JIXELS DATA") return;
      const keysToDelete = [
        ERP_KEY,
        HR_KEY,
        ACCOUNTS_KEY,
        BRANCH_ACCOUNTS_KEY,
        AGENT_ACCOUNTS_KEY,
        DIRECTOR_ACCOUNT_KEY,
        AUDIT_KEY,
        NOTIFY_KEY,
        NOTIFY_SEEN_KEY,
        SMS_OUTBOX_KEY,
      ];
      for (const key of keysToDelete) {
        removeJson(key);
      }
      try {
        await getStore()?.flush?.();
      } catch {
        // Local IndexedDB/browser fallback has still been cleared.
      }
      erp = ensureERP();
      render();
      renderAccounts();
      toast("Data deleted", "ERP, HR, accounts, audit, notifications, and SMS queues have been cleared.");
    };

    const inReportRange = (value, range) => {
      if (!range || range.key === "all") return true;
      const ms = new Date(value).getTime();
      return Number.isFinite(ms) && ms >= range.startMs && ms <= range.endMs;
    };

    const buildAdminReportHtml = ({ dueDate, range }) => {
      erp = loadJson(ERP_KEY, erp);
      const now = new Date().toLocaleString();
      const due = String(dueDate || "").trim();
      const dueLine = due ? `<p><strong>Due date:</strong> ${escapeHtml(due)}</p>` : "";
      const periodLabel = range?.label || "All time";
      const periodLine = `<p><strong>Period:</strong> ${escapeHtml(periodLabel)}</p>`;

      const bId = String(branchSelect?.value || erp.branches?.[0]?.id || "");
      const branch = (erp.branches || []).find((b) => b.id === bId) || null;
      if (!branch) {
        return `<h3>Admin Inventory Report</h3><p><strong>Generated:</strong> ${escapeHtml(now)}</p>${periodLine}${dueLine}<p>No branch selected.</p>`;
      }

      const phones = Array.isArray(branch.phones) ? branch.phones : [];
      const periodPhones = phones.filter((p) => inReportRange(p.createdAt || p.updatedAt, range));
      const soldPhones = Array.isArray(branch.soldPhones) ? branch.soldPhones : [];
      const periodSoldPhones = soldPhones.filter((p) => inReportRange(p.soldAt || p.updatedAt, range));
      const txLog = Array.isArray(branch.txLog) ? branch.txLog : [];
      const periodTx = txLog.filter((tx) => inReportRange(tx.at, range));
      let totalValue = 0;
      for (const p of phones) totalValue += Number(p.price || 0) || 0;
      let periodAddedValue = 0;
      for (const p of periodPhones) periodAddedValue += Number(p.price || 0) || 0;
      let periodSalesValue = 0;
      let periodCreditCount = 0;
      let periodCreditBalance = 0;
      for (const tx of periodTx) {
        periodSalesValue += Number(tx.amountPaid ?? tx.amount ?? 0) || 0;
        if (String(tx.saleType || "").toLowerCase() === "credit") {
          periodCreditCount += 1;
          periodCreditBalance += Number(tx.balance || 0) || 0;
        }
      }
      const creditRowsHtml = periodTx
        .filter((tx) => String(tx.saleType || "").toLowerCase() === "credit")
        .map(
          (tx) => `
            <tr>
              <td>${tx.at ? escapeHtml(new Date(tx.at).toLocaleString()) : "—"}</td>
              <td>${escapeHtml(tx.serial || "—")}</td>
              <td>${escapeHtml(tx.customerPhone || "—")}</td>
              <td class="num">${formatInt(Number(tx.amount || 0) || 0)}</td>
              <td class="num">${formatInt(Number(tx.amountPaid ?? tx.paidAmount ?? 0) || 0)}</td>
              <td class="num">${formatInt(Number(tx.balance || 0) || 0)}</td>
              <td>${escapeHtml(tx.creditDueDate || "—")}</td>
            </tr>`,
        )
        .join("");

      const rowsHtml = phones
        .slice()
        .sort((a, z) => String(a.serial || "").localeCompare(String(z.serial || "")))
        .map(
          (p) => `
            <tr>
              <td>${escapeHtml(p.serial || "—")}</td>
              <td>${escapeHtml(p.model || "—")}</td>
              <td>${escapeHtml(p.color || "—")}</td>
              <td>${escapeHtml(p.storage || "—")}</td>
              <td class="num">${formatInt(Number(p.price || 0) || 0)}</td>
            </tr>`,
        )
        .join("");

      return `
        <h3>Admin Inventory Report</h3>
        <p><strong>Generated:</strong> ${escapeHtml(now)}</p>
        ${periodLine}
        ${dueLine}
        <p><strong>Branch:</strong> ${escapeHtml(branch.name || branch.id || "—")}</p>

        <div class="report-grid">
          <div class="report-card">
            <div class="label">Phones in stock</div>
            <div class="value">${formatInt(phones.length)}</div>
          </div>
          <div class="report-card">
            <div class="label">Total value (KES)</div>
            <div class="value">${formatInt(totalValue)}</div>
          </div>
          <div class="report-card">
            <div class="label">Added in period</div>
            <div class="value">${formatInt(periodPhones.length)}</div>
          </div>
          <div class="report-card">
            <div class="label">Added value (KES)</div>
            <div class="value">${formatInt(periodAddedValue)}</div>
          </div>
          <div class="report-card">
            <div class="label">Sold in period</div>
            <div class="value">${formatInt(periodSoldPhones.length)}</div>
          </div>
          <div class="report-card">
            <div class="label">Sales in period (KES)</div>
            <div class="value">${formatInt(periodSalesValue)}</div>
          </div>
          <div class="report-card">
            <div class="label">Credit phones</div>
            <div class="value">${formatInt(periodCreditCount)}</div>
          </div>
          <div class="report-card">
            <div class="label">Credit balance (KES)</div>
            <div class="value">${formatInt(periodCreditBalance)}</div>
          </div>
        </div>

        <h3 style="margin-top: 14px;">Credit Sales in Period</h3>
        <table class="table" aria-label="Admin credit sales report">
          <thead>
            <tr>
              <th>Date</th>
              <th>Serial</th>
              <th>Customer</th>
              <th class="num">Amount</th>
              <th class="num">Paid</th>
              <th class="num">Balance</th>
              <th>Due date</th>
            </tr>
          </thead>
          <tbody>
            ${creditRowsHtml || `<tr><td colspan="7">No credit sales in this period.</td></tr>`}
          </tbody>
        </table>

        <h3 style="margin-top: 14px;">Branch Phones</h3>
        <table class="table" aria-label="Admin phones report">
          <thead>
            <tr>
              <th>Serial</th>
              <th>Model</th>
              <th>Color</th>
              <th>Storage</th>
              <th class="num">Price</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="5">No phones in stock.</td></tr>`}
          </tbody>
        </table>
      `;
    };

    initDeptReportCenter({
      title: "Admin Inventory Report",
      filenameBase: "jixels-admin-inventory-report",
      buildHtml: buildAdminReportHtml,
    });

    if (branchSelect) branchSelect.addEventListener("change", safe("admin_branch_change", () => render()));
    if (addBtn) addBtn.addEventListener("click", safe("admin_add_phone", () => addPhone()));
    if (refreshAccountsBtn) refreshAccountsBtn.addEventListener("click", safe("admin_refresh_accounts", () => renderAccounts()));
    if (exportDataBtn) exportDataBtn.addEventListener("click", safe("admin_export_data", async () => exportAllData()));
    if (deleteDataBtn) deleteDataBtn.addEventListener("click", safe("admin_delete_data", async () => deleteAllData()));

    render();
    renderAccounts();
    const store = getStore();
    if (store?.subscribe) {
      store.subscribe(
        safe("admin_store", (ev) => {
          if (!ev || ev.type !== "set" || ev.key !== ERP_KEY) return;
          render();
        }),
      );
    } else {
      window.addEventListener(
        "storage",
        safe("admin_storage", (e) => {
          if (e.key !== ERP_KEY) return;
          render();
        }),
      );
    }
  };

  window.addEventListener("DOMContentLoaded", safe("dept_domcontentloaded", async () => {
    await bootstrapFromApi();
    initNotificationListener();
    if (PAGE === "departments-login") initLogin();
    if (PAGE === "departments-register") initRegister();
    if (PAGE === "departments-hr") initHRPage();
    if (PAGE === "departments-finance") initFinancePage();
    if (PAGE === "departments-operations") initOpsOrSalesPage("operations");
    if (PAGE === "departments-sales") initOpsOrSalesPage("sales");
    if (PAGE === "departments-admin") initAdminPage();
  }));
})();
