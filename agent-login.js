(() => {
  "use strict";

  const PAGE = document.body?.dataset?.page || "";

  const SESSION_LOCAL_KEY = "jixels_session_agent_v1";
  const SESSION_SESSION_KEY = "jixels_session_agent_tmp_v1";
  const AGENT_ACCOUNTS_KEY = "jixels_agent_accounts_v1";

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

  const getSession = () => {
    const session =
      safeJsonParse(sessionStorage.getItem(SESSION_SESSION_KEY), null) ||
      loadJson(SESSION_LOCAL_KEY, null);
    if (!session || typeof session !== "object") return null;
    if (!session.role || !session.userId) return null;
    return session;
  };

  const setSession = (session, rememberMe) => {
    const payload = { ...session, createdAt: new Date().toISOString() };
    if (rememberMe) {
      localStorage.setItem(SESSION_LOCAL_KEY, JSON.stringify(payload));
      sessionStorage.removeItem(SESSION_SESSION_KEY);
      return;
    }
    sessionStorage.setItem(SESSION_SESSION_KEY, JSON.stringify(payload));
    localStorage.removeItem(SESSION_LOCAL_KEY);
  };

  const loadAgentAccounts = () => {
    const accounts = loadJson(AGENT_ACCOUNTS_KEY, []);
    return Array.isArray(accounts) ? accounts : [];
  };

  const init = async () => {
    if (PAGE !== "agent-login") return;

    await window.JixelsStore?.bootstrap?.([AGENT_ACCOUNTS_KEY]);

    const session = getSession();
    if (session?.role === "agent" && session?.branchId) {
      window.location.href = "Agent.html";
      return;
    }

    const accounts = loadAgentAccounts();

    const form = $("#agent-login-form");
    const identifier = $("#identifier");
    const password = $("#password");
    const rememberMe = $("#rememberMe");
    const error = $("#agent-login-error");
    const loginBtn = $("#agent-login-btn");

    if (!form || !identifier || !password || !error) return;

    if (accounts.length === 0) {
      if (loginBtn) loginBtn.textContent = "Go to registration";
      error.textContent =
        "No agent accounts found on this device. Please create an account first.";

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        window.location.href = "agent-register.html";
      });
      return;
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.textContent = "";

      const inputId = String(identifier.value || "").trim().toLowerCase();
      const inputPassword = String(password.value || "");

      const account =
        accounts.find(
          (a) =>
            String(a.email || "").toLowerCase() === inputId ||
            String(a.username || "").toLowerCase() === inputId,
        ) || null;

      if (!account) {
        error.textContent = "Account not found. Check your email/username.";
        return;
      }

      const status = String(account.status || "approved").toLowerCase();
      if (status === "rejected") {
        error.textContent = "Account rejected. Please contact Head Office.";
        return;
      }
      if (status !== "approved") {
        error.textContent = "Account is pending admin approval.";
        return;
      }

      const inputHash = await hashHex(`${account.salt}:${inputPassword}`);
      if (inputHash !== account.passwordHash) {
        error.textContent = "Incorrect password.";
        password.value = "";
        password.focus();
        return;
      }

      setSession(
        {
          role: "agent",
          userId: account.id,
          branchId: account.branchId,
          email: account.email,
          username: account.username,
        },
        !!rememberMe?.checked,
      );

      window.location.href = "Agent.html";
    });
  };

  init();
})();
