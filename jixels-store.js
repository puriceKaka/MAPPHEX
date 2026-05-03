(() => {
  "use strict";

  const mem = new Map();
  const subscribers = new Set();

  const emit = (event) => {
    for (const cb of subscribers) {
      try {
        cb(event);
      } catch {
        // ignore
      }
    }
  };

  const getKv = () => {
    try {
      return window.JixelsKV || null;
    } catch {
      return null;
    }
  };

  const bootstrap = async (keys) => {
    const kv = getKv();
    if (kv?.bootstrap) return kv.bootstrap(keys);
    return { ok: true, source: "memory", apiState: "down" };
  };

  const refresh = async (keys) => {
    const kv = getKv();
    if (kv?.refresh) return kv.refresh(keys);
    return { ok: true, apiState: "down" };
  };

  const getJson = (key, fallback) => {
    const k = String(key || "").trim();
    if (!k) return fallback;
    const kv = getKv();
    if (kv?.getJson) return kv.getJson(k, fallback);
    if (!mem.has(k)) return fallback;
    const v = mem.get(k);
    return v === null || typeof v === "undefined" ? fallback : v;
  };

  const setJson = (key, value) => {
    const k = String(key || "").trim();
    if (!k) return;
    const kv = getKv();
    if (kv?.setJson) return kv.setJson(k, value);
    mem.set(k, value ?? null);
    emit({ type: "set", key: k, value });
  };

  const remove = (key) => setJson(key, null);

  const subscribe = (cb) => {
    const kv = getKv();
    if (kv?.subscribe) return kv.subscribe(cb);
    if (typeof cb !== "function") return () => {};
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  };

  const flush = async () => {
    const kv = getKv();
    if (kv?.flush) return kv.flush();
    return true;
  };

  Object.defineProperty(window, "JixelsStore", {
    value: Object.freeze({
      bootstrap,
      refresh,
      getJson,
      setJson,
      remove,
      subscribe,
      flush,
      get apiState() {
        const kv = getKv();
        return kv?.apiState || "down";
      },
    }),
    writable: false,
    enumerable: false,
    configurable: false,
  });
})();

