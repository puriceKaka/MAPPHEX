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
    { id: "assetwise", title: "AssetWise Module", href: "organization-module.html", externalUrl: "https://assert-management.lovable.app/", description: "Connected asset lifecycle and allocation.", features: ["Shared assets", "Asset lifecycle", "Allocation"] },
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
    try {
      return { res, data: text ? JSON.parse(text) : null };
    } catch {
      throw new Error("Service returned an invalid response");
    }
  };

  const localOrg = (tenant) => {
    const rows = readJson(ORGS_KEY, []);
    return (Array.isArray(rows) ? rows : []).find((row) => row.id === tenant) || null;
  };

  let portals = [];

  const portalUrl = (portal, org) => {
    const tenant = window.EnterpriseCore?.currentTenantId?.() || "";
    const href = String(portal?.href || "organization-workspace.html");
    try {
      const url = new URL(href, location.origin);
      url.searchParams.set("tenant", tenant);
      url.searchParams.set("portal", portal.id);
      if (org?.organizationId) url.searchParams.set("org", org.organizationId);
      return url.href;
    } catch {
      return `${href}${href.includes("?") ? "&" : "?"}tenant=${encodeURIComponent(tenant)}&portal=${encodeURIComponent(portal.id)}`;
    }
  };

  const portalSummary = (portal, settings) => {
    const branches = settings.branches?.length || 0;
    const departments = settings.departments?.length || 0;
    const summaries = {
      hr: `${departments || 1} department groups ready`,
      assetwise: "External asset system connected",
      finance: "Finance reports enabled",
      pharmacy: "Controlled inventory workspace",
      inventory: `${branches || 1} stock location scope`,
      logistics: "Dispatch and tracking ready",
      reporting: "Operational reports available",
      staff: "Staff access enabled",
      branch: `${branches || 1} branch workspace`,
      departments: `${departments || 1} department workflow`,
      analytics: "Realtime insights ready",
      admin: "Organization controls enabled",
      sales: "Customer and sales tracking",
      school: "Institution workflow ready",
      customer: "Customer operations enabled",
    };
    return summaries[portal.id] || "Workspace module ready";
  };

  const renderPortals = (query = "", org = null) => {
    const target = $("#installed-portals");
    const empty = $("#portal-empty");
    const q = query.trim().toLowerCase();
    const rows = q
      ? portals.filter((portal) => `${portal.title} ${portal.description} ${(portal.features || []).join(" ")}`.toLowerCase().includes(q))
      : portals;
    empty.hidden = rows.length > 0;
    target.innerHTML = rows
      .map(
        (portal) => `
          <article class="portal-hub-card">
            <div class="portal-hub-card-top">
              <span class="portal-hub-icon">${escapeHtml((portal.title || "M").slice(0, 2).toUpperCase())}</span>
              <span class="portal-status">Installed</span>
            </div>
            <h3>${escapeHtml(portal.title)}</h3>
            <p>${escapeHtml(portal.description)}</p>
            <div class="portal-hub-summary">${escapeHtml(portal.summary)}</div>
            <ul class="portal-feature-list">
              ${(portal.features || []).slice(0, 3).map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}
            </ul>
            <a class="btn primary" href="${escapeHtml(portalUrl(portal, org))}" ${portal.external ? 'target="_blank" rel="noopener noreferrer"' : ""}>Open Portal</a>
          </article>`,
      )
      .join("");
  };

  document.addEventListener("DOMContentLoaded", async () => {
    const fromQuery = new URLSearchParams(location.search).get("tenant");
    const tenant = fromQuery || window.EnterpriseCore?.currentTenantId?.();
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
        const responses = await Promise.all([fetchJson("/api/org-admin"), fetchJson("/api/organizations?scope=mine")]);
        if (!responses[0].res.ok || !responses[0].data?.ok) throw new Error(responses[0].data?.error || "Unable to load Portal Hub");
        admin = responses[0].data;
        mine = responses[1].res.ok && responses[1].data?.ok ? responses[1].data : { ok: true, organization: localOrg(session.tenantId) };
      } catch {
        admin = {
          ok: true,
          settings: readJson(SETTINGS_KEY, {}),
          portalCatalog: PORTAL_CATALOG,
        };
        mine = { ok: true, organization: localOrg(session.tenantId) };
      }
      if (!admin.ok) throw new Error(admin.error || "Unable to load Portal Hub");
      const settings = admin.settings || {};
      const tenantId = session.tenantId;
      if (settings.agreementAccepted !== true) {
        location.href = `organization-agreement.html?tenant=${encodeURIComponent(tenantId)}`;
        return;
      }
      if (!settings.installedPortals?.length) {
        location.href = `portal-selection.html?tenant=${encodeURIComponent(tenantId)}`;
        return;
      }

      const org = mine?.organization;
      const installed = new Set(settings.installedPortals || []);
      portals = (admin.portalCatalog || [])
        .filter((portal) => installed.has(portal.id))
        .map((portal) => ({ ...portal, summary: portalSummary(portal, settings) }));

      const orgName = org?.name || "Organization";
      $("#workspace-title").textContent = `MAPPHEX Portal Hub`;
      $("#workspace-subtitle").textContent = `${org?.organizationId || tenantId} • ${org?.businessType || settings.businessType || "company"}`;
      $("#portal-hub-heading").textContent = `MAPPHEX Portal Hub - ${orgName}`;
      $("#portal-hub-summary").textContent = `Central access point for ${orgName}'s installed modules, organization data, and secure workflows.`;
      $("#profile-name").textContent = org?.admin?.name || session.email || "Organization Admin";
      $("#profile-email").textContent = session.email || org?.admin?.email || "Signed in securely";
      $("#subscription-status").textContent = org?.subscriptionStatus ? `Subscription: ${org.subscriptionStatus}` : "Subscription: active";
      $("#notification-badge").textContent = `${Math.max(1, portals.length)} notifications`;
      $("#hub-kpi-portals").textContent = portals.length;
      $("#hub-kpi-branches").textContent = settings.branches?.length || org?.metrics?.branches || 0;
      $("#hub-kpi-departments").textContent = settings.departments?.length || 0;
      $("#hub-kpi-session").textContent = `${tenantId} isolated`;
      $("#manage-portals-link").href = `portal-selection.html?tenant=${encodeURIComponent(tenantId)}`;
      $("#admin-link").href = `organization-admin.html?tenant=${encodeURIComponent(tenantId)}`;

      renderPortals("", org);
      $("#portal-search")?.addEventListener("input", (event) => renderPortals(event.currentTarget.value, org));
    } catch (err) {
      window.EnterpriseCore?.notify?.("Portal Hub", err.message, "error");
    }
  });
})();
