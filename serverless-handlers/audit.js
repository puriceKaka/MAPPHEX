const { sendJson, readJsonBody } = require("../api/_lib/http");
const { getStore } = require("../api/_lib/kv-store");
const { getTenantId, scopeTenantKey } = require("../api/_lib/tenant");

const AUDIT_KEY = "enterprise_audit_v1";

module.exports = async (req, res) => {
  try {
    const body = req.method === "POST" ? await readJsonBody(req) : null;
    const tenantId = getTenantId(req, body);
    const key = scopeTenantKey(tenantId, AUDIT_KEY);
    const store = getStore();
    const rows = (await store.get(key)) || [];

    if (req.method === "GET") return sendJson(res, 200, { ok: true, tenantId, audit: Array.isArray(rows) ? rows.slice(-500) : [] });
    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

    const entry = {
      id: `audit-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: new Date().toISOString(),
      tenantId,
      actor: String(body?.actor || "system"),
      action: String(body?.action || "event"),
      detail: body?.detail || {},
    };
    await store.set(key, [...(Array.isArray(rows) ? rows : []), entry].slice(-2000));
    return sendJson(res, 200, { ok: true, entry });
  } catch {
    return sendJson(res, 500, { ok: false, error: "Server error" });
  }
};
