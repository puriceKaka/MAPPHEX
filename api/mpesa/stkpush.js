const { sendJson, readJsonBody } = require("../_lib/http");
const { getStore } = require("../_lib/kv-store");
const { baseUrl, mustEnv, nowTimestamp, normalizeMsisdn, getAccessToken, stkPassword } = require("../_lib/mpesa");

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const body = await readJsonBody(req);
    if (!body || typeof body !== "object") return sendJson(res, 400, { ok: false, error: "Invalid body" });

    const amount = Math.round(Number(body.amount || 0));
    const phone = normalizeMsisdn(body.phoneNumber || body.phone || "");
    const accountReference = String(body.accountReference || "Jixels").slice(0, 32);
    const transactionDesc = String(body.transactionDesc || "Payment").slice(0, 64);

    if (!Number.isFinite(amount) || amount <= 0) return sendJson(res, 400, { ok: false, error: "Invalid amount" });
    if (!phone) return sendJson(res, 400, { ok: false, error: "Invalid phone number" });

    const shortcode = mustEnv("MPESA_SHORTCODE");
    const passkey = mustEnv("MPESA_PASSKEY");
    const txType = String(process.env.MPESA_TX_TYPE || "CustomerPayBillOnline").trim() || "CustomerPayBillOnline";

    const cb = String(process.env.MPESA_CALLBACK_URL || "").trim();
    const callbackUrl = cb || `${String(body.callbackUrl || "").trim()}`;
    if (!callbackUrl) return sendJson(res, 500, { ok: false, error: "Missing callback URL (set MPESA_CALLBACK_URL)" });

    const timestamp = nowTimestamp();
    const password = stkPassword(shortcode, passkey, timestamp);
    const token = await getAccessToken();

    const url = `${baseUrl()}/mpesa/stkpush/v1/processrequest`;
    const payload = {
      BusinessShortCode: shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: txType,
      Amount: amount,
      PartyA: phone,
      PartyB: shortcode,
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: accountReference,
      TransactionDesc: transactionDesc,
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok || !data) {
      return sendJson(res, 502, { ok: false, error: "M-Pesa request failed", status: r.status, data });
    }

    // Store a small audit trail so Finance can reconcile later.
    const store = getStore();
    const logKey = "jixels_mpesa_stk_requests_v1";
    const current = (await store.get(logKey)) || [];
    const arr = Array.isArray(current) ? current : [];
    arr.push({
      at: new Date().toISOString(),
      amount,
      phoneNumber: phone,
      phoneMasked: String(phone).slice(0, 6) + "***" + String(phone).slice(-2),
      accountReference,
      transactionDesc,
      response: data,
    });
    await store.set(logKey, arr.slice(-400));

    return sendJson(res, 200, { ok: true, request: payload, response: data });
  } catch (err) {
    const status = Number(err?.statusCode || 500) || 500;
    return sendJson(res, status, { ok: false, error: "Server error" });
  }
};
