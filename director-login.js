(() => {
  "use strict";

  const SESSION_LOCAL_KEY = "jixels_session_director_v1";
  const SESSION_SESSION_KEY = "jixels_session_director_tmp_v1";
  const DIRECTOR_ACCOUNT_KEY = "jixels_director_account_v1";
  const API_ENABLED_KEY = "jixels_api_enabled_v1";

  const $ = (selector, root = document) => root.querySelector(selector);

  const storageGetItem = (key) => {
    try {
      const v = localStorage.getItem(key);
      if (v !== null) return v;
    } catch {
      // ignore
    }
    try {
      const v = sessionStorage.getItem(key);
      if (v !== null) return v;
    } catch {
      // ignore
    }
    return null;
  };

  const storageSetItem = (key, value) => {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      // ignore
    }
    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch {
      // ignore
    }
    return false;
  };

  const storageRemoveItem = (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
    try {
      sessionStorage.removeItem(key);
    } catch {
      // ignore
    }
  };

  const safeJsonParse = (raw, fallback) => {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };

  const loadJson = (key, fallback) => {
    try {
      const raw = storageGetItem(key);
      if (!raw) return fallback;
      return safeJsonParse(raw, fallback);
    } catch {
      return fallback;
    }
  };

  const apiEnabled = () => {
    try {
      return storageGetItem(API_ENABLED_KEY) === "1";
    } catch {
      return false;
    }
  };

  const bootstrapKeyFromApi = async (key) => {
    if (!apiEnabled()) return false;
    try {
      if (storageGetItem(key)) return true;
    } catch {
      // ignore
    }

    try {
      const res = await fetch(
        `/api/kv?key=${encodeURIComponent(String(key || ""))}`,
      );
      if (!res.ok) return false;
      const data = await res.json();
      if (!data || data.ok !== true) return false;
      if (data.value === null || typeof data.value === "undefined") return false;

      try {
        return storageSetItem(key, JSON.stringify(data.value));
      } catch {
        return false;
      }
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

  const getSession = () => {
    let session = null;
    try {
      session = safeJsonParse(
        sessionStorage.getItem(SESSION_SESSION_KEY),
        null,
      );
    } catch {
      session = null;
    }
    session = session || loadJson(SESSION_LOCAL_KEY, null);
    if (!session || typeof session !== "object") return null;
    if (!session.role || !session.userId) return null;
    return session;
  };

  const setSession = (session, rememberMe) => {
    const payload = { ...session, createdAt: new Date().toISOString() };
    const raw = JSON.stringify(payload);

    if (rememberMe) {
      let stored = false;
      try {
        localStorage.setItem(SESSION_LOCAL_KEY, raw);
        stored = true;
      } catch {
        stored = false;
      }

      if (stored) {
        try {
          sessionStorage.removeItem(SESSION_SESSION_KEY);
        } catch {
          // ignore
        }
        return;
      }

      // Fallback: if localStorage is blocked/unavailable, keep a session-only login.
      try {
        sessionStorage.setItem(SESSION_SESSION_KEY, raw);
      } catch {
        // ignore
      }
      return;
    }

    try {
      sessionStorage.setItem(SESSION_SESSION_KEY, raw);
      try {
        localStorage.removeItem(SESSION_LOCAL_KEY);
      } catch {
        // ignore
      }
      return;
    } catch {
      // ignore
    }

    // Fallback: if sessionStorage is blocked/unavailable, persist in localStorage if possible.
    try {
      localStorage.setItem(SESSION_LOCAL_KEY, raw);
    } catch {
      // ignore
    }
  };

  const loadDirectorAccount = () => {
    const acc = loadJson(DIRECTOR_ACCOUNT_KEY, null);
    if (!acc || typeof acc !== "object") return null;
    if (!acc.id || !acc.email || !acc.passwordHash || !acc.salt) return null;
    return acc;
  };

  const init = async () => {
    if (document.body?.dataset?.page !== "director-login") return;

    const session = getSession();
    if (session?.role === "director" && session?.userId) {
      window.location.href = "Director.html";
      return;
    }

    const form = $("#director-login-form");
    const identifier = $("#username");
    const password = $("#password");
    const rememberMe = $("#rememberMe");
    const error = $("#login-error");
    const loginBtn = $("#login-btn");

    if (!form || !identifier || !password || !error) return;

    const btnOriginalText = loginBtn ? loginBtn.textContent : "";
    if (loginBtn) {
      loginBtn.disabled = true;
      loginBtn.textContent = "Loading...";
    }

    let account = loadDirectorAccount();
    if (!account) {
      await bootstrapKeyFromApi(DIRECTOR_ACCOUNT_KEY);
      account = loadDirectorAccount();
    }

    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.textContent = btnOriginalText || "Login";
    }

    if (!account) {
      // Normal sequence: login is the first page. If no account exists yet,
      // keep the user here and guide them to registration.
      if (loginBtn) {
        loginBtn.textContent = "Go to registration";
        loginBtn.type = "button";
      }
      error.textContent =
        "No Director account found on this device. Please create an account first.";
      try {
        form.noValidate = true;
      } catch {
        // ignore
      }
      identifier.required = false;
      password.required = false;

      const goRegister = () => {
        window.location.href = "director-register.html";
      };

      if (loginBtn) loginBtn.addEventListener("click", goRegister);
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        goRegister();
      });
      return;
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.textContent = "";

      const inputId = String(identifier.value || "").trim().toLowerCase();
      const inputPassword = String(password.value || "");
      const accountEmail = String(account.email || "").trim().toLowerCase();
      const accountUsername = String(account.username || "").trim().toLowerCase();

      if (inputId !== accountEmail && inputId !== accountUsername) {
        error.textContent =
          "Account not found. Use your registered email or username.";
        password.value = "";
        password.focus();
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
          role: "director",
          userId: account.id,
          email: account.email,
          username: account.username || "",
        },
        !!rememberMe?.checked,
      );

      window.location.href = "Director.html";
    });
  };

  void init();
})();
