const { sendJson, readJsonBody } = require("../api/_lib/http");
const { getStore } = require("../api/_lib/kv-store");
const { scopeTenantKey } = require("../api/_lib/tenant");
const { appendEvent, listEvents } = require("../api/_lib/events");
const { assertObject, rateLimit, safeString } = require("../api/_lib/security");

const ORGS_KEY = "platform_organizations_v1";
const USERS_KEY = "enterprise_org_users_v1";
const SETTINGS_KEY = "enterprise_org_settings_v1";
const AUDIT_KEY = "enterprise_audit_v1";
const TASK_KEY = "enterprise_task_queue_v1";
const FILES_KEY = "enterprise_files_v1";
const BACKUPS_KEY = "platform_backups_v1";

const publicOrg = (org) => {
  const { adminPasswordHash, ...safe } = org || {};
  return safe;
};

const requireSuperAdmin = (req) => {
  const key = process.env.SUPER_ADMIN_KEY || process.env.INTERNAL_ADMIN_KEY || "mapphex-internal";
  const provided = String(req.headers["x-super-admin-key"] || "").trim();
  if (provided === key) return true;
  const err = new Error("Super admin authorization required");
  err.statusCode = 403;
  throw err;
};

const readArray = async (store, key) => {
  const value = (await store.get(key)) || [];
  return Array.isArray(value) ? value : [];
};

const summarizeTenant = async (store, org) => {
  const tenantId = org.id;
  const [users, settings, audit, tasks, files, events] = await Promise.all([
    readArray(store, scopeTenantKey(tenantId, USERS_KEY)),
    store.get(scopeTenantKey(tenantId, SETTINGS_KEY)).then((v) => (v && typeof v === "object" ? v : {})),
    readArray(store, scopeTenantKey(tenantId, AUDIT_KEY)),
    readArray(store, scopeTenantKey(tenantId, TASK_KEY)),
    readArray(store, scopeTenantKey(tenantId, FILES_KEY)),
    listEvents(store, tenantId, 0),
  ]);
  const activeUsers = users.filter((user) => user.status !== "suspended").length;
  const securityAlerts =
    audit.filter((row) => /failed|denied|suspend|unauthor|security/i.test(`${row.action} ${JSON.stringify(row.detail || {})}`)).length +
    (org.status === "suspended" ? 1 : 0);
  return {
    organization: publicOrg(org),
    users: users.map(({ password, passwordHash, ...user }) => user),
    settings,
    metrics: {
      users: users.length,
      activeUsers,
      branches: Array.isArray(settings.branches) ? settings.branches.length : Number(org.metrics?.branches || 0),
      departments: Array.isArray(settings.departments) ? settings.departments.length : 0,
      modules: Array.isArray(settings.modules) ? settings.modules.length : 0,
      auditEvents: audit.length,
      queuedTasks: tasks.filter((task) => task.status === "queued").length,
      files: files.length,
      realtimeEvents: events.length,
      revenue: Number(org.metrics?.revenue || 0),
      securityAlerts,
    },
    latestActivity: [...events.slice(-10), ...audit.slice(-10)]
      .sort((a, b) => String(b.at || b.createdAt || "").localeCompare(String(a.at || a.createdAt || "")))
      .slice(0, 10),
  };
};

