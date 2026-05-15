const { sendJson, readJsonBody } = require("../api/_lib/http");
const { getStore } = require("../api/_lib/kv-store");
const { getTenantId, scopeTenantKey } = require("../api/_lib/tenant");
const { assertObject, rateLimit, safeString } = require("../api/_lib/security");
const { appendEvent } = require("../api/_lib/events");

const MODULES_KEY = "enterprise_modules_v1";

const catalog = [
  { id: "dashboard", label: "Executive Dashboard", sectors: ["all"], permissions: ["reports.read"] },
  { id: "inventory", label: "Inventory & Stock", sectors: ["company", "pharmacy", "supermarket", "retail", "warehouse", "restaurant"], permissions: ["inventory.manage"] },
  { id: "pos", label: "Sales & POS", sectors: ["company", "pharmacy", "supermarket", "retail", "restaurant"], permissions: ["sales.manage"] },
  { id: "orders", label: "Orders & Fulfillment", sectors: ["company", "online", "logistics", "retail", "restaurant"], permissions: ["orders.manage"] },
  { id: "logistics", label: "Fleet & Delivery Tracking", sectors: ["logistics", "warehouse", "online"], permissions: ["logistics.manage"] },
  { id: "pharmacy", label: "Pharmacy Controls", sectors: ["pharmacy"], permissions: ["pharmacy.manage"] },
  { id: "finance", label: "Finance & Payments", sectors: ["all"], permissions: ["finance.manage"] },
  { id: "hr", label: "HR & Staff", sectors: ["all"], permissions: ["hr.manage"] },
  { id: "crm", label: "Customers & CRM", sectors: ["all"], permissions: ["customers.manage"] },
  { id: "documents", label: "Files & Documents", sectors: ["all"], permissions: ["documents.manage"] },
  { id: "assetwise", label: "AssetWise Portal", sectors: ["all"], permissions: ["assets.manage"], url: "https://assert-management.lovable.app/" },
  { id: "school", label: "School Operations", sectors: ["school"], permissions: ["school.manage"] },
  { id: "service", label: "Service Desk", sectors: ["company", "service", "agency", "corporate"], permissions: ["service.manage"] },
];

const defaultConfig = {
  businessType: "company",
  enabled: ["dashboard", "inventory", "pos", "orders", "finance", "hr", "crm", "documents", "assetwise"],
  catalog,
};

module.exports = async (req, res) => {
  try {
    rateLimit(req, { scope: "modules", limit: 120, windowMs: 60_000 });
    const store = getStore();
    const body = req.method === "POST" ? assertObject(await readJsonBody(req)) : null;
    const tenantId = getTenantId(req, body);
    const key = scopeTenantKey(tenantId, MODULES_KEY);
    const existing = (await store.get(key)) || defaultConfig;

    if (req.method === "GET") return sendJson(res, 200, { ok: true, tenantId, modules: existing, catalog });
    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

    const enabled = Array.isArray(body.enabled)
      ? body.enabled.map((id) => safeString(id, 60)).filter((id) => catalog.some((m) => m.id === id))
      : existing.enabled || defaultConfig.enabled;
    const next = {
      businessType: safeString(body.businessType || existing.businessType || "retail", 80),
      enabled,
      updatedAt: new Date().toISOString(),
      catalog,
    };
    await store.set(key, next);
    await appendEvent(store, tenantId, "modules.updated", { enabled, businessType: next.businessType });
    return sendJson(res, 200, { ok: true, tenantId, modules: next });
  } catch (err) {
    return sendJson(res, Number(err?.statusCode || 500), { ok: false, error: err?.message || "Server error" });
  }
};
