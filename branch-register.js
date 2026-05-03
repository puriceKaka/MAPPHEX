(() => {
  "use strict";

  const PAGE = document.body?.dataset?.page || "";

  const BRANCH_ACCOUNTS_KEY = "jixels_branch_accounts_v1";
  const AGENT_ACCOUNTS_KEY = "jixels_agent_accounts_v1";
  const DEPT_ACCOUNTS_KEY = "jixels_departments_accounts_v1";
  const DIRECTOR_ACCOUNT_KEY = "jixels_director_account_v1";
  const DATA_KEY = "jixels_erp_v1";
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
    if (store?.getJson) return store.getJson(key, fallback);
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return safeJsonParse(raw, fallback);
  };

  const saveJson = (key, value) => {
    const store = window.JixelsStore || null;
    if (store?.setJson) return store.setJson(key, value);
    localStorage.setItem(key, JSON.stringify(value));
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

  const ensureData = () => {
    const existing = loadJson(DATA_KEY, null);
    if (
      existing &&
      typeof existing === "object" &&
      Array.isArray(existing.branches) &&
      existing.branches.length === BRANCH_COUNT
    ) {
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
        transactions: [],
        damageLoss: [],
        financeSummary: { mpesaIn: 0, bankIn: 0, txCount: 0, lastTxAt: "" },
        ledger: { head: "GENESIS" },
        updatedAt: isoNow(),
      };
    });

    const seeded = { version: 1, lastUpdated: isoNow(), branches, departments: {} };
    saveJson(DATA_KEY, seeded);
    return seeded;
  };

  const loadAccounts = () => {
    const accounts = loadJson(BRANCH_ACCOUNTS_KEY, []);
    return Array.isArray(accounts) ? accounts : [];
  };

  const saveAccounts = (accounts) => saveJson(BRANCH_ACCOUNTS_KEY, accounts);

  const normalized = (value) => String(value || "").trim().toLowerCase();

  const accountIdentityTaken = (email, username) => {
    const e = normalized(email);
    const u = normalized(username);
    const buckets = [
      loadJson(BRANCH_ACCOUNTS_KEY, []),
      loadJson(AGENT_ACCOUNTS_KEY, []),
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
    if (PAGE !== "branch-register") return;

    await window.JixelsStore?.bootstrap?.([
      BRANCH_ACCOUNTS_KEY,
      AGENT_ACCOUNTS_KEY,
      DEPT_ACCOUNTS_KEY,
      DIRECTOR_ACCOUNT_KEY,
      DATA_KEY,
    ]);
    ensureData();

    const form = $("#branch-register-form");
    const county = $("#county");
    const area = $("#area");
    const username = $("#username");
    const email = $("#email");
    const password = $("#password");
    const confirmPassword = $("#confirmPassword");
    const error = $("#branch-register-error");

    if (
      !form ||
      !county ||
      !area ||
      !username ||
      !email ||
      !password ||
      !confirmPassword ||
      !error
    )
      return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.textContent = "";

      const c = String(county.value || "").trim();
      const a = String(area.value || "").trim();
      const u = String(username.value || "").trim();
      const m = String(email.value || "").trim().toLowerCase();
      const p1 = String(password.value || "");
      const p2 = String(confirmPassword.value || "");

      if (u.length < 2) {
        error.textContent = "Username is required.";
        return;
      }
      if (p1.length < 8) {
        error.textContent = "Password must be at least 8 characters.";
        return;
      }
      if (p1 !== p2) {
        error.textContent = "Passwords do not match.";
        confirmPassword.value = "";
        confirmPassword.focus();
        return;
      }

      const accounts = loadAccounts();
      if (accounts.length >= BRANCH_COUNT) {
        error.textContent =
          "Maximum branches reached (47). Contact Director to manage branch slots.";
        return;
      }

      if (accountIdentityTaken(m, u)) {
        error.textContent = "Email or username already exists in another portal.";
        return;
      }

      const branchAlreadyRequested = accounts.some(
        (acc) => normalized(acc.county) === normalized(c) && normalized(acc.area) === normalized(a),
      );
      if (branchAlreadyRequested) {
        error.textContent = "This branch location has already been registered or requested.";
        return;
      }

      const data = ensureData();
      const usedIds = new Set(accounts.map((x) => x.branchId));
      const slot =
        (data.branches || []).find((b) => b?.id && !usedIds.has(b.id)) || null;

      if (!slot) {
        error.textContent =
          "No available branch slots. Contact Director to manage branch slots.";
        return;
      }

      const salt = crypto.getRandomValues(new Uint32Array(4)).join("-");
      const passwordHash = await hashHex(`${salt}:${p1}`);
      const secret = crypto.getRandomValues(new Uint8Array(32));
      const secretB64 = btoa(String.fromCharCode(...secret));

      const account = {
        id: `branch-${crypto.getRandomValues(new Uint32Array(1))[0]}`,
        role: "branch",
        status: "pending",
        branchId: slot.id,
        county: c,
        area: a,
        username: u,
        email: m,
        salt,
        passwordHash,
        secretB64,
        createdAt: isoNow(),
      };

      accounts.push(account);
      saveAccounts(accounts);

      // Update the shared ERP branch record for Director live updates.
      const idx = data.branches.findIndex((b) => b.id === slot.id);
      const label = `Branch ${slot.id.replace("b", "")} • ${c} • ${a}`;
      data.branches[idx] = {
        ...data.branches[idx],
        name: label,
        city: c,
        area: a,
        registrationStatus: "pending",
        updatedAt: isoNow(),
      };
      data.lastUpdated = isoNow();
      saveJson(DATA_KEY, data);

      error.textContent = "Registration submitted. Admin must approve this branch before login.";
      form.reset();
    });
  };

  init();
})();
