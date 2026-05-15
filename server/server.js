/* eslint-disable no-console */
const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { setSecurityHeaders } = require("../api/_lib/security");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(__dirname, "data");
const KV_PATH = path.resolve(DATA_DIR, "kv.json");

const MAX_BODY_BYTES = 2_000_000; // 2MB
let kvWriteQueue = Promise.resolve();
let eventSeq = 0;
const eventLog = [];
const sseClients = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const safeJsonParse = (raw, fallback) => {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const ensureDataDir = async () => {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(KV_PATH, fs.constants.F_OK);
  } catch {
    await fsp.writeFile(KV_PATH, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), items: {} }, null, 2), "utf8");
  }
};

const readKv = async () => {
  await ensureDataDir();
  const raw = await fsp.readFile(KV_PATH, "utf8");
  const data = safeJsonParse(raw, null);
  if (!data || typeof data !== "object") return { version: 1, updatedAt: new Date().toISOString(), items: {} };
  if (!data.items || typeof data.items !== "object") data.items = {};
  return data;
};

const writeKv = async (next) => {
  const payload = {
    version: Number(next?.version || 1) || 1,
    updatedAt: new Date().toISOString(),
    items: next?.items && typeof next.items === "object" ? next.items : {},
  };
  await ensureDataDir();
  await fsp.writeFile(KV_PATH, JSON.stringify(payload, null, 2), "utf8");
  return payload;
};

const readBodyJson = async (req) => {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Payload too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return null;
  const parsed = safeJsonParse(raw, null);
  if (parsed === null) throw Object.assign(new Error("Invalid JSON"), { statusCode: 400 });
  return parsed;
};

const sendJson = (res, statusCode, obj) => {
  const body = JSON.stringify(obj ?? null);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  setSecurityHeaders(res);
  res.end(body);
};

const sendText = (res, statusCode, text) => {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  setSecurityHeaders(res);
  res.end(String(text || ""));
};

const notFound = (res) => sendText(res, 404, "Not Found");

const badRequest = (res, message) => sendJson(res, 400, { ok: false, error: String(message || "Bad request") });

const ok = (res, data = {}) => sendJson(res, 200, { ok: true, ...data });

const publishEvent = (tenantId, type, payload = {}) => {
  const event = {
    seq: ++eventSeq,
    id: `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    tenantId: tenantId || "default-company",
    type,
    payload,
  };
  eventLog.push(event);
  while (eventLog.length > 1000) eventLog.shift();
  for (const client of sseClients.values()) {
    if (client.tenantId !== event.tenantId) continue;
    client.res.write(`id: ${event.seq}\n`);
    client.res.write(`event: ${event.type}\n`);
    client.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  return event;
};

const handleRealtime = async (req, res, url) => {
  const tenantId = getTenantId(req);
  const wantsSse = String(req.headers.accept || "").includes("text/event-stream");
  const after = Number(url.searchParams.get("after") || 0) || 0;

  if (!wantsSse) {
    const events = eventLog.filter((event) => event.tenantId === tenantId && Number(event.seq || 0) > after).slice(-200);
    return ok(res, { tenantId, events });
  }

  const id = crypto.randomBytes(8).toString("hex");
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, tenantId })}\n\n`);
  sseClients.set(id, { tenantId, res });
  req.on("close", () => sseClients.delete(id));
};

const sanitizeKey = (keyRaw) => {
  const key = String(keyRaw || "").trim();
  if (!key) return null;
  if (key.length > 180) return null;
  // Disallow path tricks; keys should look like localStorage keys.
  if (key.includes("/") || key.includes("\\") || key.includes("\0")) return null;
  return key;
};

const cleanTenantId = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

const getTenantId = (req, body = null) =>
  cleanTenantId(req.headers["x-tenant-id"] || body?.tenantId) || "default-company";

const scopeTenantKey = (tenantId, key) => {
  const k = String(key || "").trim();
  if (!k || k.startsWith("tenant:")) return k;
  return `tenant:${cleanTenantId(tenantId) || "default-company"}:${k}`;
};

const unscopedTenantKey = (key) => {
  const value = String(key || "");
  const match = value.match(/^tenant:[^:]+:(.+)$/);
  return match ? match[1] : value;
};

const withKvWriteLock = async (fn) => {
  const prev = kvWriteQueue;
  let release;
  kvWriteQueue = new Promise((resolve) => {
    release = resolve;
  });
  await prev.catch(() => null);
  try {
    return await fn();
  } finally {
    release();
  }
};

const parseUrl = (req) => {
  const base = `http://${req.headers.host || "localhost"}`;
  return new URL(req.url || "/", base);
};

const isSafePath = (filePath) => {
  const rel = path.relative(ROOT_DIR, filePath);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
};

const serveStatic = async (req, res, url) => {
  let pathname = decodeURIComponent(url.pathname || "/");
  if (pathname === "/") pathname = "/index.html";
  if (pathname === "/workspace") pathname = "/organization-workspace.html";
  if (pathname === "/super-admin.html") return notFound(res);
  if (pathname === "/_internal/mapphex-control") {
    const expected = process.env.SUPER_ADMIN_KEY || process.env.INTERNAL_ADMIN_KEY || "mapphex-internal";
    const provided = String(url.searchParams.get("key") || "").trim();
    if (provided !== expected) return notFound(res);
    pathname = "/super-admin.html";
  }

  const filePath = path.resolve(ROOT_DIR, `.${pathname}`);
  if (!isSafePath(filePath)) return notFound(res);

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return notFound(res);

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    const data = await fsp.readFile(filePath);
    const cacheControl = [".png", ".jpg", ".jpeg", ".svg", ".css", ".js"].includes(ext)
      ? "public, max-age=31536000, immutable"
      : "no-store";
    res.statusCode = 200;
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Length", data.length);
    res.setHeader("Cache-Control", cacheControl);
    setSecurityHeaders(res);
    res.end(data);
  } catch {
    notFound(res);
  }
};

