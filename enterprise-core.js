(() => {
  "use strict";

  const COMPANY_NAME = "MAPPHEX";
  const DEFAULT_TENANT_ID = "default-company";
  const TENANT_KEY = "enterprise_active_tenant_v1";
  const SESSION_META_KEY = "enterprise_session_meta_v1";
  const AUDIT_KEY = "enterprise_audit_v1";
  const QUEUE_KEY = "enterprise_task_queue_v1";
  const NOTIFY_KEY = "enterprise_notify_v1";
  const CSRF_KEY = "enterprise_csrf_v1";
  const LEGACY_PREFIX = "jix" + "els_";
  const PREFIXABLE = new RegExp(`^(${LEGACY_PREFIX}|enterprise_)`, "i");
  const GLOBAL_KEYS = new Set(["enterprise_api_enabled_v1", `${LEGACY_PREFIX}api_enabled_v1`, TENANT_KEY]);

  const cleanId = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);

  const rawLocalGet = Storage.prototype.getItem;
  const rawLocalSet = Storage.prototype.setItem;
  const rawLocalRemove = Storage.prototype.removeItem;

  const getRaw = (storage, key) => {
    try {
      return rawLocalGet.call(storage, key);
    } catch {
      return null;
    }
  };

  const setRaw = (storage, key, value) => {
    try {
      rawLocalSet.call(storage, key, value);
      return true;
    } catch {
      return false;
    }
  };

  const currentTenantId = () => {
    const fromQuery = cleanId(new URLSearchParams(location.search).get("tenant"));
    if (fromQuery) setRaw(localStorage, TENANT_KEY, fromQuery);
    return cleanId(getRaw(localStorage, TENANT_KEY)) || DEFAULT_TENANT_ID;
  };

  const scopeKey = (key) => {
    const k = String(key || "").trim();
    if (!k || GLOBAL_KEYS.has(k) || k.startsWith("tenant:")) return k;
    if (!PREFIXABLE.test(k)) return k;
    return `tenant:${currentTenantId()}:${k}`;
  };

  const readJson = (storage, key, fallback) => {
    try {
      const raw = rawLocalGet.call(storage, scopeKey(key));
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };

  const writeJson = (storage, key, value) => {
    try {
      rawLocalSet.call(storage, scopeKey(key), JSON.stringify(value ?? null));
      return true;
    } catch {
      return false;
    }
  };

  Storage.prototype.getItem = function patchedGetItem(key) {
    return rawLocalGet.call(this, scopeKey(key));
  };

  Storage.prototype.setItem = function patchedSetItem(key, value) {
    return rawLocalSet.call(this, scopeKey(key), value);
  };

  Storage.prototype.removeItem = function patchedRemoveItem(key) {
    return rawLocalRemove.call(this, scopeKey(key));
  };

  const rolePermissions = {
    super_admin: ["*"],
    platform_admin: [
      "platform.monitor",
      "platform.organizations.manage",
      "platform.users.manage",
      "platform.security.read",
      "platform.settings.manage",
      "platform.impersonate",
      "audit.read",
    ],
    director: ["*"],
    admin: ["users.manage", "branches.manage", "reports.read", "audit.read", "settings.manage"],
    finance: ["finance.manage", "reports.read", "payments.manage"],
    hr: ["hr.manage", "reports.read"],
    operations: ["operations.manage", "inventory.manage", "reports.read"],
    sales: ["sales.manage", "customers.manage", "reports.read"],
    branch: ["inventory.manage", "sales.manage", "reports.read"],
    teamleader: ["agents.manage", "inventory.allocate", "reports.read"],
    agent: ["sales.create", "customers.manage"],
    asset_admin: ["assets.manage", "assets.allocate", "reports.read"],
  };

  const roleHierarchy = {
    super_admin: ["platform_admin", "org_admin", "director", "admin", "manager", "staff"],
    platform_admin: ["org_admin", "manager", "staff"],
    org_admin: ["manager", "staff"],
    director: ["manager", "staff"],
    admin: ["staff"],
    manager: ["staff"],
    staff: [],
  };

  const clearSession = () => {
    try {
      sessionStorage.removeItem(SESSION_META_KEY);
      localStorage.removeItem(SESSION_META_KEY);
    } catch {
      // storage may be unavailable
    }
  };

  const getSession = () => {
    const session = readJson(sessionStorage, SESSION_META_KEY, null) || readJson(localStorage, SESSION_META_KEY, null) || null;
    if (!session) return null;
    if (session.expiresAt && Date.now() > Date.parse(session.expiresAt)) {
      clearSession();
      return null;
    }
    return session;
  };

  const setSession = (session, persistent = false) => {
    const payload = {
      ...(session || {}),
      tenantId: cleanId(session?.tenantId) || currentTenantId(),
      issuedAt: session?.issuedAt || new Date().toISOString(),
      expiresAt: session?.expiresAt || new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    };
    writeJson(sessionStorage, SESSION_META_KEY, payload);
    if (persistent) writeJson(localStorage, SESSION_META_KEY, payload);
    return payload;
  };

  const hasPermission = (permission, session = getSession()) => {
    const role = String(session?.role || "").toLowerCase();
    const permissions = new Set([...(rolePermissions[role] || []), ...(session?.permissions || [])]);
    return permissions.has("*") || permissions.has(permission);
  };

  const audit = (action, detail = {}) => {
    const session = getSession() || {};
    const entry = {
      id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      tenantId: currentTenantId(),
      actor: session.email || session.name || session.role || "system",
      action: String(action || "event"),
      detail,
    };
    const rows = readJson(localStorage, AUDIT_KEY, []);
    rows.push(entry);
    writeJson(localStorage, AUDIT_KEY, rows.slice(-1000));
    window.dispatchEvent(new CustomEvent("enterprise:audit", { detail: entry }));
    return entry;
  };

  const enqueue = (type, payload = {}) => {
    const task = {
      id: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: String(type || "task"),
      payload,
      status: "queued",
      tenantId: currentTenantId(),
      createdAt: new Date().toISOString(),
    };
    const queue = readJson(localStorage, QUEUE_KEY, []);
    queue.push(task);
    writeJson(localStorage, QUEUE_KEY, queue.slice(-500));
    return task;
  };

  const notify = (title, body, level = "info") => {
    const item = {
      id: `note-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      tenantId: currentTenantId(),
      title: String(title || "Notification"),
      body: String(body || ""),
      level,
      read: false,
      createdAt: new Date().toISOString(),
    };
    const list = readJson(localStorage, NOTIFY_KEY, []);
    list.push(item);
    writeJson(localStorage, NOTIFY_KEY, list.slice(-300));
    window.dispatchEvent(new CustomEvent("enterprise:notify", { detail: item }));
    return item;
  };

  const rewriteKvUrl = (input) => {
    try {
      const url = new URL(typeof input === "string" ? input : input?.url, location.origin);
      if (!url.pathname.endsWith("/api/kv")) return input;
      for (const name of ["key", "keys"]) {
        const value = url.searchParams.get(name);
        if (!value) continue;
        const next = name === "keys" ? value.split(",").map(scopeKey).join(",") : scopeKey(value);
        url.searchParams.set(name, next);
      }
      return typeof input === "string" ? `${url.pathname}${url.search}` : new Request(url, input);
    } catch {
      return input;
    }
  };

  const nativeFetch = window.fetch?.bind(window);
  if (nativeFetch) {
    window.fetch = (input, init = {}) => {
      let nextInput = rewriteKvUrl(input);
      const headers = new Headers(init.headers || {});
      headers.set("X-Tenant-ID", currentTenantId());
      const method = String(init.method || (typeof input === "object" ? input.method : "GET") || "GET").toUpperCase();
      if (!headers.has("X-CSRF-Token") && method !== "GET" && method !== "HEAD") {
        let csrf = getRaw(sessionStorage, CSRF_KEY);
        if (!csrf) {
          csrf = `csrf-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          setRaw(sessionStorage, CSRF_KEY, csrf);
        }
        headers.set("X-CSRF-Token", csrf);
      }
      if (!headers.has("Idempotency-Key") && method !== "GET" && method !== "HEAD") {
        headers.set("Idempotency-Key", `${Date.now()}-${Math.random().toString(16).slice(2)}`);
      }
      const session = getSession();
      if (session?.token && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${session.token}`);

      let body = init.body;
      try {
        const url = new URL(typeof nextInput === "string" ? nextInput : nextInput?.url, location.origin);
        if ((url.pathname.endsWith("/api/kv") || url.pathname.endsWith("/api/kv/batch")) && typeof body === "string") {
          const parsed = JSON.parse(body);
          if (parsed?.key) parsed.key = scopeKey(parsed.key);
          if (parsed?.items && typeof parsed.items === "object") {
            parsed.items = Object.fromEntries(Object.entries(parsed.items).map(([k, v]) => [scopeKey(k), v]));
          }
          body = JSON.stringify(parsed);
        }
      } catch {
        // keep original request body
      }

      return nativeFetch(nextInput, { ...init, headers, body });
    };
  }

  window.EnterpriseCore = Object.freeze({
    companyName: COMPANY_NAME,
    currentTenantId,
    setTenant(id) {
      const next = cleanId(id) || DEFAULT_TENANT_ID;
      setRaw(localStorage, TENANT_KEY, next);
      return next;
    },
    scopeKey,
    getSession,
    setSession,
    clearSession,
    hasPermission,
    audit,
    enqueue,
    notify,
    rolePermissions,
    roleHierarchy,
  });

  document.addEventListener("DOMContentLoaded", () => {
    document.documentElement.dataset.tenant = currentTenantId();
    document.querySelectorAll("[data-company-name]").forEach((el) => {
      el.textContent = COMPANY_NAME;
    });
  });
})();
