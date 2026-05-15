const { sendJson, readJsonBody } = require("../../api/_lib/http");
const { getStore } = require("../../api/_lib/kv-store");
const { getTenantId, scopeTenantKey } = require("../../api/_lib/tenant");
const { appendEvent } = require("../../api/_lib/events");
const { assertIdempotent, rateLimit, safeString } = require("../../api/_lib/security");

const ERP_KEY = "enterprise_erp_v1";
const BRANCH_COUNT = 47;

const isoNow = () => new Date().toISOString();

const toMoney = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : fallback;
};

const makeDefaultErp = () => {
  const branches = Array.from({ length: BRANCH_COUNT }, (_, idx) => {
    const id = `b${String(idx + 1).padStart(2, "0")}`;
    return {
      id,
      name: `Branch ${String(idx + 1).padStart(2, "0")}`,
      city: "",
      area: "",
      employees: 0,
      inventory: [],
      phones: [],
      soldPhones: [],
      transactions: [],
      txLog: [],
      damageLoss: [],
      financeSummary: { mpesaIn: 0, bankIn: 0, txCount: 0, lastTxAt: "" },
      ledger: { head: "GENESIS" },
      updatedAt: isoNow(),
    };
  });
  return { version: 1, lastUpdated: isoNow(), branches, departments: {} };
};

const normalizeBranch = (branch) => {
  if (!branch || typeof branch !== "object") return null;
  if (!Array.isArray(branch.inventory)) branch.inventory = [];
  if (!Array.isArray(branch.phones)) branch.phones = [];
  if (!Array.isArray(branch.soldPhones)) branch.soldPhones = [];
  if (!Array.isArray(branch.transactions)) branch.transactions = [];
  if (!Array.isArray(branch.txLog)) branch.txLog = [];
  if (!Array.isArray(branch.damageLoss)) branch.damageLoss = [];
  if (!branch.financeSummary || typeof branch.financeSummary !== "object") {
    branch.financeSummary = { mpesaIn: 0, bankIn: 0, txCount: 0, lastTxAt: "" };
  }
  if (!branch.ledger || typeof branch.ledger !== "object") branch.ledger = { head: "GENESIS" };
  return branch;
};

const rebuildInventoryFromPhones = (branch) => {
  const phones = Array.isArray(branch.phones) ? branch.phones : [];
  const soldPhones = Array.isArray(branch.soldPhones) ? branch.soldPhones : [];
  const byModel = new Map();
  for (const phone of [...phones, ...soldPhones]) {
    const model = String(phone.model || "").trim() || "-";
    const row = byModel.get(model) || { model, stock: 0, sold: 0 };
    if (String(phone.status || "in_stock") === "sold") row.sold += 1;
    else row.stock += 1;
    byModel.set(model, row);
  }
  branch.inventory = Array.from(byModel.values()).sort((a, b) => String(a.model).localeCompare(String(b.model)));
};

const getAssignments = (body) => {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.assignments)) return body.assignments;
  if (Array.isArray(body?.allocations)) return body.allocations;
  if (Array.isArray(body?.assignedPhones)) return body.assignedPhones;
  if (Array.isArray(body?.phones)) return body.phones;
  if (Array.isArray(body?.assets)) return body.assets;
  if (body && typeof body === "object") return [body];
  return [];
};

const normalizeBranchToken = (value) => String(value || "").trim().toLowerCase();

const findBranch = (erp, item) => {
  const rawId = String(item.branchId || item.branch_id || item.branch || item.branchCode || item.assignedBranchId || "").trim();
  const rawName = String(item.branchName || item.assignedBranch || item.allocatedBranch || item.allocatedToBranch || "").trim();
  const numeric = rawId.match(/^\d+$/) ? `b${String(Number(rawId)).padStart(2, "0")}` : "";
  const candidates = [rawId, rawName, numeric].map(normalizeBranchToken).filter(Boolean);
  return (erp.branches || []).find((branch) => {
    const id = normalizeBranchToken(branch.id);
    const name = normalizeBranchToken(branch.name);
    return candidates.some((candidate) => candidate === id || candidate === name);
  });
};

