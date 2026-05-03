const { sendJson, readJsonBody } = require("./_lib/http");
const { sanitizeKey } = require("./_lib/keys");
const { getStore } = require("./_lib/kv-store");

module.exports = async (req, res) => {
  const store = getStore();

  try {
    if (req.method === "GET") {
      const key = sanitizeKey(req.query?.key);
      const keysRaw = String(req.query?.keys || "").trim();

      if (key) {
        const value = await store.get(key);
        return sendJson(res, 200, { ok: true, key, value });
      }

      if (keysRaw) {
        const keys = keysRaw
          .split(",")
          .map((k) => sanitizeKey(k))
          .filter(Boolean);
        if (!keys.length) return sendJson(res, 400, { ok: false, error: "Invalid keys" });
        const items = await store.mget(keys);
        return sendJson(res, 200, { ok: true, items });
      }

      return sendJson(res, 400, { ok: false, error: "Provide ?key=... or ?keys=..." });
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (!body || typeof body !== "object") return sendJson(res, 400, { ok: false, error: "Invalid body" });
      const key = sanitizeKey(body.key);
      if (!key) return sendJson(res, 400, { ok: false, error: "Invalid key" });
      await store.set(key, body.value ?? null);
      return sendJson(res, 200, { ok: true, key });
    }

    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  } catch (err) {
    const status = Number(err?.statusCode || 500) || 500;
    return sendJson(res, status, { ok: false, error: "Server error" });
  }
};
