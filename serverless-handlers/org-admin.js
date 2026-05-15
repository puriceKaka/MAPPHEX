const { sendJson, readJsonBody } = require("../api/_lib/http");
const { getStore } = require("../api/_lib/kv-store");
const { getTenantId, scopeTenantKey } = require("../api/_lib/tenant");
const { appendEvent } = require("../api/_lib/events");
const { assertIdempotent, assertObject, assertSameOrigin, rateLimit, requireTenantSession, safeString } = require("../api/_lib/security");

const USERS_KEY = "enterprise_org_users_v1";
const SETTINGS_KEY = "enterprise_org_settings_v1";

const moduleHref = "organization-module.html";
const PORTAL_CATALOG = [
  { id: "branch", title: "Branch Management", href: moduleHref, description: "Locations, branch teams, local operations.", features: ["Branch records", "Local teams", "Operational scope"] },
  { id: "departments", title: "Department Management", href: moduleHref, description: "Department users, workflows, and approvals.", features: ["Department roles", "Approvals", "Workflows"] },
  { id: "hr", title: "HR Module", href: moduleHref, description: "Staff records, HR reports, and workforce structure.", features: ["Shared users", "Workforce reports", "Role access"] },
  { id: "finance", title: "Finance Module", href: moduleHref, description: "Finance summaries, payments, and reports.", features: ["Shared transactions", "Expense views", "Reports"] },
  { id: "pharmacy", title: "Pharmacy Module", href: moduleHref, description: "Pharmacy inventory and controlled operations.", features: ["Medicine stock", "Supplier control", "Shared inventory"] },
  { id: "inventory", title: "Inventory Module", href: moduleHref, description: "Stock, items, transfers, and availability.", features: ["Stock levels", "Transfers", "Availability"] },
  { id: "logistics", title: "Logistics Module", href: moduleHref, description: "Dispatch, delivery, fleet, and tracking workflows.", features: ["Dispatch", "Tracking", "Delivery status"] },
  { id: "sales", title: "Sales Module", href: moduleHref, description: "Sales operations, customers, and performance.", features: ["Customers", "Sales activity", "Performance"] },
  { id: "analytics", title: "Analytics Module", href: moduleHref, description: "Realtime analytics, reports, and insights.", features: ["Charts", "Insights", "Activity trends"] },
  { id: "admin", title: "Admin Module", href: "organization-admin.html", description: "Organization settings, users, roles, and modules.", features: ["Users", "Settings", "Permissions"] },
  { id: "staff", title: "Staff Module", href: moduleHref, description: "Role-specific staff workspace.", features: ["Tasks", "Notifications", "Role access"] },
  { id: "customer", title: "Customer Module", href: moduleHref, description: "Customer operations and service workflows.", features: ["Customers", "Service records", "Support"] },
  { id: "reporting", title: "Reporting Module", href: moduleHref, description: "Operational, finance, and organization reports.", features: ["Operational reports", "Financial summaries", "Exports"] },
];

const VALID_PORTAL_IDS = new Set(PORTAL_CATALOG.map((portal) => portal.id));
const sanitizeSettings = (settings = {}) => ({
  ...settings,
  installedPortals: (settings.installedPortals || []).filter((id) => VALID_PORTAL_IDS.has(id)),
  modules: (settings.modules || []).filter((id) => VALID_PORTAL_IDS.has(id) || ["dashboard", "orders", "crm", "documents"].includes(id)),
  navigation: (settings.navigation || []).filter((id) => VALID_PORTAL_IDS.has(id)),
  modulePermissions: Object.fromEntries(Object.entries(settings.modulePermissions || {}).filter(([id]) => VALID_PORTAL_IDS.has(id))),
});

