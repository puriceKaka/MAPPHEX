const { sendJson, readJsonBody } = require("../_lib/http");
const { sanitizeKey } = require("../_lib/keys");
const { getStore } = require("../_lib/kv-store");

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

  const store = getStore();

  try {
    const body = await readJsonBody(req);
    if (!body || typeof body !== "object") return sendJson(res, 400, { ok: false, error: "Invalid body" });
    const itemsRaw = body.items;
    if (!itemsRaw || typeof itemsRaw !== "object") return sendJson(res, 400, { ok: false, error: "Invalid items" });

    const items = {};
    let changed = 0;
    for (const [kRaw, v] of Object.entries(itemsRaw)) {
      const k = sanitizeKey(kRaw);
      if (!k) continue;
      items[k] = v ?? null;
      changed += 1;
    }

    await store.setManyAtomic(items);
    return sendJson(res, 200, { ok: true, changed });
  } catch (err) {
    const status = Number(err?.statusCode || 500) || 500;
    return sendJson(res, status, { ok: false, error: "Server error" });
  }
};

