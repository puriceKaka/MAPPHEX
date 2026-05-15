const crypto = require("crypto");
const { sendJson, readJsonBody } = require("../api/_lib/http");
const { getStore } = require("../api/_lib/kv-store");
const { getTenantId, scopeTenantKey } = require("../api/_lib/tenant");
const { encryptJson } = require("../api/_lib/crypto-box");
const { appendEvent } = require("../api/_lib/events");
const { assertIdempotent, assertObject, rateLimit, safeString } = require("../api/_lib/security");

const FILES_KEY = "enterprise_files_v1";
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "text/plain",
  "application/json",
  "text/csv",
]);

const decodeBase64 = (value) => {
  const raw = String(value || "").replace(/^data:[^;]+;base64,/, "");
  return Buffer.from(raw, "base64");
};

module.exports = async (req, res) => {
  try {
    rateLimit(req, { scope: "files", limit: 80, windowMs: 60_000 });
    const store = getStore();

    if (req.method === "GET") {
      const tenantId = getTenantId(req);
      const key = scopeTenantKey(tenantId, FILES_KEY);
      const files = (await store.get(key)) || [];
      return sendJson(res, 200, { ok: true, tenantId, files: Array.isArray(files) ? files : [] });
    }

    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
    const body = assertObject(await readJsonBody(req));
    assertIdempotent(req, body);
    const tenantId = getTenantId(req, body);
    const mime = safeString(body.mime || body.type, 120);
    if (!ALLOWED_TYPES.has(mime)) return sendJson(res, 415, { ok: false, error: "Unsupported file type" });

    const bytes = decodeBase64(body.contentBase64);
    if (!bytes.length || bytes.length > MAX_FILE_BYTES) return sendJson(res, 413, { ok: false, error: "Invalid file size" });

    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const record = {
      id: `file-${Date.now()}-${hash.slice(0, 10)}`,
      tenantId,
      name: safeString(body.name || "upload", 160),
      mime,
      size: bytes.length,
      hash,
      encrypted: true,
      content: encryptJson({ base64: bytes.toString("base64") }),
      createdAt: new Date().toISOString(),
      createdBy: safeString(body.createdBy || "system", 120),
    };
    const key = scopeTenantKey(tenantId, FILES_KEY);
    const files = (await store.get(key)) || [];
    const next = [...(Array.isArray(files) ? files : []), record].slice(-500);
    await store.set(key, next);
    await appendEvent(store, tenantId, "file.uploaded", { id: record.id, name: record.name, size: record.size });
    return sendJson(res, 200, { ok: true, file: { ...record, content: undefined } });
  } catch (err) {
    return sendJson(res, Number(err?.statusCode || 500), { ok: false, error: err?.message || "Server error" });
  }
};
