(() => {
  "use strict";

  const API_TIMEOUT_MS = 6500;
  const FLUSH_DEBOUNCE_MS = 120;
  const FLUSH_RETRY_MS = 1200;
  const IDB_NAME = "jixels_erp_indexeddb_v1";
  const IDB_STORE = "kv";

  const mem = new Map();
  const pending = new Map();
  const subscribers = new Set();

  let apiState = "unknown"; // "unknown" | "ok" | "down"
  let idbState = "unknown"; // "unknown" | "ok" | "down"
  let idbPromise = null;
  let flushTimer = null;
  let retryTimer = null;
  let flushInFlight = false;
  let bc = null;

  try {
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel("jixels_kv_v1");
      bc.addEventListener("message", (ev) => {
        const msg = ev?.data;
        if (!msg || typeof msg !== "object") return;
        if (msg.type !== "set") return;
        const key = String(msg.key || "").trim();
        if (!key) return;
        setMem(key, msg.value);
      });
    }
  } catch {
    bc = null;
  }

  const uniqueStrings = (arr) =>
    Array.from(
      new Set(
        (Array.isArray(arr) ? arr : [])
          .map((x) => String(x || "").trim())
          .filter(Boolean),
      ),
    );

  const emit = (event) => {
    for (const cb of subscribers) {
      try {
        cb(event);
      } catch {
        // ignore subscriber errors
      }
    }
  };

  const fetchJson = async (url, opts) => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...opts, signal: controller.signal });
      const data = await res.json().catch(() => null);
      return { res, data };
    } finally {
      clearTimeout(t);
    }
  };

  const openIdb = () => {
    if (!("indexedDB" in window)) {
      idbState = "down";
      return Promise.resolve(null);
    }
    if (idbPromise) return idbPromise;
    idbPromise = new Promise((resolve) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => {
        idbState = "ok";
        resolve(req.result);
      };
      req.onerror = () => {
        idbState = "down";
        resolve(null);
      };
      req.onblocked = () => {
        idbState = "down";
        resolve(null);
      };
    });
    return idbPromise;
  };

  const idbGetMany = async (keys) => {
    const db = await openIdb();
    const want = uniqueStrings(keys);
    const items = {};
    if (!db || want.length === 0) return items;

    await Promise.all(
      want.map(
        (key) =>
          new Promise((resolve) => {
            try {
              const tx = db.transaction(IDB_STORE, "readonly");
              const store = tx.objectStore(IDB_STORE);
              const req = store.get(key);
              req.onsuccess = () => {
                if (typeof req.result !== "undefined") items[key] = req.result;
                resolve();
              };
              req.onerror = () => resolve();
            } catch {
              resolve();
            }
          }),
      ),
    );
    return items;
  };

  const idbSetMany = async (items) => {
    const db = await openIdb();
    if (!db || !items || typeof items !== "object") return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(IDB_STORE, "readwrite");
        const store = tx.objectStore(IDB_STORE);
        for (const [key, value] of Object.entries(items)) store.put(value ?? null, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  };

  const setMem = (key, value) => {
    mem.set(key, value);
    emit({ type: "set", key, value });
  };

  const tryHydrate = async (keys) => {
    const want = uniqueStrings(keys);
    let missing = want.filter((k) => !mem.has(k));
    if (missing.length === 0) return { ok: true, source: "cache", apiState };

    const localItems = await idbGetMany(missing);
    for (const [k, v] of Object.entries(localItems)) {
      if (v === null || typeof v === "undefined") continue;
      setMem(k, v);
    }

    missing = want.filter((k) => !mem.has(k));
    if (missing.length === 0) return { ok: true, source: "indexeddb", apiState, idbState };

    try {
      const qs = encodeURIComponent(missing.join(","));
      const { res, data } = await fetchJson(`/api/kv?keys=${qs}`, { method: "GET" });
      if (!res.ok || !data || data.ok !== true || !data.items || typeof data.items !== "object") {
        apiState = "down";
        return { ok: false, source: "api", apiState };
      }
      apiState = "ok";
      for (const k of missing) {
        const v = Object.prototype.hasOwnProperty.call(data.items, k) ? data.items[k] : null;
        if (v === null || typeof v === "undefined") continue;
        setMem(k, v);
      }
      await idbSetMany(data.items);
      return { ok: true, source: "api", apiState };
    } catch {
      apiState = "down";
      return { ok: Object.keys(localItems).length > 0, source: "indexeddb", apiState, idbState };
    }
  };

  const flushPending = async () => {
    if (flushInFlight) return;
    if (pending.size === 0) return;

    flushInFlight = true;
    const items = Object.fromEntries(pending.entries());
    pending.clear();

    try {
      const { res, data } = await fetchJson("/api/kv/batch", {
        method: "POST",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok || !data || data.ok !== true) throw new Error("KV flush failed");
      await idbSetMany(items);
      apiState = "ok";
      emit({ type: "flush", ok: true, changed: Number(data.changed || 0) || 0 });
    } catch {
      apiState = "down";
      for (const [k, v] of Object.entries(items)) pending.set(k, v);
      emit({ type: "flush", ok: false });
      if (!retryTimer) {
        retryTimer = setTimeout(() => {
          retryTimer = null;
          flushPending().catch(() => null);
        }, FLUSH_RETRY_MS);
      }
    } finally {
      flushInFlight = false;
    }
  };

  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushPending().catch(() => null);
    }, FLUSH_DEBOUNCE_MS);
  };

  const getJson = (key, fallback) => {
    const k = String(key || "").trim();
    if (!k) return fallback;
    if (!mem.has(k)) return fallback;
    const v = mem.get(k);
    if (v === null || typeof v === "undefined") return fallback;
    return v;
  };

  const setJson = (key, value) => {
    const k = String(key || "").trim();
    if (!k) return;
    setMem(k, value);
    idbSetMany({ [k]: value }).catch(() => null);
    pending.set(k, value ?? null);
    scheduleFlush();
    try {
      bc?.postMessage?.({ type: "set", key: k, value });
    } catch {
      // ignore
    }
  };

  const refresh = async (keys) => {
    const want = uniqueStrings(keys);
    if (want.length === 0) return { ok: true, apiState };
    try {
      const qs = encodeURIComponent(want.join(","));
      const { res, data } = await fetchJson(`/api/kv?keys=${qs}`, { method: "GET" });
      if (!res.ok || !data || data.ok !== true || !data.items || typeof data.items !== "object") {
        apiState = "down";
        return { ok: false, apiState };
      }
      apiState = "ok";
      for (const k of want) {
        const v = Object.prototype.hasOwnProperty.call(data.items, k) ? data.items[k] : null;
        if (v === null || typeof v === "undefined") continue;
        setMem(k, v);
      }
      await idbSetMany(data.items);
      return { ok: true, apiState };
    } catch {
      apiState = "down";
      const localItems = await idbGetMany(want);
      for (const [k, v] of Object.entries(localItems)) {
        if (v === null || typeof v === "undefined") continue;
        setMem(k, v);
      }
      return { ok: Object.keys(localItems).length > 0, apiState, idbState };
    }
  };

  const subscribe = (cb) => {
    if (typeof cb !== "function") return () => {};
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  };

  window.JixelsKV = Object.freeze({
    bootstrap: tryHydrate,
    refresh,
    getJson,
    setJson,
    subscribe,
    flush: flushPending,
    get apiState() {
      return apiState;
    },
    get idbState() {
      return idbState;
    },
  });
})();