const handleApi = async (req, res, url) => {
  req.query = Object.fromEntries(url.searchParams.entries());

  if (url.pathname === "/api/realtime" && req.method === "GET") {
    return handleRealtime(req, res, url);
  }

  if (req.method === "GET" && url.pathname === "/api/health") {
    return ok(res, { time: new Date().toISOString(), realtimeClients: sseClients.size });
  }

  if (url.pathname === "/api/kv" && req.method === "GET") {
    const tenantId = getTenantId(req);
    const key = sanitizeKey(scopeTenantKey(tenantId, url.searchParams.get("key")));
    const keysRaw = String(url.searchParams.get("keys") || "").trim();

    const store = await readKv();

    if (key) {
      return ok(res, { key, value: Object.prototype.hasOwnProperty.call(store.items, key) ? store.items[key] : null });
    }

    if (keysRaw) {
      const keys = keysRaw
        .split(",")
        .map((k) => sanitizeKey(scopeTenantKey(tenantId, k)))
        .filter(Boolean);
      const items = {};
      for (const k of keys) {
        const value = Object.prototype.hasOwnProperty.call(store.items, k) ? store.items[k] : null;
        items[k] = value;
        items[unscopedTenantKey(k)] = value;
      }
      return ok(res, { items });
    }

    return badRequest(res, "Provide ?key=... or ?keys=...");
  }

  if (url.pathname === "/api/kv" && req.method === "POST") {
    const body = await readBodyJson(req);
    if (!body || typeof body !== "object") return badRequest(res, "Invalid body");
    const tenantId = getTenantId(req, body);
    const key = sanitizeKey(scopeTenantKey(tenantId, body.key));
    if (!key) return badRequest(res, "Invalid key");

    const saved = await withKvWriteLock(async () => {
      const store = await readKv();
      store.items[key] = body.value ?? null;
      store.version = Number(store.version || 1) + 1;
      return writeKv(store);
    });

    publishEvent(tenantId, "kv.updated", { key });
    return ok(res, { key, tenantId, version: saved.version, updatedAt: saved.updatedAt });
  }

  if (url.pathname === "/api/kv/batch" && req.method === "POST") {
    const body = await readBodyJson(req);
    if (!body || typeof body !== "object") return badRequest(res, "Invalid body");
    const items = body.items;
    if (!items || typeof items !== "object") return badRequest(res, "Invalid items");
    const tenantId = getTenantId(req, body);

    let changed = 0;
    const saved = await withKvWriteLock(async () => {
      const store = await readKv();
      for (const [kRaw, v] of Object.entries(items)) {
        const k = sanitizeKey(scopeTenantKey(tenantId, kRaw));
        if (!k) continue;
        store.items[k] = v ?? null;
        changed += 1;
      }
      store.version = Number(store.version || 1) + 1;
      return writeKv(store);
    });
    publishEvent(tenantId, "kv.batch.updated", { changed });
    return ok(res, { changed, tenantId, version: saved.version, updatedAt: saved.updatedAt });
  }

  if (url.pathname === "/api/assets/sync") {
    return require("../serverless-handlers/assets/sync")(req, res);
  }

  if (url.pathname === "/api/auth/session") {
    return require("../serverless-handlers/auth/session")(req, res);
  }

  if (url.pathname === "/api/tasks") {
    return require("../serverless-handlers/tasks")(req, res);
  }

  if (url.pathname === "/api/audit") {
    return require("../serverless-handlers/audit")(req, res);
  }

  if (url.pathname === "/api/modules") {
    return require("../serverless-handlers/modules")(req, res);
  }

  if (url.pathname === "/api/organizations") {
    return require("../serverless-handlers/organizations")(req, res);
  }

  if (url.pathname === "/api/org-admin") {
    return require("../serverless-handlers/org-admin")(req, res);
  }

  if (url.pathname === "/api/platform-monitoring") {
    return require("../serverless-handlers/platform-monitoring")(req, res);
  }

  if (url.pathname === "/api/files") {
    return require("../serverless-handlers/files")(req, res);
  }

  if (url.pathname === "/api/realtime") {
    return require("../serverless-handlers/realtime")(req, res);
  }

  return notFound(res);
};

const withCors = (req, res) => {
  // Same-origin by default. Allow local dev tools.
  const origin = String(req.headers.origin || "");
  if (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1")) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,Idempotency-Key,X-Asset-Sync-Token,X-CSRF-Token,X-Tenant-ID");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  }
};

const server = http.createServer(async (req, res) => {
  withCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = parseUrl(req);
  try {
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    return await serveStatic(req, res, url);
  } catch (err) {
    const statusCode = Number(err?.statusCode || 500) || 500;
    const id = crypto.randomBytes(8).toString("hex");
    console.error(`[${id}]`, err);
    return sendJson(res, statusCode, { ok: false, error: "Server error", id });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Enterprise server running at http://${HOST}:${PORT}`);
  console.log(`KV store: ${KV_PATH}`);
});
