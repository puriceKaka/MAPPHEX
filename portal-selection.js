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
    { id: "logistics", title: "Logistics Module", href: "organization-module.html", description: "Dispatch, delivery, fleet, and tracking workflows.", features: ["Dispatch", "Tracking", "Delivery status"] },
    { id: "sales", title: "Sales Module", href: "organization-module.html", description: "Sales operations, customers, and performance.", features: ["Customers", "Sales activity", "Performance"] },
    { id: "analytics", title: "Analytics Module", href: "organization-module.html", description: "Realtime analytics, reports, and insights.", features: ["Charts", "Insights", "Activity trends"] },
    { id: "admin", title: "Admin Module", href: "organization-admin.html", description: "Organization settings, users, roles, and modules.", features: ["Users", "Settings", "Permissions"] },
    { id: "staff", title: "Staff Module", href: "organization-module.html", description: "Role-specific staff workspace.", features: ["Tasks", "Notifications", "Role access"] },
    { id: "customer", title: "Customer Module", href: "organization-module.html", description: "Customer operations and service workflows.", features: ["Customers", "Service records", "Support"] },
    { id: "reporting", title: "Reporting Module", href: "organization-module.html", description: "Operational, finance, and organization reports.", features: ["Operational reports", "Financial summaries", "Exports"] },
  ];
  const VALID_PORTAL_IDS = new Set(PORTAL_CATALOG.map((portal) => portal.id));

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

  const guardPortalLink = (event) => {
    const link = event.target.closest("a[href]");
    if (!link) return;
    if (!link.href.includes("organization-module.html") && !link.href.includes("organization-admin.html")) return;
    const session = window.EnterpriseCore?.getSession?.();
    if (session?.tenantId) return;
    event.preventDefault();
    location.href = "organization-login.html";
  };

  const localAdminPayload = (tenant) => {
    window.EnterpriseCore?.setTenant?.(tenant);
    const rawSettings = readJson(SETTINGS_KEY, {});
    return {
      ok: true,
      tenantId: tenant,
      users: readJson("enterprise_org_users_v1", []),
      settings: {
        ...rawSettings,
        installedPortals: (rawSettings.installedPortals || []).filter((id) => VALID_PORTAL_IDS.has(id)),
        modules: (rawSettings.modules || []).filter((id) => VALID_PORTAL_IDS.has(id) || ["dashboard", "orders", "crm", "documents"].includes(id)),
        navigation: (rawSettings.navigation || []).filter((id) => VALID_PORTAL_IDS.has(id)),
      },
      portalCatalog: PORTAL_CATALOG,
    };
  };

  let catalog = [];
  let settings = {};
  let org = null;
  let selected = new Set();

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
                  ? `<a class="btn primary" href="${escapeHtml(portalUrl(portal))}">Open Portal</a>`
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
        ? `${names.join(", ")}${count > names.length ? ` and ${count - names.length} more` : ""} will install as one MAPPHEX Workspace App.`
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

  const selectAllAvailable = () => {
    const installed = new Set(settings.installedPortals || []);
    catalog.forEach((portal) => {
      if (!installed.has(portal.id)) selected.add(portal.id);
    });
    render();
  };

  const promptWorkspacePwa = async () => {
    if (!window.MapphexPWA?.promptInstall) return { ok: false, reason: "pwa-unavailable" };
    return window.MapphexPWA.promptInstall();
  };

  const openWorkspace = () => {
    location.href = `organization-workspace.html?tenant=${encodeURIComponent(window.EnterpriseCore?.currentTenantId?.() || "")}`;
  };

  const showPwaHelp = (message) => {
    const help = $("#pwa-install-help");
    const text = $("#pwa-install-help-text");
    const link = $("#pwa-open-workspace");
    if (link) link.href = `organization-workspace.html?tenant=${encodeURIComponent(window.EnterpriseCore?.currentTenantId?.() || "")}`;
    if (text && message) text.textContent = message;
    if (help) help.hidden = false;
  };

  const manualInstallMessage = () => {
    const ua = navigator.userAgent || "";
    if (/iPad|iPhone|iPod/i.test(ua)) {
      return "Modules are installed. On iPhone or iPad, tap Share, then Add to Home Screen. Opening your workspace now.";
    }
    if (/Android/i.test(ua)) {
      return "Modules are installed. If no install prompt appears, tap the browser menu, then Install app or Add to Home screen. Opening your workspace now.";
    }
    return "Modules are installed. If no install prompt appears, use Chrome or Edge menu, then Install MAPPHEX Workspace App. Opening your workspace now.";
  };

  const install = async (portalIds, options = {}) => {
    const ids = Array.from(new Set((Array.isArray(portalIds) ? portalIds : [portalIds]).filter(Boolean)));
    if (!ids.length) return;
    const progress = $("#portal-progress");
    if (progress) progress.textContent = `Installing ${ids.length} module${ids.length === 1 ? "" : "s"} as one MAPPHEX Workspace App...`;
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
    window.EnterpriseCore?.notify?.("Workspace app installed", `${ids.length} module${ids.length === 1 ? "" : "s"} enabled`);
    if (options.installPwa) {
      if (progress) progress.textContent = "Modules enabled. Installing the unified workspace app...";
      const pwaResult = await promptWorkspacePwa();
      if (pwaResult?.ok) {
        if (progress) progress.textContent = "MAPPHEX Workspace App installed. Opening workspace...";
        setTimeout(openWorkspace, 900);
        return;
      }
      const reason = pwaResult?.reason;
      const message =
        reason === "dismissed"
          ? "Modules are installed. You dismissed the app install prompt; click Try install prompt again or open the workspace."
          : manualInstallMessage();
      if (progress) progress.textContent = message;
      showPwaHelp(message);
      if (reason !== "dismissed") window.setTimeout(openWorkspace, 2800);
      return;
    }
    if (progress && !options.installPwa) progress.textContent = "Unified installation complete. Opening the workspace app...";
    setTimeout(() => {
      openWorkspace();
    }, options.installPwa ? 1100 : 750);
  };

  document.addEventListener("DOMContentLoaded", () => {
    document.addEventListener("click", guardPortalLink);
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
    $("#portal-select-all")?.addEventListener("click", selectAllAvailable);
    $("#portal-clear-selection")?.addEventListener("click", () => {
      selected.clear();
      render();
    });
    $("#portal-install-selected")?.addEventListener("click", (event) => {
      const btn = event.currentTarget;
      if (!selected.size) return;
      btn.disabled = true;
      btn.textContent = "Installing workspace app...";
      install([...selected], { installPwa: true })
        .catch((err) => {
          const progress = $("#portal-progress");
          if (progress) progress.textContent = "Installation failed. Try again.";
          window.EnterpriseCore?.notify?.("Install failed", err.message, "error");
        })
        .finally(() => {
          btn.textContent = "Install Selected as App";
          renderBulkBar();
        });
    });
    $("#pwa-retry-install")?.addEventListener("click", async () => {
      const progress = $("#portal-progress");
      if (progress) progress.textContent = "Trying the device app install prompt...";
      const result = await promptWorkspacePwa();
      if (result?.ok) {
        if (progress) progress.textContent = "MAPPHEX Workspace App installed. Opening workspace...";
        setTimeout(openWorkspace, 900);
      } else {
        const message = manualInstallMessage();
        if (progress) progress.textContent = message;
        showPwaHelp(message);
        window.setTimeout(openWorkspace, 2800);
      }
    });
    window.MapphexPWA?.onStatus?.((status) => {
      const help = $("#pwa-install-help");
      if (status.promptReady && help?.hidden === false) {
        $("#pwa-install-help-text").textContent = "The app install prompt is ready. Click Try install prompt again to install MAPPHEX Workspace App on this device.";
      }
    });
    load().catch((err) => window.EnterpriseCore?.notify?.("Portal manager", err.message, "error"));
  });
})();
