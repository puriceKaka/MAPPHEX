const { sendJson } = require("../api/_lib/http");

const normalizePathname = (pathname) => {
  const clean = String(pathname || "").replace(/\/+$/, "");
  return clean || "/";
};

const routes = new Map([
  ["/api/assets/sync", () => require("./assets/sync")],
  ["/api/audit", () => require("./audit")],
  ["/api/auth/session", () => require("./auth/session")],
  ["/api/files", () => require("./files")],
  ["/api/health", () => require("./health")],
  ["/api/kv", () => require("./kv")],
  ["/api/kv/batch", () => require("./kv/batch")],
  ["/api/modules", () => require("./modules")],
  ["/api/mpesa/callback", () => require("./mpesa/callback")],
  ["/api/mpesa/stkpush", () => require("./mpesa/stkpush")],
  ["/api/onesignal/notify", () => require("./onesignal/notify")],
  ["/api/onesignal/sms", () => require("./onesignal/sms")],
  ["/api/org-admin", () => require("./org-admin")],
  ["/api/organizations", () => require("./organizations")],
  ["/api/platform-monitoring", () => require("./platform-monitoring")],
  ["/api/realtime", () => require("./realtime")],
  ["/api/tasks", () => require("./tasks")]
]);

module.exports = async (req, res) => {
  try {
    const baseUrl = `http://${req.headers.host || "localhost"}`;
    const url = new URL(req.url || "/", baseUrl);
    const loadHandler = routes.get(normalizePathname(url.pathname));

    if (!loadHandler) {
      return sendJson(res, 404, { ok: false, error: "API route not found" });
    }

    req.query = Object.fromEntries(url.searchParams.entries());
    return loadHandler()(req, res);
  } catch (error) {
    return sendJson(res, Number(error && error.statusCode) || 500, {
      ok: false,
      error: error && error.message ? error.message : "Server error"
    });
  }
};
