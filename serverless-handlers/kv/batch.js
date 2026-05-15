const { sendJson, readJsonBody } = require("../../api/_lib/http");
const { sanitizeKey } = require("../../api/_lib/keys");
const { getStore } = require("../../api/_lib/kv-store");
const { getTenantId, scopeTenantKey } = require("../../api/_lib/tenant");
const { appendEvent } = require("../../api/_lib/events");
const { assertIdempotent, assertObject, assertSameOrigin, rateLimit } = require("../../api/_lib/security");

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

  const store = getStore();

  try {
    rateLimit(req, { scope: "kv-batch", limit: 180, windowMs: 60_000 });
    assertSameOrigin(req);
    const body = assertObject(await readJsonBody(req));
    assertIdempotent(req, body);
    const itemsRaw = body.items;
    if (!itemsRaw || typeof itemsRaw !== "object") return sendJson(res, 400, { ok: false, error: "Invalid items" });
    const tenantId = getTenantId(req, body);

    const items = {};
    let changed = 0;
    for (const [kRaw, v] of Object.entries(itemsRaw)) {
      const k = sanitizeKey(scopeTenantKey(tenantId, kRaw));
      if (!k) continue;
      items[k] = v ?? null;
      changed += 1;
    }

    await store.setManyAtomic(items);
    await appendEvent(store, tenantId, "kv.batch.updated", { changed, keys: Object.keys(items).slice(0, 25) });
    return sendJson(res, 200, { ok: true, changed, tenantId });
  } catch (err) {
    const status = Number(err?.statusCode || 500) || 500;
    return sendJson(res, status, { ok: false, error: status >= 500 ? "Server error" : String(err.message || "Request failed") });
  }
};
