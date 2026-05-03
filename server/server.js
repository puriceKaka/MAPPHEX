/* eslint-disable no-console */
const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(__dirname, "data");
const KV_PATH = path.resolve(DATA_DIR, "kv.json");

const MAX_BODY_BYTES = 2_000_000; // 2MB

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
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(body);
};

const sendText = (res, statusCode, text) => {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(String(text || ""));
};

const notFound = (res) => sendText(res, 404, "Not Found");

const badRequest = (res, message) => sendJson(res, 400, { ok: false, error: String(message || "Bad request") });

const ok = (res, data = {}) => sendJson(res, 200, { ok: true, ...data });

const sanitizeKey = (keyRaw) => {
  const key = String(keyRaw || "").trim();
  if (!key) return null;
  if (key.length > 180) return null;
  // Disallow path tricks; keys should look like localStorage keys.
  if (key.includes("/") || key.includes("\\") || key.includes("\0")) return null;
  return key;
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

  const filePath = path.resolve(ROOT_DIR, `.${pathname}`);
  if (!isSafePath(filePath)) return notFound(res);

  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return notFound(res);

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || "application/octet-stream";
    const data = await fsp.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": mime,
      "Content-Length": data.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    });
    res.end(data);
  } catch {
    notFound(res);
  }
};

const handleApi = async (req, res, url) => {
  if (req.method === "GET" && url.pathname === "/api/health") {
    return ok(res, { time: new Date().toISOString() });
  }

  if (url.pathname === "/api/kv" && req.method === "GET") {
    const key = sanitizeKey(url.searchParams.get("key"));
    const keysRaw = String(url.searchParams.get("keys") || "").trim();

    const store = await readKv();

    if (key) {
      return ok(res, { key, value: Object.prototype.hasOwnProperty.call(store.items, key) ? store.items[key] : null });
    }

    if (keysRaw) {
      const keys = keysRaw
        .split(",")
        .map((k) => sanitizeKey(k))
        .filter(Boolean);
      const items = {};
      for (const k of keys) items[k] = Object.prototype.hasOwnProperty.call(store.items, k) ? store.items[k] : null;
      return ok(res, { items });
    }

    return badRequest(res, "Provide ?key=... or ?keys=...");
  }

  if (url.pathname === "/api/kv" && req.method === "POST") {
    const body = await readBodyJson(req);
    if (!body || typeof body !== "object") return badRequest(res, "Invalid body");
    const key = sanitizeKey(body.key);
    if (!key) return badRequest(res, "Invalid key");

    const store = await readKv();
    store.items[key] = body.value ?? null;
    store.version = Number(store.version || 1) + 1;
    const saved = await writeKv(store);

    return ok(res, { key, version: saved.version, updatedAt: saved.updatedAt });
  }

  if (url.pathname === "/api/kv/batch" && req.method === "POST") {
    const body = await readBodyJson(req);
    if (!body || typeof body !== "object") return badRequest(res, "Invalid body");
    const items = body.items;
    if (!items || typeof items !== "object") return badRequest(res, "Invalid items");

    const store = await readKv();
    let changed = 0;
    for (const [kRaw, v] of Object.entries(items)) {
      const k = sanitizeKey(kRaw);
      if (!k) continue;
      store.items[k] = v ?? null;
      changed += 1;
    }
    store.version = Number(store.version || 1) + 1;
    const saved = await writeKv(store);
    return ok(res, { changed, version: saved.version, updatedAt: saved.updatedAt });
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
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
  console.log(`Jixels server running at http://${HOST}:${PORT}`);
  console.log(`KV store: ${KV_PATH}`);
});
