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

  const writeJson = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value ?? null));
  };

  const fetchJson = async (url, opts) => {
    const res = await fetch(url, opts);
    const text = await res.text();
    try {
      return { res, data: text ? JSON.parse(text) : null };
    } catch {
      const err = new Error("Service returned an invalid response");
      err.invalidJson = true;
      throw err;
    }
  };

  const localOrg = (tenant) => {
    const rows = readJson(ORGS_KEY, []);
    return (Array.isArray(rows) ? rows : []).find((row) => row.id === tenant) || null;
  };

  const localAdminPayload = (tenant) => {
    window.EnterpriseCore?.setTenant?.(tenant);
    return {
      ok: true,
      tenantId: tenant,
      users: readJson("enterprise_org_users_v1", []),
      settings: readJson(SETTINGS_KEY, {}),
      portalCatalog: PORTAL_CATALOG,
    };
  };

  let catalog = [];
  let settings = {};
  let org = null;

  const portalUrl = (portal) => {
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

  const load = async () => {
    const tenant = new URLSearchParams(location.search).get("tenant") || window.EnterpriseCore?.currentTenantId?.();
    if (tenant) window.EnterpriseCore?.setTenant?.(tenant);
    const session = window.EnterpriseCore?.getSession?.();
    if (!session?.tenantId) {
      location.href = "organization-login.html";
      return;
    }
    window.EnterpriseCore?.setTenant?.(session.tenantId);
    let admin;
    let mine;
    try {
      const responses = await Promise.all([fetchJson("/api/org-admin"), fetchJson("/api/organizations?scope=mine")]);
      if (!responses[0].res.ok || !responses[0].data?.ok) throw new Error(responses[0].data?.error || "Unable to load portals");
      admin = responses[0].data;
      mine = responses[1].res.ok && responses[1].data?.ok ? responses[1].data : { ok: true, organization: localOrg(session.tenantId) };
    } catch {
      admin = localAdminPayload(session.tenantId);
      mine = { ok: true, organization: localOrg(session.tenantId) };
    }
    if (!admin.ok) throw new Error(admin.error || "Unable to load portals");
    catalog = admin.portalCatalog || [];
    settings = admin.settings || {};
    org = mine?.organization || null;
    if (settings.agreementAccepted !== true) {
      location.href = `organization-agreement.html?tenant=${encodeURIComponent(window.EnterpriseCore?.currentTenantId?.() || "")}`;
      return;
    }
    $("#portal-org-name").textContent = `MAPPHEX Workspace — ${org?.name || "Organization"}`;
    $("#portal-workspace-link").href = `organization-workspace.html?tenant=${encodeURIComponent(window.EnterpriseCore?.currentTenantId?.() || tenant || "")}`;
    render();
  };

  const render = () => {
    const installed = new Set(settings.installedPortals || []);
    $("#portal-grid").innerHTML = catalog
      .map(
        (portal) => `
          <article class="portal-install-card">
            <h3>${escapeHtml(portal.title)}</h3>
            <p>${escapeHtml(portal.description)}</p>
            <ul class="portal-feature-list">
              ${(portal.features || []).map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}
            </ul>
            <span class="portal-status">${installed.has(portal.id) ? "Installed" : "Not Installed"}</span>
            <div class="portal-card-actions">
              ${
                installed.has(portal.id)
                  ? `<a class="btn primary" href="${escapeHtml(portalUrl(portal))}" ${portal.external ? 'target="_blank" rel="noopener noreferrer"' : ""}>Open Portal</a>`
                  : `<button class="btn primary" data-portal="${escapeHtml(portal.id)}" type="button">Install</button>`
              }
            </div>
          </article>`,
      )
      .join("");
  };

  const install = async (portalId) => {
    const progress = $("#portal-progress");
    if (progress) progress.textContent = "Installing portal and configuring workspace...";
    let data;
    try {
      const response = await fetchJson("/api/org-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install-portal", portalId }),
      });
      data = response.data;
      if (!response.res.ok || !data?.ok) throw new Error(data?.error || "Install failed");
    } catch {
      const portal = PORTAL_CATALOG.find((item) => item.id === portalId);
      if (!portal) throw new Error("Portal not found");
      const installedPortals = Array.from(new Set([...(settings.installedPortals || []), portalId]));
      settings = {
        ...settings,
        installedPortals,
        modules: Array.from(new Set([...(settings.modules || []), portalId])),
        navigation: Array.from(new Set([...(settings.navigation || []), portalId])),
        modulePermissions: {
          ...(settings.modulePermissions || {}),
          [portalId]: Array.from(new Set([`${portalId}.read`, `${portalId}.manage`, "organization.shared.read"])),
        },
        onboardingComplete: true,
        updatedAt: new Date().toISOString(),
      };
      writeJson(SETTINGS_KEY, settings);
      data = { ok: true, portal, settings };
    }
    settings = data.settings;
    render();
    window.EnterpriseCore?.notify?.("Portal installed", data.portal?.title || portalId);
    if (progress) progress.textContent = "Installation complete. You can open it now or install another portal.";
  };

  document.addEventListener("DOMContentLoaded", () => {
    $("#portal-grid")?.addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-portal]");
      if (!btn || btn.textContent.trim() === "Installed") return;
      btn.disabled = true;
      btn.textContent = "Installing...";
      install(btn.dataset.portal).catch((err) => {
        btn.disabled = false;
        btn.textContent = "Install";
        const progress = $("#portal-progress");
        if (progress) progress.textContent = "Installation failed. Try again.";
        window.EnterpriseCore?.notify?.("Install failed", err.message, "error");
      });
    });
    load().catch((err) => window.EnterpriseCore?.notify?.("Portal manager", err.message, "error"));
  });
})();
