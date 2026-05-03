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

  const apiPostKv = (key, value) => {
    if (!apiEnabled()) return;
    try {
      fetch("/api/kv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      }).catch(() => null);
    } catch {
      // ignore
    }
  };

  const saveJson = (key, value) => {
    const raw = JSON.stringify(value);
    const ok = storageSetItem(key, raw);
    if (!ok) return false;
    apiPostKv(key, value);
    return true;
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

  const loadDirectorAccount = () => {
    const acc = loadJson(DIRECTOR_ACCOUNT_KEY, null);
    if (!acc || typeof acc !== "object") return null;
    if (!acc.id || !acc.email || !acc.passwordHash || !acc.salt) return null;
    return acc;
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

  const isDirector = (session) =>
    !!session && session.role === "director" && !!session.userId;

  const init = async () => {
    if (document.body?.dataset?.page !== "director-register") return;

    const session = getSession();
    if (isDirector(session)) {
      window.location.href = "Director.html";
      return;
    }

    const form = $("#director-register-form");
    const username = $("#username");
    const email = $("#email");
    const password = $("#password");
    const confirmPassword = $("#confirmPassword");
    const error = $("#register-error");
    const submitBtn = form?.querySelector?.('button[type="submit"]') || null;

    if (!form || !username || !email || !password || !confirmPassword || !error)
      return;

    const submitOriginalText = submitBtn ? submitBtn.textContent : "";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Loading...";
    }

    let existing = loadDirectorAccount();
    if (!existing) {
      await bootstrapKeyFromApi(DIRECTOR_ACCOUNT_KEY);
      existing = loadDirectorAccount();
    }

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitOriginalText || "Create account";
    }

    if (existing) {
      error.textContent =
        "A Director account already exists on this device. Please login (or reset this account to create a new one).";

      try {
        form.noValidate = true;
      } catch {
        // ignore
      }

      username.disabled = true;
      email.disabled = true;
      password.disabled = true;
      confirmPassword.disabled = true;

      const goLogin = () => {
        window.location.href = "director-login.html";
      };

      if (submitBtn) {
        submitBtn.textContent = "Go to login";
        submitBtn.type = "button";
        submitBtn.addEventListener("click", goLogin);
      }

      const resetBtnId = "director-reset-btn";
      if (!document.getElementById(resetBtnId)) {
        const resetBtn = document.createElement("button");
        resetBtn.id = resetBtnId;
        resetBtn.type = "button";
        resetBtn.className = "btn";
        resetBtn.style.marginTop = "10px";
        resetBtn.textContent = "Reset account";
        resetBtn.addEventListener("click", () => {
          const ok =
            window.confirm(
              "This will remove the Director account stored in this browser. Continue?",
            ) === true;
          if (!ok) return;
          storageRemoveItem(DIRECTOR_ACCOUNT_KEY);
          storageRemoveItem(SESSION_LOCAL_KEY);
          storageRemoveItem(SESSION_SESSION_KEY);
          window.location.reload();
        });
        form.appendChild(resetBtn);
      }

      form.addEventListener("submit", (e) => {
        e.preventDefault();
        goLogin();
      });
      return;
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      error.textContent = "";

      const uname = String(username.value || "").trim();
      const mail = String(email.value || "").trim().toLowerCase();
      const p1 = String(password.value || "");
      const p2 = String(confirmPassword.value || "");

      if (uname.length < 2) {
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

      let salt = "";
      try {
        salt = crypto.getRandomValues(new Uint32Array(4)).join("-");
      } catch {
        salt = `${Math.random().toString(16).slice(2)}-${Date.now()}`;
      }
      const passwordHash = await hashHex(`${salt}:${p1}`);
      let idRand = 0;
      try {
        idRand = crypto.getRandomValues(new Uint32Array(1))[0];
      } catch {
        idRand = Math.floor(Math.random() * 1000000000);
      }

      const account = {
        id: `director-${idRand}`,
        role: "director",
        username: uname,
        email: mail,
        salt,
        passwordHash,
        createdAt: new Date().toISOString(),
      };

      const ok = saveJson(DIRECTOR_ACCOUNT_KEY, account);
      if (!ok) {
        error.textContent =
          "Could not save your account in this browser. Check storage permissions and try again.";
        return;
      }
      window.location.href = "director-login.html";
    });
  };

  void init();
})();
