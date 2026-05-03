const MPESA_TOKEN_SKEW_MS = 60_000; // refresh 1 min early

let cachedToken = null;
let cachedTokenExp = 0;
let cachedBaseUrl = "";

const baseUrl = () => {
  const envUrl = String(process.env.MPESA_BASE_URL || "").trim();
  if (envUrl) return envUrl.replace(/\/+$/, "");
  const env = String(process.env.MPESA_ENV || "sandbox").toLowerCase();
  return env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";
};

const mustEnv = (name) => {
  const v = String(process.env[name] || "").trim();
  if (!v) {
    const err = new Error(`Missing env var: ${name}`);
    err.statusCode = 500;
    throw err;
  }
  return v;
};

const nowTimestamp = () =>
  new Date().toISOString().replace(/[-T:.Z]/g, "").slice(0, 14);

const toBase64 = (text) => Buffer.from(String(text || ""), "utf8").toString("base64");

const normalizeMsisdn = (phone) => {
  const cleaned = String(phone || "").replace(/[\s-]/g, "");
  if (!cleaned) return null;
  const digits = cleaned.replace(/^\+/, "");
  if (!/^\d+$/.test(digits)) return null;

  if (digits.startsWith("254")) return digits;
  if (digits.startsWith("0") && digits.length >= 10) return `254${digits.slice(1)}`;
  if (digits.startsWith("7") || digits.startsWith("1")) return `254${digits}`;
  return null;
};

const getAccessToken = async () => {
  const b = baseUrl();
  const now = Date.now();
  if (cachedToken && cachedBaseUrl === b && cachedTokenExp - MPESA_TOKEN_SKEW_MS > now) return cachedToken;

  const consumerKey = mustEnv("MPESA_CONSUMER_KEY");
  const consumerSecret = mustEnv("MPESA_CONSUMER_SECRET");
  const auth = toBase64(`${consumerKey}:${consumerSecret}`);

  const tokenUrl = `${b}/oauth/v1/generate?grant_type=client_credentials`;
  const res = await fetch(tokenUrl, { headers: { Authorization: `Basic ${auth}` } });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.access_token) {
    const err = new Error("Failed to get M-Pesa access token");
    err.statusCode = 502;
    err.details = { status: res.status, data };
    throw err;
  }

  const expiresIn = Number(data.expires_in || 3600) || 3600;
  cachedToken = String(data.access_token);
  cachedTokenExp = Date.now() + expiresIn * 1000;
  cachedBaseUrl = b;
  return cachedToken;
};

const stkPassword = (shortcode, passkey, timestamp) =>
  toBase64(`${shortcode}${passkey}${timestamp}`);

module.exports = {
  baseUrl,
  mustEnv,
  nowTimestamp,
  normalizeMsisdn,
  getAccessToken,
  stkPassword,
};

