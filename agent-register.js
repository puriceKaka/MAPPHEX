(() => {
  "use strict";

  const PAGE = document.body?.dataset?.page || "";

  const AGENT_ACCOUNTS_KEY = "jixels_agent_accounts_v1";
  const BRANCH_ACCOUNTS_KEY = "jixels_branch_accounts_v1";
  const DEPT_ACCOUNTS_KEY = "jixels_departments_accounts_v1";
  const DIRECTOR_ACCOUNT_KEY = "jixels_director_account_v1";
  const ERP_KEY = "jixels_erp_v1";
  const API_ENABLED_KEY = "jixels_api_enabled_v1";

  const BRANCH_COUNT = 47;

  const $ = (selector, root = document) => root.querySelector(selector);

  const safeJsonParse = (raw, fallback) => {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };

  const loadJson = (key, fallback) => {
    const store = window.JixelsStore || null;
    if (store?.getJson) {
      const value = store.getJson(key, undefined);
      if (typeof value !== "undefined" && value !== null) return value;
    }
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return safeJsonParse(raw, fallback);
  };

  const apiEnabled = () => {
    try {
      return localStorage.getItem(API_ENABLED_KEY) === "1";
    } catch {
      return false;
    }
  };

  const apiPostKv = (key, value) => {
    if (!apiEnabled()) return;
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    }).catch(() => null);
  };

  const saveJson = (key, value) => {
    const store = window.JixelsStore || null;
    if (store?.setJson) {
      store.setJson(key, value);
      localStorage.setItem(key, JSON.stringify(value));
      return;
    }
    localStorage.setItem(key, JSON.stringify(value));
    try {
      apiPostKv(key, value);
    } catch {
      // ignore
    }
  };

  const bootstrapKeyFromApi = async (key) => {
    if (!apiEnabled()) return false;
    if (localStorage.getItem(key)) return true;
    try {
      const res = await fetch(`/api/kv?key=${encodeURIComponent(String(key || ""))}`);
      if (!res.ok) return false;
      const data = await res.json();
      if (!data || data.ok !== true) return false;
      if (data.value === null || typeof data.value === "undefined") return false;
      localStorage.setItem(key, JSON.stringify(data.value));
      return true;
    } catch {
      return false;
    }
  };

  const bufToHex = (buffer) =>
    Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  const weakHashHex = (text) => {
    let h1 = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h1 ^= text.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193);
    }
    const hex = (h1 >>> 0).toString(16).padStart(8, "0");
    return `${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}`.slice(0, 64);
  };

  const hashHex = async (text) => {
    try {
      if (crypto?.subtle?.digest) {
        const enc = new TextEncoder().encode(text);
        const digest = await crypto.subtle.digest("SHA-256", enc);
        return bufToHex(digest);
      }
    } catch {
      // Fall through.
    }
    return weakHashHex(text);
  };

  const isoNow = () => new Date().toISOString();

  const makeId = (prefix, index) =>
    `${prefix}${String(index).padStart(2, "0")}`;

  const ensureERP = () => {
    const existing = loadJson(ERP_KEY, null);
    if (
      existing &&
      typeof existing === "object" &&
      Array.isArray(existing.branches) &&
      existing.branches.length === BRANCH_COUNT
    ) {
      let changed = false;
      for (const b of existing.branches) {
        if (!b || typeof b !== "object") continue;
        if (!Array.isArray(b.inventory)) {
          b.inventory = [];
          changed = true;
        }
        if (!Array.isArray(b.phones)) {
          b.phones = [];
          changed = true;
        }
        if (!Array.isArray(b.soldPhones)) {
          b.soldPhones = [];
          changed = true;
        }
        if (!Array.isArray(b.transactions)) {
          b.transactions = [];
          changed = true;
        }
        if (!Array.isArray(b.txLog)) {
          b.txLog = [];
          changed = true;
        }
        if (!Array.isArray(b.damageLoss)) {
          b.damageLoss = [];
          changed = true;
        }
        if (!b.financeSummary || typeof b.financeSummary !== "object") {
          b.financeSummary = { mpesaIn: 0, bankIn: 0, txCount: 0, lastTxAt: "" };
          changed = true;
        }
        if (!b.ledger || typeof b.ledger !== "object") {
          b.ledger = { head: "GENESIS" };
          changed = true;
        }
        if (!b.updatedAt) {
          b.updatedAt = isoNow();
          changed = true;
        }
      }
      if (changed) {
        existing.lastUpdated = isoNow();
        saveJson(ERP_KEY, existing);
      }
      return existing;
    }

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

  const loadAccounts = () => {
    const accounts = loadJson(AGENT_ACCOUNTS_KEY, []);
    return Array.isArray(accounts) ? accounts : [];
  };

  const saveAccounts = (accounts) => saveJson(AGENT_ACCOUNTS_KEY, accounts);

  const normalized = (value) => String(value || "").trim().toLowerCase();
  const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

  const accountIdentityTaken = (email, username) => {
    const e = normalized(email);
    const u = normalized(username);
    const buckets = [
      loadJson(AGENT_ACCOUNTS_KEY, []),
      loadJson(BRANCH_ACCOUNTS_KEY, []),
      loadJson(DEPT_ACCOUNTS_KEY, []),
    ];
    const director = loadJson(DIRECTOR_ACCOUNT_KEY, null);
    if (director) buckets.push([director]);
    return buckets.some((list) =>
      (Array.isArray(list) ? list : []).some(
        (acc) => normalized(acc.email) === e || normalized(acc.username) === u,
      ),
    );
  };

  const init = async () => {
    if (PAGE !== "agent-register") return;

    await window.JixelsStore?.bootstrap?.([
      AGENT_ACCOUNTS_KEY,
      BRANCH_ACCOUNTS_KEY,
      DEPT_ACCOUNTS_KEY,
      DIRECTOR_ACCOUNT_KEY,
      ERP_KEY,
    ]);
    await bootstrapKeyFromApi(ERP_KEY);
    const erp = ensureERP();

    const form = $("#agent-register-form");
    const branchSelect = $("#branchId");
    const username = $("#username");
    const email = $("#email");
    const password = $("#password");
    const confirmPassword = $("#confirmPassword");
    const error = $("#agent-register-error");

    if (!form || !branchSelect || !username || !email || !password || !confirmPassword || !error) return;

    branchSelect.textContent = "";
    for (const b of (erp.branches || []).slice().sort((a, z) => String(a.name || "").localeCompare(String(z.name || "")))) {
      const opt = document.createElement("option");
      opt.value = String(b.id || "");
      opt.textContent = String(b.name || b.id || "");
      branchSelect.appendChild(opt);
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.textContent = "";

      const branchId = String(branchSelect.value || "").trim();
      const u = String(username.value || "").trim();
      const m = String(email.value || "").trim().toLowerCase();
      const p1 = String(password.value || "");
      const p2 = String(confirmPassword.value || "");

      if (!branchId) {
        error.textContent = "Branch is required.";
        return;
      }
      if (u.length < 2) {
        error.textContent = "Username is required.";
        username.focus();
        return;
      }
      if (!validEmail(m)) {
        error.textContent = "Enter a valid email address.";
        email.focus();
        return;
      }
      if (p1.length < 8) {
        error.textContent = "Password must be at least 8 characters.";
        password.focus();
        return;
      }
      if (p1 !== p2) {
        error.textContent = "Passwords do not match.";
        confirmPassword.value = "";
        confirmPassword.focus();
        return;
      }

      const accounts = loadAccounts();
      if (accountIdentityTaken(m, u)) {
        error.textContent = "Email or username already exists in another portal.";
        return;
      }

      const salt = crypto.getRandomValues(new Uint32Array(4)).join("-");
      const passwordHash = await hashHex(`${salt}:${p1}`);

      const account = {
        id: `agent-${crypto.getRandomValues(new Uint32Array(1))[0]}`,
        role: "agent",
        status: "pending",
        branchId,
        username: u,
        email: m,
        salt,
        passwordHash,
        createdAt: isoNow(),
      };

      accounts.push(account);
      saveAccounts(accounts);

      error.textContent = "Registration submitted. Admin must approve this agent before login.";
      form.reset();
    });
  };

  init();
})();