module.exports = async (req, res) => {
  try {
    rateLimit(req, { scope: "platform-monitoring", limit: 180, windowMs: 60_000 });
    requireSuperAdmin(req);
    const store = getStore();
    const organizationsRaw = (await store.get(ORGS_KEY)) || [];
    const organizations = Array.isArray(organizationsRaw) ? organizationsRaw : [];

    if (req.method === "POST") {
      const body = assertObject(await readJsonBody(req));
      if (body.action === "broadcast") {
        const title = safeString(body.title || "Platform notification", 120);
        const message = safeString(body.message || body.body || "", 500);
        await appendEvent(store, "platform", "platform.broadcast.sent", { title, message, count: organizations.length });
        await Promise.all(
          organizations.map((org) => appendEvent(store, org.id, "platform.broadcast.received", { title, message })),
        );
        return sendJson(res, 200, { ok: true, delivered: organizations.length });
      }
      if (body.action === "backup-organization") {
        const org = organizations.find((row) => row.id === safeString(body.tenantId || body.id, 80));
        if (!org) return sendJson(res, 404, { ok: false, error: "Organization not found" });
        const summary = await summarizeTenant(store, org);
        const backup = {
          id: `backup-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          tenantId: org.id,
          organizationId: org.organizationId,
          createdAt: new Date().toISOString(),
          type: "tenant-summary",
          summary,
        };
        const backups = await readArray(store, BACKUPS_KEY);
        await store.set(BACKUPS_KEY, [backup, ...backups].slice(0, 500));
        await appendEvent(store, "platform", "organization.backup.created", { tenantId: org.id, backupId: backup.id });
        return sendJson(res, 200, { ok: true, backup: { ...backup, summary: undefined } });
      }
      return sendJson(res, 400, { ok: false, error: "Unsupported monitoring action" });
    }

    if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

    const tenantSummaries = await Promise.all(organizations.map((org) => summarizeTenant(store, org)));
    const platformEvents = await listEvents(store, "platform", Number(req.query?.after || 0) || 0);
    const totals = tenantSummaries.reduce(
      (acc, row) => {
        acc.organizations += 1;
        acc.active += row.organization.status === "active" ? 1 : 0;
        acc.suspended += row.organization.status === "suspended" ? 1 : 0;
        acc.users += row.metrics.users;
        acc.activeUsers += row.metrics.activeUsers;
        acc.branches += row.metrics.branches;
        acc.modules += row.metrics.modules;
        acc.auditEvents += row.metrics.auditEvents;
        acc.queuedTasks += row.metrics.queuedTasks;
        acc.files += row.metrics.files;
        acc.revenue += row.metrics.revenue;
        acc.securityAlerts += row.metrics.securityAlerts;
        return acc;
      },
      {
        organizations: 0,
        active: 0,
        suspended: 0,
        users: 0,
        activeUsers: 0,
        branches: 0,
        modules: 0,
        auditEvents: 0,
        queuedTasks: 0,
        files: 0,
        revenue: 0,
        securityAlerts: 0,
      },
    );

    const activity = [
      ...platformEvents,
      ...tenantSummaries.flatMap((row) =>
        row.latestActivity.map((event) => ({
          ...event,
          tenantId: row.organization.id,
          organizationName: row.organization.name,
        })),
      ),
    ]
      .sort((a, b) => String(b.at || b.createdAt || "").localeCompare(String(a.at || a.createdAt || "")))
      .slice(0, 100);

    const q = safeString(req.query?.q || "", 120).toLowerCase();
    const globalSearch = q
      ? tenantSummaries
          .flatMap((row) => [
            { type: "organization", tenantId: row.organization.id, label: row.organization.name, detail: row.organization.organizationId },
            ...(row.users || []).map((user) => ({
              type: "user",
              tenantId: row.organization.id,
              label: user.name || user.email,
              detail: `${row.organization.name} • ${user.role}`,
            })),
          ])
          .filter((item) => JSON.stringify(item).toLowerCase().includes(q))
          .slice(0, 50)
      : [];

    const heatmap = tenantSummaries.map((row) => ({
      tenantId: row.organization.id,
      name: row.organization.name,
      activity: row.metrics.realtimeEvents + row.metrics.auditEvents,
      alerts: row.metrics.securityAlerts,
    }));

    return sendJson(res, 200, {
      ok: true,
      totals,
      organizations: tenantSummaries,
      activity,
      globalSearch,
      heatmap,
      health: {
        database: "online",
        realtime: "online",
        api: "online",
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return sendJson(res, Number(err?.statusCode || 500), { ok: false, error: err?.message || "Server error" });
  }
};