const itemSerial = (item) =>
  String(item.serial || item.imei || item.assetTag || item.assetId || item.id || "").trim();

const hasSerial = (erp, serial) => {
  const needle = String(serial || "").trim().toLowerCase();
  if (!needle) return false;
  return (erp.branches || []).some((branch) =>
    [...(branch.phones || []), ...(branch.soldPhones || [])].some((phone) => itemSerial(phone).toLowerCase() === needle),
  );
};

const makePhone = (item, serial) => {
  const model = String(item.model || item.name || item.assetName || item.phoneModel || item.phoneName || "").trim();
  return {
    id: String(item.id || item.assetId || `asset-${serial}`).trim(),
    model,
    color: String(item.color || "").trim(),
    storage: String(item.storage || item.capacity || "").trim(),
    serial,
    price: toMoney(item.price || item.cost || item.value || item.amount, 0),
    status: "in_stock",
    source: "asset-management",
    syncedFrom: String(item.source || "External asset feed").trim(),
    assignedAt: item.assignedAt || item.createdAt || isoNow(),
    createdAt: item.createdAt || isoNow(),
  };
};

module.exports = async (req, res) => {
  try {
    const origin = String(req.headers.origin || "*");
    const allowedOrigin = String(process.env.ASSET_SYNC_ALLOWED_ORIGIN || origin || "*").trim();
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Asset-Sync-Token,X-Tenant-ID");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      return res.end();
    }

    if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed" });

    const body = await readJsonBody(req);
    rateLimit(req, { scope: "assets-sync", limit: 120, windowMs: 60_000 });
    assertIdempotent(req, body);
    const token = String(req.headers["x-asset-sync-token"] || body?.token || "").trim();
    if (process.env.ASSET_SYNC_TOKEN && token !== process.env.ASSET_SYNC_TOKEN) {
      return sendJson(res, 401, { ok: false, error: "Unauthorized" });
    }

    const store = getStore();
    const tenantId = getTenantId(req, body);
    const scopedErpKey = scopeTenantKey(tenantId, ERP_KEY);
    const erpRaw = await store.get(scopedErpKey);
    const erp = erpRaw && typeof erpRaw === "object" && Array.isArray(erpRaw.branches) ? erpRaw : makeDefaultErp();
    erp.branches = Array.isArray(erp.branches) ? erp.branches : [];

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (const item of getAssignments(body)) {
      if (!item || typeof item !== "object") {
        skipped += 1;
        errors.push("Invalid assignment item.");
        continue;
      }
      const branch = normalizeBranch(findBranch(erp, item));
      if (!branch) {
        skipped += 1;
      errors.push(`Branch not found for ${safeString(item.branchId || item.branchName || "assignment", 120)}.`);
        continue;
      }
      const serial = itemSerial(item);
      const model = String(item.model || item.name || item.assetName || item.phoneModel || "").trim();
      if (!serial || !model) {
        skipped += 1;
        errors.push(`Missing serial or model for ${branch.name || branch.id}.`);
        continue;
      }
      if (hasSerial(erp, serial)) {
        skipped += 1;
        continue;
      }

      branch.phones.push(makePhone(item, serial));
      branch.updatedAt = isoNow();
      rebuildInventoryFromPhones(branch);
      imported += 1;
    }

    erp.lastUpdated = isoNow();
    await store.set(scopedErpKey, erp);
    await appendEvent(store, tenantId, "assets.synced", { imported, skipped });
    return sendJson(res, 200, { ok: true, imported, skipped, errors, key: scopedErpKey, tenantId, updatedAt: erp.lastUpdated });
  } catch (err) {
    const status = Number(err?.statusCode || 500) || 500;
    return sendJson(res, status, { ok: false, error: status >= 500 ? "Server error" : String(err?.message || "Invalid request") });
  }
};
