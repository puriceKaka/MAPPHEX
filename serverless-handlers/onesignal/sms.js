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
      target_channel: "sms",
      include_phone_numbers: body.include_phone_numbers || body.includePhoneNumbers,
      include_aliases: body.include_aliases || body.includeAliases,
      included_segments: body.included_segments || body.includedSegments,
      excluded_segments: body.excluded_segments || body.excludedSegments,
      filters: body.filters,
      contents: body.contents,
      sms_from: body.sms_from || body.smsFrom,
      sms_media_urls: body.sms_media_urls || body.smsMediaUrls,
      name: body.name,
      custom_data: body.custom_data || body.customData,
      idempotency_key: body.idempotency_key || body.idempotencyKey,
    };

    if (!payload.contents || typeof payload.contents !== "object") {
      return sendJson(res, 400, { ok: false, error: "contents is required" });
    }

    const r = await fetch("https://api.onesignal.com/notifications?c=sms", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) return sendJson(res, 502, { ok: false, error: "OneSignal SMS request failed", status: r.status, data });
    return sendJson(res, 200, { ok: true, data });
  } catch (err) {
    const status = Number(err?.statusCode || 500) || 500;
    return sendJson(res, status, { ok: false, error: "Server error" });
  }
};

