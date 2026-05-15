const { sendJson, readJsonBody } = require("../../api/_lib/http");

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

  const appId = String(process.env.ONESIGNAL_APP_ID || "").trim();
  const apiKey = String(process.env.ONESIGNAL_API_KEY || "").trim();
  if (!appId || !apiKey) return sendJson(res, 500, { ok: false, error: "Missing OneSignal env vars" });

  try {
    const body = await readJsonBody(req);
    if (!body || typeof body !== "object") return sendJson(res, 400, { ok: false, error: "Invalid body" });

    const payload = {
      app_id: appId,
      target_channel: body.target_channel || body.targetChannel || "push",
      included_segments: body.included_segments || body.includedSegments,
      excluded_segments: body.excluded_segments || body.excludedSegments,
      include_aliases: body.include_aliases || body.includeAliases,
      filters: body.filters,
      headings: body.headings,
      contents: body.contents,
      data: body.data,
      url: body.url,
      name: body.name,
    };

    if (!payload.contents || typeof payload.contents !== "object") {
      return sendJson(res, 400, { ok: false, error: "contents is required" });
    }

    const r = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) return sendJson(res, 502, { ok: false, error: "OneSignal request failed", status: r.status, data });
    return sendJson(res, 200, { ok: true, data });
  } catch (err) {
    const status = Number(err?.statusCode || 500) || 500;
    return sendJson(res, status, { ok: false, error: "Server error" });
  }
};

