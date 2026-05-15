(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  const ORGS_KEY = "platform_organizations_v1";
  const SETTINGS_KEY = "enterprise_org_settings_v1";
  const USERS_KEY = "enterprise_org_users_v1";
  const MODULE_DATA_KEY = "enterprise_module_records_v1";
  const ACTIVITY_KEY = "enterprise_module_activity_v1";

  const PORTAL_CATALOG = [
    { id: "branch", title: "Branch Management", href: "organization-module.html", description: "Manage branches, local teams, performance, and branch analytics.", features: ["Branch records", "Local teams", "Operational scope"] },
    { id: "departments", title: "Department Management", href: "organization-module.html", description: "Create departments, assign employees, manage approvals, and track workflows.", features: ["Department roles", "Approvals", "Workflows"] },
    { id: "hr", title: "HR Module", href: "organization-module.html", description: "Employee records, attendance, payroll structure, role assignment, and HR reports.", features: ["Shared users", "Workforce reports", "Role access"] },
    { id: "finance", title: "Finance Module", href: "organization-module.html", description: "Income, expenses, transaction logs, financial summaries, and reports.", features: ["Shared transactions", "Expense views", "Reports"] },
    { id: "pharmacy", title: "Pharmacy Module", href: "organization-module.html", description: "Medicine inventory, stock tracking, suppliers, and expiry monitoring.", features: ["Medicine stock", "Supplier control", "Shared inventory"] },
    { id: "inventory", title: "Inventory Module", href: "organization-module.html", description: "Stock management, item tracking, warehouse control, and movement logs.", features: ["Stock levels", "Transfers", "Availability"] },
    { id: "logistics", title: "Logistics Module", href: "organization-module.html", description: "Delivery tracking, dispatch management, fleet operations, and shipment status.", features: ["Dispatch", "Tracking", "Delivery status"] },
    { id: "sales", title: "Sales Module", href: "organization-module.html", description: "Customer management, sales records, order tracking, and performance dashboards.", features: ["Customers", "Sales activity", "Performance"] },
    { id: "analytics", title: "Analytics Module", href: "organization-module.html", description: "Real-time charts, business insights, activity tracking, and performance dashboards.", features: ["Charts", "Insights", "Activity trends"] },
    { id: "admin", title: "Admin Module", href: "organization-admin.html", description: "Organization settings, users, roles, permissions, and module activation control.", features: ["Users", "Settings", "Permissions"] },
    { id: "staff", title: "Staff Module", href: "organization-module.html", description: "Task assignments, notifications, role dashboards, and daily activity views.", features: ["Tasks", "Notifications", "Role access"] },
    { id: "customer", title: "Customer Module", href: "organization-module.html", description: "Customer records, service tracking, support tickets, and interaction history.", features: ["Customers", "Service records", "Support"] },
    { id: "reporting", title: "Reporting Module", href: "organization-module.html", description: "Exportable reports, financial summaries, operational reports, and printable analytics.", features: ["Operational reports", "Financial summaries", "Exports"] },
  ];
  const VALID_PORTAL_IDS = new Set(PORTAL_CATALOG.map((portal) => portal.id));

  const MODULE_WORKFLOWS = {
    branch: { title: "Branch Operations", labels: ["Branch", "Manager", "Performance", "Status"], sample: ["Nairobi CBD", "Branch Lead", "92%", "Active"] },
    departments: { title: "Department Workflows", labels: ["Department", "Lead", "Workflow", "Approval"], sample: ["Operations", "Supervisor", "Procurement", "Pending"] },
    hr: { title: "HR Records", labels: ["Employee", "Role", "Attendance", "Payroll"], sample: ["Jane Staff", "Pharmacist", "Present", "Processed"] },
    finance: { title: "Finance Ledger", labels: ["Transaction", "Type", "Amount", "Status"], sample: ["Daily Sales", "Income", "45000", "Posted"] },
    pharmacy: { title: "Pharmacy Stock", labels: ["Medicine", "Supplier", "Expiry", "Stock"], sample: ["Amoxicillin", "Prime Supplier", "2027-04", "260"] },
    inventory: { title: "Inventory Control", labels: ["Item", "Warehouse", "Movement", "Quantity"], sample: ["Barcode Scanner", "Main Store", "Received", "12"] },
    logistics: { title: "Logistics Flow", labels: ["Shipment", "Driver/Fleet", "Route", "Status"], sample: ["ORD-2048", "Fleet 03", "Nairobi-Kisumu", "In transit"] },
    sales: { title: "Sales Pipeline", labels: ["Customer", "Order", "Value", "Status"], sample: ["Acme Retail", "SO-1021", "12800", "Confirmed"] },
    analytics: { title: "Analytics Insights", labels: ["Metric", "Source", "Trend", "Action"], sample: ["Revenue", "Finance", "+14%", "Review"] },
    admin: { title: "Admin Controls", labels: ["Setting", "Scope", "Owner", "Status"], sample: ["Role Policy", "Organization", "Admin", "Active"] },
    staff: { title: "Staff Tasks", labels: ["Task", "Assigned To", "Priority", "Status"], sample: ["Stock count", "Store Staff", "High", "Open"] },
    customer: { title: "Customer Operations", labels: ["Customer", "Interaction", "Ticket", "Status"], sample: ["Walk-in Client", "Support", "TCK-88", "Open"] },
    reporting: { title: "Reporting Center", labels: ["Report", "Scope", "Format", "Status"], sample: ["Monthly Summary", "Organization", "PDF", "Ready"] },
  };

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

  const moduleUrl = (id, tenantId) => `organization-module.html?tenant=${encodeURIComponent(tenantId)}&portal=${encodeURIComponent(id)}`;

  const moduleData = () => readJson(MODULE_DATA_KEY, {});
  const saveModuleData = (data) => writeJson(MODULE_DATA_KEY, data);

  const appendActivity = (moduleId, action, detail) => {
    const rows = readJson(ACTIVITY_KEY, []);
    rows.push({ id: `act-${Date.now()}`, moduleId, action, detail, at: new Date().toISOString() });
    writeJson(ACTIVITY_KEY, rows.slice(-400));
    window.EnterpriseCore?.notify?.("Workspace updated", `${action} in ${moduleId}`);
  };

  const renderNav = (catalog, installed, activeId, tenantId) => {
    const nav = $("#module-nav");
    nav.innerHTML = catalog
      .filter((portal) => installed.has(portal.id))
      .map(
        (portal) => `<a class="${portal.id === activeId ? "active" : ""}" href="${escapeHtml(moduleUrl(portal.id, tenantId))}">
          <span>${escapeHtml(portal.title)}</span><small>${portal.id === activeId ? "Active" : "Open"}</small>
        </a>`,
      )
      .join("");
  };

  const setMenuOpen = (open) => {
    $("#module-sidebar")?.classList.toggle("is-open", open);
    $("#module-menu-toggle")?.setAttribute("aria-expanded", String(open));
  };

  const renderForm = (workflow) => {
    $("#module-record-form").innerHTML = workflow.labels
      .map((label, idx) => `<label class="field"><span>${escapeHtml(label)}</span><input name="field${idx}" required value="${escapeHtml(workflow.sample[idx] || "")}" /></label>`)
      .join("") + `<button class="btn primary" type="submit">Add Record</button>`;
  };

  const renderRows = (moduleId, workflow, query = "") => {
    const data = moduleData();
    const rows = Array.isArray(data[moduleId]) ? data[moduleId] : [];
    const q = query.trim().toLowerCase();
    const visible = q ? rows.filter((row) => row.values.join(" ").toLowerCase().includes(q)) : rows;
    $("#module-empty").hidden = visible.length > 0;
    $("#module-table-head").innerHTML = [...workflow.labels, "Updated"].map((label) => `<th>${escapeHtml(label)}</th>`).join("");
    $("#module-table-body").innerHTML = visible
      .map((row) => `<tr>${row.values.map((value) => `<td>${escapeHtml(value)}</td>`).join("")}<td>${escapeHtml(new Date(row.updatedAt).toLocaleString())}</td></tr>`)
      .join("");
    $("#module-kpi-a").textContent = rows.length;
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
          users: readJson(USERS_KEY, []),
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

      const installed = new Set((settings.installedPortals || []).filter((id) => VALID_PORTAL_IDS.has(id)));
      if (!moduleId || !installed.has(moduleId)) {
        location.replace(`portal-selection.html?tenant=${encodeURIComponent(session.tenantId)}`);
        return;
      }

      const moduleDef = (admin.portalCatalog || PORTAL_CATALOG).find((item) => item.id === moduleId);
      if (!moduleDef) throw new Error("Module not found");
      const workflow = MODULE_WORKFLOWS[moduleId] || MODULE_WORKFLOWS.reporting;
      const org = mine?.organization || {};
      const permissions = settings.modulePermissions?.[moduleId] || [];
      const moduleCode = (moduleDef.title || "M").slice(0, 2).toUpperCase();

      document.title = `${moduleDef.title} • MAPPHEX`;
      $("#module-title").textContent = moduleDef.title;
      $("#module-subtitle").textContent = `${org.organizationId || session.tenantId} • workspace portal`;
      $("#module-heading").textContent = moduleDef.title;
      $("#module-description").textContent = `${moduleDef.description} This portal runs inside ${org.name || "the organization's"} workspace with the active account, roles, analytics, and activity stream.`;
      $("#module-icon").textContent = moduleCode;
      $("#module-org-name").textContent = org.name || "Organization";
      $("#module-org-id").textContent = org.organizationId || session.tenantId;
      $("#module-kpi-a-label").textContent = workflow.labels[0];
      $("#module-kpi-a-foot").textContent = workflow.title;
      $("#module-kpi-users").textContent = Array.isArray(admin.users) ? admin.users.length : 0;
      $("#module-kpi-modules").textContent = installed.size;
      $("#module-kpi-tenant").textContent = session.tenantId;
      $("#hub-link").href = `organization-workspace.html?tenant=${encodeURIComponent(session.tenantId)}`;
      $("#settings-link").href = `organization-admin.html?tenant=${encodeURIComponent(session.tenantId)}`;
      $("#module-workflow-title").textContent = workflow.title;
      $("#module-workflow-subtitle").textContent = moduleDef.description;
      $("#module-permissions").textContent = permissions.length ? permissions.map(escapeHtml).join(", ") : "Uses inherited organization permissions.";

      renderNav(admin.portalCatalog || PORTAL_CATALOG, installed, moduleId, session.tenantId);
      renderForm(workflow);
      renderRows(moduleId, workflow);

      $("#module-menu-toggle")?.addEventListener("click", () => setMenuOpen(true));
      $("#module-menu-close")?.addEventListener("click", () => setMenuOpen(false));
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") setMenuOpen(false);
      });
      $("#module-search")?.addEventListener("input", (event) => renderRows(moduleId, workflow, event.currentTarget.value));
      $("#module-record-form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const values = workflow.labels.map((_, idx) => String(new FormData(event.currentTarget).get(`field${idx}`) || "").trim());
        if (values.some((value) => !value)) return;
        const data = moduleData();
        const rows = Array.isArray(data[moduleId]) ? data[moduleId] : [];
        rows.unshift({ id: `${moduleId}-${Date.now()}`, values, updatedAt: new Date().toISOString(), tenantId: session.tenantId });
        data[moduleId] = rows.slice(0, 500);
        saveModuleData(data);
        appendActivity(moduleId, "record.created", { values });
        renderRows(moduleId, workflow, $("#module-search")?.value || "");
      });

    } catch (err) {
      window.EnterpriseCore?.notify?.("Module", err.message, "error");
    }
  });
})();
