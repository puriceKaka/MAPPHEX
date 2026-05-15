const { sendJson, readJsonBody } = require("../api/_lib/http");
const { sanitizeKey } = require("../api/_lib/keys");
const { getStore } = require("../api/_lib/kv-store");
const { getTenantId, scopeTenantKey } = require("../api/_lib/tenant");
const { appendEvent } = require("../api/_lib/events");
const { assertIdempotent, assertObject, assertSameOrigin, rateLimit } = require("../api/_lib/security");

module.exports = async (req, res) => {
  const store = getStore();

  try {
    rateLimit(req, { scope: "kv", limit: 240, windowMs: 60_000 });
    assertSameOrigin(req);

    if (req.method === "GET") {
      const tenantId = getTenantId(req);
      const key = sanitizeKey(scopeTenantKey(tenantId, req.query?.key));
      const keysRaw = String(req.query?.keys || "").trim();

      if (key) {
        const value = await store.get(key);
        return sendJson(res, 200, { ok: true, key, value });
      }

      if (keysRaw) {
        const keys = keysRaw
          .split(",")
          .map((k) => sanitizeKey(scopeTenantKey(tenantId, k)))
          .filter(Boolean);
        if (!keys.length) return sendJson(res, 400, { ok: false, error: "Invalid keys" });
        const items = await store.mget(keys);
        return sendJson(res, 200, { ok: true, items });
      }

      return sendJson(res, 400, { ok: false, error: "Provide ?key=... or ?keys=..." });
    }

    if (req.method === "POST") {
      const body = assertObject(await readJsonBody(req));
      assertIdempotent(req, body);
      const tenantId = getTenantId(req, body);
      const key = sanitizeKey(scopeTenantKey(tenantId, body.key));
      if (!key) return sendJson(res, 400, { ok: false, error: "Invalid key" });
      await store.set(key, body.value ?? null);
      await appendEvent(store, tenantId, "kv.updated", { key });
      return sendJson(res, 200, { ok: true, key, tenantId });
    }

    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    const status = Number(err?.statusCode || 500) || 500;
    return sendJson(res, status, { ok: false, error: status >= 500 ? "Server error" : String(err.message || "Request failed") });
  }
};
