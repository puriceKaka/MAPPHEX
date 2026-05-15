const { sendJson, readJsonBody } = require("../api/_lib/http");
const { getStore } = require("../api/_lib/kv-store");
const { getTenantId, scopeTenantKey } = require("../api/_lib/tenant");

const TASK_KEY = "enterprise_task_queue_v1";

module.exports = async (req, res) => {
  try {
    const body = req.method === "POST" ? await readJsonBody(req) : null;
    const tenantId = getTenantId(req, body);
    const key = scopeTenantKey(tenantId, TASK_KEY);
    const store = getStore();
    const queue = (await store.get(key)) || [];

    if (req.method === "GET") return sendJson(res, 200, { ok: true, tenantId, tasks: Array.isArray(queue) ? queue : [] });
    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

    const task = {
      id: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: String(body?.type || "task"),
      payload: body?.payload || {},
      status: "queued",
      tenantId,
      createdAt: new Date().toISOString(),
    };
    const next = [...(Array.isArray(queue) ? queue : []), task].slice(-1000);
    await store.set(key, next);
    return sendJson(res, 200, { ok: true, task });
  } catch {
    return sendJson(res, 500, { ok: false, error: "Server error" });
  }
};
