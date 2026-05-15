const { sendJson, readJsonBody } = require("../../api/_lib/http");
const { getStore } = require("../../api/_lib/kv-store");

const postOneSignal = async (path, payload) => {
  const appId = String(process.env.ONESIGNAL_APP_ID || "").trim();
  const apiKey = String(process.env.ONESIGNAL_API_KEY || "").trim();
  if (!appId || !apiKey) return null;
  const url = path === "sms" ? "https://api.onesignal.com/notifications?c=sms" : "https://api.onesignal.com/notifications";
  const body = { app_id: appId, ...payload };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${apiKey}` },
    body: JSON.stringify(body),
  });
  return res.json().catch(() => null);
};

const pickItem = (items, name) => {
  if (!Array.isArray(items)) return null;
  const found = items.find((x) => x && typeof x === "object" && String(x.Name || "") === name) || null;
  return found && Object.prototype.hasOwnProperty.call(found, "Value") ? found.Value : null;
};

module.exports = async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

  try {
    const body = await readJsonBody(req);
    const cb = body?.Body?.stkCallback || null;
    if (!cb || typeof cb !== "object") return sendJson(res, 400, { ok: false, error: "Invalid callback" });

    const resultCode = Number(cb.ResultCode);
    const resultDesc = String(cb.ResultDesc || "");
    const metaItems = cb?.CallbackMetadata?.Item || [];

    const entry = {
      at: new Date().toISOString(),
      merchantRequestId: String(cb.MerchantRequestID || ""),
      checkoutRequestId: String(cb.CheckoutRequestID || ""),
      resultCode: Number.isFinite(resultCode) ? resultCode : null,
      resultDesc,
      amount: pickItem(metaItems, "Amount"),
      receipt: pickItem(metaItems, "MpesaReceiptNumber"),
      transactionDate: pickItem(metaItems, "TransactionDate"),
      phoneNumber: pickItem(metaItems, "PhoneNumber"),
      raw: body,
    };

    const store = getStore();
    const logKey = "enterprise_mpesa_stk_callbacks_v1";
    const current = (await store.get(logKey)) || [];
    const arr = Array.isArray(current) ? current : [];
    arr.push(entry);
    await store.set(logKey, arr.slice(-800));

    const success = Number(entry.resultCode) === 0;
    const amount = Number(entry.amount || 0) || 0;
    const receipt = String(entry.receipt || entry.checkoutRequestId || "");
    if (success) {
      const title = "M-Pesa payment confirmed";
      const msg = `KES ${amount.toLocaleString("en-US")} confirmed. Receipt ${receipt}`;
      await postOneSignal("push", {
        included_segments: ["Finance", "Sales", "Branches"],
        headings: { en: title },
        contents: { en: msg },
        data: { type: "mpesa_callback", amountKes: amount, receipt, checkoutRequestId: entry.checkoutRequestId },
      }).catch(() => null);
      if (entry.phoneNumber) {
        await postOneSignal("sms", {
          include_phone_numbers: [String(entry.phoneNumber)],
          contents: { en: `MAPPHEX: Payment received KES ${amount.toLocaleString("en-US")}. Receipt ${receipt}.` },
          data: { type: "mpesa_receipt", receipt },
        }).catch(() => null);
      }
    }

    // Acknowledge to Safaricom.
    return sendJson(res, 200, { ResultCode: 0, ResultDesc: "Accepted" });
  } catch (err) {
    const status = Number(err?.statusCode || 500) || 500;
    return sendJson(res, status, { ok: false, error: "Server error" });
  }
};
