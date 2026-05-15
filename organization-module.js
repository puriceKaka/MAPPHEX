(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const ORGS_KEY = "platform_organizations_v1";
  const SETTINGS_KEY = "enterprise_org_settings_v1";
  const PORTAL_CATALOG = [
    { id: "branch", title: "Branch Management", href: "organization-module.html", description: "Locations, branch teams, local operations.", features: ["Branch records", "Local teams", "Operational scope"] },
    { id: "departments", title: "Department Management", href: "organization-module.html", description: "Department users, workflows, and approvals.", features: ["Department roles", "Approvals", "Workflows"] },
    { id: "hr", title: "HR Module", href: "organization-module.html", description: "Staff records, HR reports, and workforce structure.", features: ["Shared users", "Workforce reports", "Role access"] },
    { id: "finance", title: "Finance Module", href: "organization-module.html", description: "Finance summaries, payments, and reports.", features: ["Shared transactions", "Expense views", "Reports"] },
    { id: "pharmacy", title: "Pharmacy Module", href: "organization-module.html", description: "Pharmacy inventory and controlled operations.", features: ["Medicine stock", "Supplier control", "Shared inventory"] },
    { id: "inventory", title: "Inventory Module", href: "organization-module.html", description: "Stock, items, transfers, and availability.", features: ["Stock levels", "Transfers", "Availability"] },
    { id: "assetwise", title: "AssetWise Module", href: "https://assert-management.lovable.app/", external: true, externalUrl: "https://assert-management.lovable.app/", description: "Connected asset lifecycle and allocation.", features: ["Shared assets", "Asset lifecycle", "Allocation"] },
    { id: "logistics", title: "Logistics Module", href: "organization-module.html", description: "Dispatch, delivery, fleet, and tracking workflows.", features: ["Dispatch", "Tracking", "Delivery status"] },
    { id: "sales", title: "Sales Module", href: "organization-module.html", description: "Sales operations, customers, and performance.", features: ["Customers", "Sales activity", "Performance"] },
    { id: "school", title: "School Module", href: "organization-module.html", description: "School operations and administrative workflows.", features: ["Administration", "Departments", "Reports"] },
    { id: "analytics", title: "Analytics Module", href: "organization-module.html", description: "Realtime analytics, reports, and insights.", features: ["Charts", "Insights", "Activity trends"] },
    { id: "admin", title: "Admin Module", href: "organization-admin.html", description: "Organization settings, users, roles, and modules.", features: ["Users", "Settings", "Permissions"] },
    { id: "staff", title: "Staff Module", href: "organization-module.html", description: "Role-specific staff workspace.", features: ["Tasks", "Notifications", "Role access"] },
    { id: "customer", title: "Customer Module", href: "organization-module.html", description: "Customer operations and service workflows.", features: ["Customers", "Service records", "Support"] },
    { id: "reporting", title: "Reporting Module", href: "organization-module.html", description: "Operational, finance, and organization reports.", features: ["Operational reports", "Financial summaries", "Exports"] },
  ];

  const readJson = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  };

  const fetchJson = async (url) => {
    const res = await fetch(url);
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new Error("Service returned an invalid response");
    }
    if (!res.ok || !data?.ok) throw new Error(data?.error || "Request failed");
    return data;
  };

  const localOrg = (tenant) => {
    const rows = readJson(ORGS_KEY, []);
    return (Array.isArray(rows) ? rows : []).find((row) => row.id === tenant) || null;
  };

  document.addEventListener("DOMContentLoaded", async () => {
    const params = new URLSearchParams(location.search);
    const moduleId = String(params.get("portal") || params.get("module") || "").trim().toLowerCase();
    const tenant = params.get("tenant") || window.EnterpriseCore?.currentTenantId?.();
    if (tenant) window.EnterpriseCore?.setTenant?.(tenant);

    const session = window.EnterpriseCore?.getSession?.();
    if (!session?.tenantId) {
      location.href = "organization-login.html";
      return;
    }
    window.EnterpriseCore?.setTenant?.(session.tenantId);

    try {
      let admin;
      let mine;
      try {
        [admin, mine] = await Promise.all([fetchJson("/api/org-admin"), fetchJson("/api/organizations?scope=mine").catch(() => null)]);
      } catch {
        admin = {
          ok: true,
          users: readJson("enterprise_org_users_v1", []),
          settings: readJson(SETTINGS_KEY, {}),
          portalCatalog: PORTAL_CATALOG,
        };
        mine = { ok: true, organization: localOrg(session.tenantId) };
      }
      const settings = admin.settings || {};
      if (settings.agreementAccepted !== true) {
        location.href = `organization-agreement.html?tenant=${encodeURIComponent(session.tenantId)}`;
        return;
      }
      const installed = new Set(settings.installedPortals || []);
      if (!moduleId || !installed.has(moduleId)) {
        location.replace(`portal-selection.html?tenant=${encodeURIComponent(session.tenantId)}`);
        return;
      }

      const moduleDef = (admin.portalCatalog || []).find((item) => item.id === moduleId);
      if (!moduleDef) throw new Error("Module not found");
      const org = mine?.organization || {};
      const permissions = settings.modulePermissions?.[moduleId] || [];
      const moduleCode = (moduleDef.title || "M").slice(0, 2).toUpperCase();

      document.title = `${moduleDef.title} • MAPPHEX`;
      $("#module-title").textContent = moduleDef.title;
      $("#module-subtitle").textContent = `${org.organizationId || session.tenantId} • shared organization module`;
      $("#module-heading").textContent = moduleDef.title;
      $("#module-description").textContent = `${moduleDef.description} This module is enabled inside the same ${org.name || "organization"} workspace and uses the shared database context.`;
      $("#module-icon").textContent = moduleCode;
      $("#module-org-name").textContent = org.name || "Organization";
      $("#module-org-id").textContent = org.organizationId || session.tenantId;
      $("#module-kpi-users").textContent = Array.isArray(admin.users) ? admin.users.length : 0;
      $("#module-kpi-branches").textContent = settings.branches?.length || org.metrics?.branches || 0;
      $("#module-kpi-modules").textContent = installed.size;
      $("#module-kpi-tenant").textContent = session.tenantId;
      $("#hub-link").href = `organization-workspace.html?tenant=${encodeURIComponent(session.tenantId)}`;
      $("#settings-link").href = `organization-admin.html?tenant=${encodeURIComponent(session.tenantId)}`;
      $("#module-permissions").textContent = permissions.length
        ? permissions.map(escapeHtml).join(", ")
        : "Uses inherited organization permissions.";

      if (moduleDef.externalUrl) {
        $("#assetwise-connected-panel").hidden = false;
        const url = new URL(moduleDef.externalUrl);
        url.searchParams.set("tenant", session.tenantId);
        if (org.organizationId) url.searchParams.set("org", org.organizationId);
        $("#assetwise-link").href = url.href;
      }
    } catch (err) {
      window.EnterpriseCore?.notify?.("Module", err.message, "error");
    }
  });
})();
