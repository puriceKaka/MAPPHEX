const crypto = require("crypto");
const { sendJson, readJsonBody } = require("../api/_lib/http");
const { getStore } = require("../api/_lib/kv-store");
const { cleanTenantId, getTenantId, scopeTenantKey } = require("../api/_lib/tenant");
const { appendEvent, listEvents } = require("../api/_lib/events");
const { assertIdempotent, assertObject, assertSameOrigin, rateLimit, requireTenantSession, safeString } = require("../api/_lib/security");

const ORGS_KEY = "platform_organizations_v1";
const USERS_KEY = "enterprise_org_users_v1";
const PROFILE_KEY = "enterprise_org_profile_v1";
const SETTINGS_KEY = "enterprise_org_settings_v1";

const slug = (value) =>
  safeString(value, 90)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "organization";

const publicOrg = (org) => {
  const { adminPasswordHash, ...safe } = org || {};
  return safe;
};

const hashSecret = (value, salt = crypto.randomBytes(16).toString("hex")) => {
  const hash = crypto.pbkdf2Sync(String(value || ""), salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
};

const verifySecret = (value, encoded) => {
  const [salt, expected] = String(encoded || "").split(":");
  if (!salt || !expected) return false;
  const actual = hashSecret(value, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
};

const requireSuperAdmin = (req) => {
  const key = process.env.SUPER_ADMIN_KEY || process.env.INTERNAL_ADMIN_KEY || "mapphex-internal";
  const provided = String(req.headers["x-super-admin-key"] || "").trim();
  if (provided === key) return true;
  const err = new Error("Super admin authorization required");
  err.statusCode = 403;
  throw err;
};

const loadOrganizations = async (store) => {
  const rows = (await store.get(ORGS_KEY)) || [];
  return Array.isArray(rows) ? rows : [];
};

const saveOrganizations = (store, rows) => store.set(ORGS_KEY, rows);

const createOrganization = async (req, res, body) => {
  const store = getStore();
  const rows = await loadOrganizations(store);
  const name = safeString(body.name || body.organizationName, 140);
  const businessType = safeString(body.businessType || "retail", 80);
  const adminName = safeString(body.adminName || "Organization Admin", 120);
  const adminEmail = safeString(body.adminEmail || body.email, 160).toLowerCase();
  const orgEmail = safeString(body.email || body.organizationEmail || adminEmail, 160).toLowerCase();
  const phone = safeString(body.phone || body.phoneNumber, 60);
  const location = safeString(body.location || body.country, 140);
  const companySize = safeString(body.companySize || "1-10", 40);
  const branchCount = Math.max(0, Number(body.branchCount || body.branches || 0) || 0);
  const adminPassword = safeString(body.adminPassword || body.password || "", 240);
  if (!name || !adminEmail || adminPassword.length < 6) {
    return sendJson(res, 400, { ok: false, error: "Organization name, admin email, and 6+ character password are required" });
  }

  const base = slug(name);
  const unique = crypto.randomBytes(3).toString("hex").toUpperCase();
  const tenantId = cleanTenantId(`${base}-${unique.toLowerCase()}`);
  const orgCode = `${base.toUpperCase().replace(/-/g, "").slice(0, 10)}-${unique}`;
  const now = new Date().toISOString();
  const org = {
    id: tenantId,
    organizationId: `ORG-${orgCode}`,
    referenceCode: orgCode,
    name,
    businessType,
    contact: { email: orgEmail, phone, location },
    companySize,
    status: "active",
    subscriptionStatus: "trial",
    admin: { name: adminName, email: adminEmail, role: "org_admin" },
    metrics: { users: 1, branches: branchCount, inventoryItems: 0, orders: 0, revenue: 0 },
    createdAt: now,
    updatedAt: now,
    adminPasswordHash: hashSecret(adminPassword),
  };

  const usersKey = scopeTenantKey(tenantId, USERS_KEY);
  const profileKey = scopeTenantKey(tenantId, PROFILE_KEY);
  const settingsKey = scopeTenantKey(tenantId, SETTINGS_KEY);
  await store.set(usersKey, [
    {
      id: `user-${Date.now()}`,
      name: adminName,
      email: adminEmail,
      role: "org_admin",
      permissions: ["*"],
      status: "active",
      createdAt: now,
    },
  ]);
  await store.set(profileKey, publicOrg(org));
  await store.set(settingsKey, {
    modules: ["dashboard", "inventory", "orders", "finance", "crm", "documents"],
    installedPortals: [],
    agreementAccepted: false,
    onboardingComplete: false,
    businessType,
    branches: Array.from({ length: branchCount }, (_, idx) => `Branch ${idx + 1}`),
    departments: [],
    createdAt: now,
  });
  await saveOrganizations(store, [org, ...rows]);
  await appendEvent(store, "platform", "organization.registered", { organizationId: org.organizationId, name, tenantId });
  await appendEvent(store, tenantId, "organization.workspace.created", { organizationId: org.organizationId, name });
  return sendJson(res, 201, { ok: true, organization: publicOrg(org), tenantId, organizationId: org.organizationId });
};

module.exports = async (req, res) => {
  try {
    rateLimit(req, { scope: "organizations", limit: 160, windowMs: 60_000 });
    const store = getStore();

    if (req.method === "GET") {
      const rows = await loadOrganizations(store);
      const tenantId = getTenantId(req);
      if (req.query?.scope === "mine") {
        requireTenantSession(req, tenantId);
        const org = rows.find((row) => row.id === tenantId);
        return sendJson(res, 200, { ok: true, organization: org ? publicOrg(org) : null });
      }
      requireSuperAdmin(req);
      const events = await listEvents(store, "platform", Number(req.query?.after || 0) || 0);
      return sendJson(res, 200, {
        ok: true,
        organizations: rows.map(publicOrg),
        events,
        totals: {
          organizations: rows.length,
          active: rows.filter((o) => o.status === "active").length,
          suspended: rows.filter((o) => o.status === "suspended").length,
          users: rows.reduce((sum, o) => sum + Number(o.metrics?.users || 0), 0),
          revenue: rows.reduce((sum, o) => sum + Number(o.metrics?.revenue || 0), 0),
        },
      });
    }

    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });
    assertSameOrigin(req);
    const body = assertObject(await readJsonBody(req));
    assertIdempotent(req, body);

    if (body.action === "register") return createOrganization(req, res, body);

    requireSuperAdmin(req);
    const rows = await loadOrganizations(store);
    const id = cleanTenantId(body.organizationId || body.id || body.tenantId);
    const idx = rows.findIndex((org) => org.id === id || org.organizationId === body.organizationId);
    if (idx < 0) return sendJson(res, 404, { ok: false, error: "Organization not found" });

    if (body.action === "set-status") {
      const status = safeString(body.status, 40);
      if (!["active", "suspended", "restricted", "verified"].includes(status)) return sendJson(res, 400, { ok: false, error: "Invalid status" });
      rows[idx] = { ...rows[idx], status, updatedAt: new Date().toISOString() };
      await saveOrganizations(store, rows);
      await appendEvent(store, "platform", "organization.status.changed", { organizationId: rows[idx].organizationId, status });
      await appendEvent(store, rows[idx].id, "organization.status.changed", { status });
      return sendJson(res, 200, { ok: true, organization: publicOrg(rows[idx]) });
    }

    if (body.action === "set-subscription") {
      const subscriptionStatus = safeString(body.subscriptionStatus || "trial", 40);
      const plan = safeString(body.plan || "standard", 60);
      rows[idx] = { ...rows[idx], subscriptionStatus, plan, updatedAt: new Date().toISOString() };
      await saveOrganizations(store, rows);
      await appendEvent(store, "platform", "organization.subscription.changed", {
        organizationId: rows[idx].organizationId,
        subscriptionStatus,
        plan,
      });
      await appendEvent(store, rows[idx].id, "organization.subscription.changed", { subscriptionStatus, plan });
      return sendJson(res, 200, { ok: true, organization: publicOrg(rows[idx]) });
    }

    return sendJson(res, 400, { ok: false, error: "Unsupported organization action" });
  } catch (err) {
    return sendJson(res, Number(err?.statusCode || 500), { ok: false, error: err?.message || "Server error" });
  }
};

module.exports.verifyOrganizationAdmin = async (identifier, email, password) => {
  const store = getStore();
  const rows = await loadOrganizations(store);
  const ident = String(identifier || "").trim().toLowerCase();
  const cleanIdent = cleanTenantId(ident);
  const mail = String(email || ident || "").trim().toLowerCase();
  const org = rows.find(
    (row) =>
      row.id === cleanIdent ||
      String(row.organizationId || "").toLowerCase() === ident ||
      String(row.referenceCode || "").toLowerCase() === ident ||
      String(row.admin?.email || "").toLowerCase() === mail ||
      String(row.contact?.email || "").toLowerCase() === mail,
  );
  if (!org || org.status !== "active" || !verifySecret(password, org.adminPasswordHash)) return null;
  return publicOrg(org);
};
