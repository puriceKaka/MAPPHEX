(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const ORGS_KEY = "platform_organizations_v1";
  const USERS_KEY = "enterprise_org_users_v1";
  const PROFILE_KEY = "enterprise_org_profile_v1";
  const SETTINGS_KEY = "enterprise_org_settings_v1";

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

  const cleanTenantId = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);

  const slug = (value) => cleanTenantId(value).slice(0, 42) || "organization";

  const digest = async (value) => {
    if (window.crypto?.subtle) {
      const bytes = new TextEncoder().encode(String(value || ""));
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return btoa(unescape(encodeURIComponent(String(value || ""))));
  };

  const parseJsonResponse = async (res) => {
    const text = await res.text();
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      const err = new Error("Registration service returned an invalid response. Using local workspace mode.");
      err.invalidJson = true;
      err.status = res.status;
      err.preview = text.slice(0, 80);
      throw err;
    }
  };

  const postJson = async (url, body) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await parseJsonResponse(res);
    return { res, data };
  };

  const createLocalOrganization = async (body) => {
    const now = new Date().toISOString();
    const base = slug(body.name || body.organizationName);
    const unique = Math.random().toString(16).slice(2, 8).toUpperCase();
    const tenantId = cleanTenantId(`${base}-${unique.toLowerCase()}`);
    const orgCode = `${base.toUpperCase().replace(/-/g, "").slice(0, 10)}-${unique}`;
    const adminEmail = String(body.adminEmail || body.email || "").trim().toLowerCase();
    const organization = {
      id: tenantId,
      organizationId: `ORG-${orgCode}`,
      referenceCode: orgCode,
      name: String(body.name || "Organization").trim(),
      businessType: String(body.businessType || "company").trim(),
      contact: {
        email: String(body.email || adminEmail).trim().toLowerCase(),
        phone: String(body.phone || "").trim(),
        location: String(body.location || "").trim(),
      },
      companySize: String(body.companySize || "1-10").trim(),
      status: "active",
      subscriptionStatus: "trial",
      admin: { name: String(body.adminName || "Organization Admin").trim(), email: adminEmail, role: "org_admin" },
      metrics: { users: 1, branches: Number(body.branchCount || 0) || 0, inventoryItems: 0, orders: 0, revenue: 0 },
      createdAt: now,
      updatedAt: now,
      localPasswordHash: await digest(body.adminPassword || body.password || ""),
    };

    const rows = readJson(ORGS_KEY, []);
    writeJson(ORGS_KEY, [organization, ...(Array.isArray(rows) ? rows : [])]);
    window.EnterpriseCore?.setTenant?.(tenantId);
    writeJson(USERS_KEY, [
      {
        id: `user-${Date.now()}`,
        name: organization.admin.name,
        email: adminEmail,
        role: "org_admin",
        permissions: ["*"],
        status: "active",
        createdAt: now,
      },
    ]);
    writeJson(PROFILE_KEY, organization);
    writeJson(SETTINGS_KEY, {
      modules: ["dashboard", "inventory", "orders", "finance", "crm", "documents"],
      installedPortals: [],
      agreementAccepted: false,
      onboardingComplete: false,
      businessType: organization.businessType,
      branches: Array.from({ length: organization.metrics.branches }, (_, idx) => `Branch ${idx + 1}`),
      departments: [],
      createdAt: now,
    });
    window.EnterpriseCore?.audit?.("organization.registered.local", { organizationId: organization.organizationId });
    return { ok: true, organization, tenantId, organizationId: organization.organizationId, localMode: true };
  };

  document.addEventListener("DOMContentLoaded", () => {
    $("#org-register-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const result = $("#org-register-result");
      result.textContent = "Creating organization...";
      const body = Object.fromEntries(new FormData(event.currentTarget).entries());
      body.action = "register";
      try {
        let data;
        try {
          const response = await postJson("/api/organizations", body);
          data = response.data;
          if (!response.res.ok || !data?.ok) throw new Error(data?.error || "Registration failed");
        } catch (apiErr) {
          data = await createLocalOrganization(body);
        }
        window.EnterpriseCore?.setTenant?.(data.tenantId);
        let sessionData = null;
        try {
          const sessionResponse = await postJson("/api/auth/session", {
            action: "organization-login",
            role: "org_admin",
            organizationName: body.name,
            identifier: data.organizationId || data.tenantId || body.email,
            tenantId: data.tenantId,
            email: body.adminEmail,
            password: body.adminPassword,
          });
          if (sessionResponse.res.ok && sessionResponse.data?.ok) sessionData = sessionResponse.data;
        } catch {
          sessionData = null;
        }
        if (sessionData?.ok) {
          window.EnterpriseCore?.setSession?.(
            {
              role: "org_admin",
              email: body.adminEmail,
              tenantId: data.tenantId,
              token: sessionData.token,
              organizationId: data.organizationId,
              expiresAt: new Date(sessionData.session.exp).toISOString(),
            },
            true,
          );
        } else {
          window.EnterpriseCore?.setSession?.(
            {
              role: "org_admin",
              email: body.adminEmail,
              tenantId: data.tenantId,
              organizationId: data.organizationId,
              localMode: data.localMode === true,
            },
            true,
          );
        }
        result.style.color = "var(--ok)";
        result.textContent = `Created ${data.organization.name}. ID: ${data.organizationId}`;
        setTimeout(() => {
          location.href = `organization-agreement.html?tenant=${encodeURIComponent(data.tenantId)}`;
        }, 900);
      } catch (err) {
        result.style.color = "var(--danger)";
        result.textContent = err.message;
      }
    });
  });
})();
