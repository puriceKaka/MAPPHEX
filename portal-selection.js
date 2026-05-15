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
  let selected = new Set();

  const portalUrl = (portal) => {
    if (portal?.externalUrl || portal?.external) return portal.externalUrl || portal.href;
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
    selected = new Set([...selected].filter((id) => !installed.has(id)));
    $("#portal-grid").innerHTML = catalog
      .map(
        (portal) => {
          const isInstalled = installed.has(portal.id);
          const isSelected = selected.has(portal.id);
          return `
          <article class="portal-install-card ${isInstalled ? "is-installed" : "is-selectable"} ${isSelected ? "is-selected" : ""}" data-portal-card="${escapeHtml(portal.id)}">
            <div class="portal-card-top">
              <h3>${escapeHtml(portal.title)}</h3>
              ${
                isInstalled
                  ? `<span class="portal-status">Installed</span>`
                  : `<label class="portal-select-control">
                      <input type="checkbox" data-portal-check="${escapeHtml(portal.id)}" ${isSelected ? "checked" : ""} />
                      Select
                    </label>`
              }
            </div>
            <p>${escapeHtml(portal.description)}</p>
            <ul class="portal-feature-list">
              ${(portal.features || []).map((feature) => `<li>${escapeHtml(feature)}</li>`).join("")}
            </ul>
            ${isInstalled ? "" : `<span class="portal-status">${isSelected ? "Selected for unified install" : "Ready to install"}</span>`}
            <div class="portal-card-actions">
              ${
                isInstalled
                  ? `<a class="btn primary" href="${escapeHtml(portalUrl(portal))}" ${portal.external ? 'target="_blank" rel="noopener noreferrer"' : ""}>Open Portal</a>`
                  : `<button class="btn" data-portal-toggle="${escapeHtml(portal.id)}" type="button">${isSelected ? "Remove from install" : "Add to install"}</button>`
              }
            </div>
          </article>`;
        },
      )
      .join("");
    renderBulkBar();
  };

  const renderBulkBar = () => {
    const count = selected.size;
    const installed = new Set(settings.installedPortals || []);
    const available = catalog.filter((portal) => !installed.has(portal.id));
    const names = [...selected]
      .map((id) => catalog.find((portal) => portal.id === id)?.title)
      .filter(Boolean)
      .slice(0, 3);
    const countEl = $("#portal-selected-count");
    const summaryEl = $("#portal-selected-summary");
    const installBtn = $("#portal-install-selected");
    const clearBtn = $("#portal-clear-selection");
    if (countEl) countEl.textContent = `${count} selected`;
    if (summaryEl) {
      summaryEl.textContent = count
        ? `${names.join(", ")}${count > names.length ? ` and ${count - names.length} more` : ""} will install as one workspace app.`
        : available.length
          ? "Pick the modules your organization needs."
          : "All available portals are already installed.";
    }
    if (installBtn) installBtn.disabled = count === 0;
    if (clearBtn) clearBtn.disabled = count === 0;
  };

  const toggleSelection = (portalId, force) => {
    const installed = new Set(settings.installedPortals || []);
    if (installed.has(portalId)) return;
    const shouldSelect = typeof force === "boolean" ? force : !selected.has(portalId);
    if (shouldSelect) selected.add(portalId);
    else selected.delete(portalId);
    render();
  };

  const selectCoreSet = () => {
    const installed = new Set(settings.installedPortals || []);
    ["admin", "branch", "departments", "staff", "inventory", "finance", "reporting", "analytics"].forEach((id) => {
      if (!installed.has(id) && catalog.some((portal) => portal.id === id)) selected.add(id);
    });
    render();
  };

  const install = async (portalIds) => {
    const ids = Array.from(new Set((Array.isArray(portalIds) ? portalIds : [portalIds]).filter(Boolean)));
    if (!ids.length) return;
    const progress = $("#portal-progress");
    if (progress) progress.textContent = `Installing ${ids.length} portal${ids.length === 1 ? "" : "s"} as one workspace app...`;
    let data;
    try {
      const response = await fetchJson("/api/org-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "install-portals", portalIds: ids }),
      });
      data = response.data;
      if (!response.res.ok || !data?.ok) throw new Error(data?.error || "Install failed");
    } catch {
      const portals = ids.map((id) => PORTAL_CATALOG.find((item) => item.id === id)).filter(Boolean);
      if (portals.length !== ids.length) throw new Error("One or more portals were not found");
      const installedPortals = Array.from(new Set([...(settings.installedPortals || []), ...ids]));
      const modulePermissions = { ...(settings.modulePermissions || {}) };
      ids.forEach((portalId) => {
        modulePermissions[portalId] = Array.from(new Set([`${portalId}.read`, `${portalId}.manage`, "organization.shared.read"]));
      });
      settings = {
        ...settings,
        installedPortals,
        modules: Array.from(new Set([...(settings.modules || []), ...ids])),
        navigation: Array.from(new Set([...(settings.navigation || []), ...ids])),
        modulePermissions,
        onboardingComplete: true,
        updatedAt: new Date().toISOString(),
      };
      writeJson(SETTINGS_KEY, settings);
      data = { ok: true, portal: portals[0], portals, settings };
    }
    settings = data.settings;
    selected.clear();
    render();
    window.EnterpriseCore?.notify?.("Workspace app installed", `${ids.length} portal${ids.length === 1 ? "" : "s"} enabled`);
    if (progress) progress.textContent = "Unified installation complete. Opening the workspace app...";
    setTimeout(() => {
      location.href = `organization-workspace.html?tenant=${encodeURIComponent(window.EnterpriseCore?.currentTenantId?.() || "")}`;
    }, 750);
  };

  document.addEventListener("DOMContentLoaded", () => {
    $("#portal-grid")?.addEventListener("click", (event) => {
      const check = event.target.closest("input[data-portal-check]");
      if (check) {
        toggleSelection(check.dataset.portalCheck, check.checked);
        return;
      }
      const toggle = event.target.closest("button[data-portal-toggle]");
      if (toggle) {
        toggleSelection(toggle.dataset.portalToggle);
        return;
      }
      const card = event.target.closest("[data-portal-card]");
      if (card && !event.target.closest("a,button,input,label")) toggleSelection(card.dataset.portalCard);
    });
    $("#portal-select-core")?.addEventListener("click", selectCoreSet);
    $("#portal-clear-selection")?.addEventListener("click", () => {
      selected.clear();
      render();
    });
    $("#portal-install-selected")?.addEventListener("click", (event) => {
      const btn = event.currentTarget;
      if (!selected.size) return;
      btn.disabled = true;
      btn.textContent = "Installing selected...";
      install([...selected])
        .catch((err) => {
          const progress = $("#portal-progress");
          if (progress) progress.textContent = "Installation failed. Try again.";
          window.EnterpriseCore?.notify?.("Install failed", err.message, "error");
        })
        .finally(() => {
          btn.textContent = "Install selected as one app";
          renderBulkBar();
        });
    });
    load().catch((err) => window.EnterpriseCore?.notify?.("Portal manager", err.message, "error"));
  });
})();
