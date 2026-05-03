const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const DEFAULT_FILE_KV_PATH = path.resolve(process.cwd(), "server", "data", "kv.json");

const safeJsonParse = (raw, fallback) => {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const hasUpstash = () =>
  !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

const normalizeUrl = (u) => String(u || "").replace(/\/+$/, "");

const upstashFetch = async (url, opts = {}) => {
  const token = process.env.KV_REST_API_TOKEN;
  const headers = { ...(opts.headers || {}), Authorization: `Bearer ${token}` };
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    const err = new Error("Upstash request failed");
    err.statusCode = 502;
    err.details = { status: res.status, data };
    throw err;
  }
  if (typeof data?.error === "string" && data.error) {
    const err = new Error(data.error);
    err.statusCode = 502;
    err.details = data;
    throw err;
  }
  return data.result;
};

const upstashFetchTx = async (url, opts = {}) => {
  const token = process.env.KV_REST_API_TOKEN;
  const headers = { ...(opts.headers || {}), Authorization: `Bearer ${token}` };
  const res = await fetch(url, { ...opts, headers });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !Array.isArray(data)) {
    const err = new Error("Upstash transaction failed");
    err.statusCode = 502;
    err.details = { status: res.status, data };
    throw err;
  }
  return data;
};

const upstashGet = async (key) => {
  const base = normalizeUrl(process.env.KV_REST_API_URL);
  const url = `${base}/get/${encodeURIComponent(key)}`;
  const raw = await upstashFetch(url, { method: "GET" });
  if (raw === null || typeof raw === "undefined") return null;
  if (typeof raw !== "string") return raw;
  return safeJsonParse(raw, raw);
};

const upstashMget = async (keys) => {
  const base = normalizeUrl(process.env.KV_REST_API_URL);
  const pathSegs = keys.map((k) => encodeURIComponent(k)).join("/");
  const url = `${base}/mget/${pathSegs}`;
  const arr = await upstashFetch(url, { method: "GET" });
  const out = {};
  for (let i = 0; i < keys.length; i++) {
    const raw = Array.isArray(arr) ? arr[i] : null;
    if (raw === null || typeof raw === "undefined") out[keys[i]] = null;
    else if (typeof raw !== "string") out[keys[i]] = raw;
    else out[keys[i]] = safeJsonParse(raw, raw);
  }
  return out;
};

const upstashSet = async (key, value) => {
  const base = normalizeUrl(process.env.KV_REST_API_URL);
  const url = `${base}/set/${encodeURIComponent(key)}`;
  const raw = JSON.stringify(value ?? null);
  await upstashFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: raw,
  });
};

const upstashSetManyAtomic = async (items) => {
  const base = normalizeUrl(process.env.KV_REST_API_URL);
  const url = `${base}/multi-exec`;
  const tx = Object.entries(items).map(([k, v]) => ["SET", k, JSON.stringify(v ?? null)]);
  const resArr = await upstashFetchTx(url, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(tx),
  });
  const errors = Array.isArray(resArr)
    ? resArr.filter((x) => x && typeof x === "object" && typeof x.error === "string")
    : [];
  if (errors.length) {
    const err = new Error("Upstash multi-exec failed");
    err.statusCode = 502;
    err.details = errors[0];
    throw err;
  }
  return resArr;
};

const ensureFileKv = async (kvPath) => {
  const dir = path.dirname(kvPath);
  await fsp.mkdir(dir, { recursive: true });
  try {
    await fsp.access(kvPath, fs.constants.F_OK);
  } catch {
    const seed = { version: 1, updatedAt: new Date().toISOString(), items: {} };
    await fsp.writeFile(kvPath, JSON.stringify(seed, null, 2), "utf8");
  }
};

const fileReadAll = async (kvPath) => {
  await ensureFileKv(kvPath);
  const raw = await fsp.readFile(kvPath, "utf8");
  const data = safeJsonParse(raw, null);
  if (!data || typeof data !== "object") return { version: 1, updatedAt: new Date().toISOString(), items: {} };
  if (!data.items || typeof data.items !== "object") data.items = {};
  return data;
};

const fileWriteAll = async (kvPath, next) => {
  const payload = {
    version: Number(next?.version || 1) || 1,
    updatedAt: new Date().toISOString(),
    items: next?.items && typeof next.items === "object" ? next.items : {},
  };
  await ensureFileKv(kvPath);
  const tmp = `${kvPath}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(payload, null, 2), "utf8");
  await fsp.rename(tmp, kvPath);
  return payload;
};

const fileGet = async (key, kvPath) => {
  const store = await fileReadAll(kvPath);
  return Object.prototype.hasOwnProperty.call(store.items, key) ? store.items[key] : null;
};

const fileMget = async (keys, kvPath) => {
  const store = await fileReadAll(kvPath);
  const items = {};
  for (const k of keys) items[k] = Object.prototype.hasOwnProperty.call(store.items, k) ? store.items[k] : null;
  return items;
};

const fileSet = async (key, value, kvPath) => {
  const store = await fileReadAll(kvPath);
  store.items[key] = value ?? null;
  store.version = Number(store.version || 1) + 1;
  await fileWriteAll(kvPath, store);
};

const fileSetManyAtomic = async (items, kvPath) => {
  const store = await fileReadAll(kvPath);
  for (const [k, v] of Object.entries(items)) store.items[k] = v ?? null;
  store.version = Number(store.version || 1) + 1;
  await fileWriteAll(kvPath, store);
};

const getStore = () => {
  if (hasUpstash()) {
    return {
      driver: "upstash",
      get: upstashGet,
      mget: upstashMget,
      set: upstashSet,
      setManyAtomic: upstashSetManyAtomic,
    };
  }

  const kvPath = process.env.JIXELS_KV_FILE_PATH
    ? path.resolve(process.cwd(), process.env.JIXELS_KV_FILE_PATH)
    : DEFAULT_FILE_KV_PATH;

  return {
    driver: "file",
    kvPath,
    get: (key) => fileGet(key, kvPath),
    mget: (keys) => fileMget(keys, kvPath),
    set: (key, value) => fileSet(key, value, kvPath),
    setManyAtomic: (items) => fileSetManyAtomic(items, kvPath),
  };
};

module.exports = { getStore };
