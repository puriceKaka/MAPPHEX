const crypto = require("crypto");
const { sendJson, readJsonBody } = require("../../api/_lib/http");
const { getTenantId } = require("../../api/_lib/tenant");
const { verifyOrganizationAdmin } = require("../organizations");
const { decodeSessionToken } = require("../../api/_lib/security");

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

const secret = () => process.env.SESSION_SECRET || process.env.AUTH_SECRET || "development-session-secret";

const sign = (payload) =>
  crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

const encodeToken = (claims) => {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload)}`;
};

module.exports = async (req, res) => {
  try {
    if (req.method === "POST") {
      const body = await readJsonBody(req);
      const role = String(body?.role || "org_admin").trim().toLowerCase();
      const identifier = String(body?.identifier || body?.tenantId || body?.email || body?.username || "").trim();
      const email = String(body?.email || body?.username || body?.identifier || "").trim().toLowerCase();
      if (!identifier) return sendJson(res, 400, { ok: false, error: "Organization ID or company email is required" });
      let tenantId = getTenantId(req, body);
      let organization = null;
      if (body?.action === "organization-login" || role === "org_admin") {
        organization = await verifyOrganizationAdmin(identifier || tenantId, email, body?.password);
        if (!organization) return sendJson(res, 401, { ok: false, error: "Invalid organization credentials" });
        tenantId = organization.id;
      }
      const now = Date.now();
      const claims = {
        sub: organization?.admin?.email || email || identifier.toLowerCase(),
        role,
        tenantId,
        organizationId: organization?.organizationId,
        iat: now,
        exp: now + SESSION_TTL_MS,
      };
      return sendJson(res, 200, { ok: true, token: encodeToken(claims), session: claims, organization });
    }

    if (req.method === "GET") {
      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      const session = decodeSessionToken(token);
      return sendJson(res, session ? 200 : 401, session ? { ok: true, session } : { ok: false, error: "Invalid session" });
    }

    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  } catch {
    return sendJson(res, 500, { ok: false, error: "Server error" });
  }
};