module.exports = async (req, res) => {
  try {
    rateLimit(req, { scope: "org-admin", limit: 180, windowMs: 60_000 });
    const store = getStore();
    const body = req.method === "POST" ? assertObject(await readJsonBody(req)) : null;
    const tenantId = getTenantId(req, body);
    requireTenantSession(req, tenantId);
    assertSameOrigin(req);
    const usersKey = scopeTenantKey(tenantId, USERS_KEY);
    const settingsKey = scopeTenantKey(tenantId, SETTINGS_KEY);

    if (req.method === "GET") {
      const users = (await store.get(usersKey)) || [];
      const settings = sanitizeSettings((await store.get(settingsKey)) || {});
      return sendJson(res, 200, { ok: true, tenantId, users: Array.isArray(users) ? users : [], settings, portalCatalog: PORTAL_CATALOG });
    }

    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
    assertIdempotent(req, body);
    const users = (await store.get(usersKey)) || [];
    const settings = sanitizeSettings((await store.get(settingsKey)) || {});

    if (body.action === "add-user") {
      const user = {
        id: `user-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: safeString(body.name, 120),
        email: safeString(body.email, 160).toLowerCase(),
        role: safeString(body.role || "staff", 80),
        permissions: Array.isArray(body.permissions) ? body.permissions.map((p) => safeString(p, 80)).filter(Boolean) : [],
        status: "active",
        createdAt: new Date().toISOString(),
      };
      if (!user.name || !user.email) return sendJson(res, 400, { ok: false, error: "Name and email are required" });
      const next = [user, ...(Array.isArray(users) ? users : [])].slice(0, 2000);
      await store.set(usersKey, next);
      await appendEvent(store, tenantId, "org.user.created", { userId: user.id, role: user.role });
      return sendJson(res, 200, { ok: true, user, users: next });
    }

    if (body.action === "save-settings") {
      const next = {
        ...settings,
        businessType: safeString(body.businessType || settings.businessType || "retail", 80),
        modules: Array.isArray(body.modules) ? body.modules.map((m) => safeString(m, 80)).filter(Boolean) : settings.modules || [],
        branches: Array.isArray(body.branches) ? body.branches.map((b) => safeString(b, 120)).filter(Boolean) : settings.branches || [],
        departments: Array.isArray(body.departments) ? body.departments.map((d) => safeString(d, 120)).filter(Boolean) : settings.departments || [],
        updatedAt: new Date().toISOString(),
      };
      await store.set(settingsKey, next);
      await appendEvent(store, tenantId, "org.settings.updated", { modules: next.modules.length });
      return sendJson(res, 200, { ok: true, settings: next });
    }

    if (body.action === "accept-agreement") {
      const accepted = body.accepted === true || body.accepted === "true";
      if (!accepted) return sendJson(res, 400, { ok: false, error: "Agreement acceptance is required" });
      const next = {
        ...settings,
        agreementAccepted: true,
        agreementAcceptedAt: new Date().toISOString(),
        subscriptionPlan: safeString(body.subscriptionPlan || settings.subscriptionPlan || "business-monthly", 80),
        supportPackage: safeString(body.supportPackage || settings.supportPackage || "standard", 80),
      };
      await store.set(settingsKey, next);
      await appendEvent(store, tenantId, "org.agreement.accepted", { subscriptionPlan: next.subscriptionPlan });
      return sendJson(res, 200, { ok: true, settings: next });
    }

    if (body.action === "install-portal" || body.action === "install-portals") {
      const requested = body.action === "install-portals" && Array.isArray(body.portalIds) ? body.portalIds : [body.portalId];
      const portalIds = Array.from(new Set(requested.map((id) => safeString(id, 80)).filter((id) => VALID_PORTAL_IDS.has(id))));
      const portals = portalIds.map((portalId) => PORTAL_CATALOG.find((item) => item.id === portalId)).filter(Boolean);
      if (!portals.length || portals.length !== portalIds.length) return sendJson(res, 404, { ok: false, error: "One or more portals were not found" });
      if (settings.agreementAccepted !== true) return sendJson(res, 403, { ok: false, error: "Accept licensing terms before installing portals" });
      const installedPortals = Array.from(new Set([...(settings.installedPortals || []), ...portalIds]));
      const modules = Array.from(new Set([...(settings.modules || []), ...portalIds]));
      const modulePermissions = { ...(settings.modulePermissions || {}) };
      portalIds.forEach((portalId) => {
        modulePermissions[portalId] = Array.from(new Set([`${portalId}.read`, `${portalId}.manage`, "organization.shared.read"]));
      });
      const navigation = Array.from(new Set([...(settings.navigation || []), ...portalIds]));
      const next = {
        ...settings,
        installedPortals,
        modules,
        modulePermissions,
        navigation,
        onboardingComplete: installedPortals.length > 0,
        updatedAt: new Date().toISOString(),
      };
      await store.set(settingsKey, next);
      await appendEvent(store, tenantId, "org.modules.enabled", {
        portalIds,
        count: portalIds.length,
        titles: portals.map((portal) => portal.title),
        sharedWorkspace: true,
      });
      return sendJson(res, 200, { ok: true, portal: portals[0], portals, settings: next });
    }

    return sendJson(res, 400, { ok: false, error: "Unsupported org admin action" });
  } catch (err) {
    return sendJson(res, Number(err?.statusCode || 500), { ok: false, error: err?.message || "Server error" });
  }
};
