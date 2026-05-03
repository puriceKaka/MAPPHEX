(() => {
  "use strict";

  const PAGE = document.body?.dataset?.page || "";

  const SESSION_LOCAL_KEY = "jixels_session_branch_v1";
  const SESSION_SESSION_KEY = "jixels_session_branch_tmp_v1";
  const BRANCH_ACCOUNTS_KEY = "jixels_branch_accounts_v1";
  const DATA_KEY = "jixels_erp_v1";
  const BRANCH_COUNT = 47;
  const API_ENABLED_KEY = "jixels_api_enabled_v1";

  const $ = (selector, root = document) => root.querySelector(selector);

  const safeJsonParse = (raw, fallback) => {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };

  const loadJson = (key, fallback) => {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return safeJsonParse(raw, fallback);
  };

  const saveJson = (key, value) => {
    localStorage.setItem(key, JSON.stringify(value));
    try {
      if (localStorage.getItem(API_ENABLED_KEY) === "1") {
        fetch("/api/kv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value }),
        }).catch(() => null);
      }
    } catch {
      // ignore
    }
  };

  const apiEnabled = () => {
    try {
      return localStorage.getItem(API_ENABLED_KEY) === "1";
    } catch {
      return false;
    }
  };

  const bootstrapKeyFromApi = async (key) => {
    if (!apiEnabled()) return false;
    if (localStorage.getItem(key)) return true;
    try {
      const res = await fetch(`/api/kv?key=${encodeURIComponent(String(key || ""))}`);
      if (!res.ok) return false;
      const data = await res.json();
      if (!data || data.ok !== true) return false;
      if (data.value === null || typeof data.value === "undefined") return false;
      localStorage.setItem(key, JSON.stringify(data.value));
      return true;
    } catch {
      return false;
    }
  };

  const formatInt = (value) => {
    const num = Number(value || 0);
    return Number.isFinite(num) ? num.toLocaleString("en-US") : "0";
  };

  const isoNow = () => new Date().toISOString();

  const makeId = (prefix, index) =>
    `${prefix}${String(index).padStart(2, "0")}`;

  const bufToHex = (buffer) =>
    Array.from(new Uint8Array(buffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  const weakHashHex = (text) => {
    let h1 = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      h1 ^= text.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193);
    }
    const hex = (h1 >>> 0).toString(16).padStart(8, "0");
    return `${hex}${hex}${hex}${hex}${hex}${hex}${hex}${hex}`.slice(0, 64);
  };

  const hashHex = async (text) => {
    try {
      if (crypto?.subtle?.digest) {
        const enc = new TextEncoder().encode(text);
        const digest = await crypto.subtle.digest("SHA-256", enc);
        return bufToHex(digest);
      }
    } catch {
      // Fall through.
    }
    return weakHashHex(text);
  };

  const b64ToBytes = (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };

  const bytesToB64 = (bytes) => btoa(String.fromCharCode(...bytes));

  const aesEncrypt = async (keyBytes, plaintext) => {
    try {
      if (!crypto?.subtle?.importKey) throw new Error("no subtle");
      const key = await crypto.subtle.importKey(
        "raw",
        keyBytes,
        { name: "AES-GCM" },
        false,
        ["encrypt"],
      );
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const enc = new TextEncoder().encode(plaintext);
      const cipher = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc),
      );
      return { alg: "AES-GCM", ivB64: bytesToB64(iv), dataB64: bytesToB64(cipher) };
    } catch {
      // Fallback: obfuscation (not secure) for restricted environments.
      const x = new Uint8Array(new TextEncoder().encode(plaintext));
      const out = new Uint8Array(x.length);
      for (let i = 0; i < x.length; i++) out[i] = x[i] ^ keyBytes[i % keyBytes.length];
      return { alg: "XOR", ivB64: "", dataB64: bytesToB64(out) };
    }
  };

  const aesDecrypt = async (keyBytes, payload) => {
    try {
      if (payload.alg === "AES-GCM") {
        const key = await crypto.subtle.importKey(
          "raw",
          keyBytes,
          { name: "AES-GCM" },
          false,
          ["decrypt"],
        );
        const iv = b64ToBytes(payload.ivB64);
        const data = b64ToBytes(payload.dataB64);
        const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
        return new TextDecoder().decode(plainBuf);
      }
    } catch {
      // Fall through.
    }
    const data = b64ToBytes(payload.dataB64);
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i] ^ keyBytes[i % keyBytes.length];
    return new TextDecoder().decode(out);
  };

  const ensureData = () => {
    const existing = loadJson(DATA_KEY, null);
    if (
      existing &&
      typeof existing === "object" &&
      Array.isArray(existing.branches) &&
      existing.branches.length === BRANCH_COUNT
    ) {
      return existing;
    }

    const branches = Array.from({ length: BRANCH_COUNT }, (_, idx) => {
      const i = idx + 1;
      return {
        id: makeId("b", i),
        name: `Branch ${String(i).padStart(2, "0")}`,
        city: "",
        area: "",
        employees: 0,
        inventory: [],
        transactions: [],
        ledger: { head: "GENESIS" },
        updatedAt: isoNow(),
      };
    });

    const seeded = { version: 1, lastUpdated: isoNow(), branches, departments: {} };
    saveJson(DATA_KEY, seeded);
    return seeded;
  };

  const getSession = () => {
    const session =
      safeJsonParse(sessionStorage.getItem(SESSION_SESSION_KEY), null) ||
      loadJson(SESSION_LOCAL_KEY, null);
    if (!session || typeof session !== "object") return null;
    if (!session.role || !session.userId) return null;
    return session;
  };

  const clearSession = () => {
    localStorage.removeItem(SESSION_LOCAL_KEY);
    sessionStorage.removeItem(SESSION_SESSION_KEY);
  };

  const requireBranch = () => {
    const session = getSession();
    if (!session || session.role !== "branch" || !session.branchId) {
      window.location.href = "branch-login.html";
      return null;
    }
    return session;
  };

  const loadAccounts = () => {
    const accounts = loadJson(BRANCH_ACCOUNTS_KEY, []);
    return Array.isArray(accounts) ? accounts : [];
  };

  const getAccount = (session) => {
    const accounts = loadAccounts();
    return accounts.find((a) => a.id === session.userId) || null;
  };

  const computeBranchTotals = (branch) => {
    const inventory = Array.isArray(branch.inventory) ? branch.inventory : [];
    const dl = Array.isArray(branch.damageLoss) ? branch.damageLoss : [];
    let stock = 0;
    let sold = 0;
    let topModel = { model: "—", sold: -1 };
    let damaged = 0;
    let lost = 0;

    for (const row of inventory) {
      const rowStock = Number(row.stock || 0);
      const rowSold = Number(row.sold || 0);
      stock += rowStock;
      sold += rowSold;
      if (rowSold > topModel.sold) topModel = { model: row.model, sold: rowSold };
    }

    for (const r of dl) {
      const qty = Number(r.qty || 0);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (r.type === "lost") lost += qty;
      else damaged += qty;
    }

    return {
      models: inventory.length,
      stock,
      sold,
      topModel: topModel.model || "—",
      damaged,
      lost,
    };
  };

  const csvEscape = (value) => {
    const str = String(value ?? "");
    if (/[",\n]/.test(str)) return `"${str.replaceAll('"', '""')}"`;
    return str;
  };

  const downloadText = (filename, text) => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const verifyLedger = async (branch, keyBytes) => {
    const ledger = branch.ledger || { head: "GENESIS" };
    const txs = Array.isArray(branch.transactions) ? branch.transactions : [];
    let head = "GENESIS";
    for (const tx of txs) {
      const plain = await aesDecrypt(keyBytes, tx.payload);
      const check = await hashHex(`${head}:${plain}`);
      if (check !== tx.hash) return false;
      head = tx.hash;
    }
    return String(ledger.head || "GENESIS") === String(head);
  };

  const initBranchDashboard = () => {
    if (PAGE !== "branch-dashboard") return;

    const session = requireBranch();
    if (!session) return;

    let data = ensureData();
    const account = getAccount(session);
    if (!account) {
      clearSession();
      window.location.href = "branch-login.html";
      return;
    }

    const keyBytes = b64ToBytes(account.secretB64 || "");

    const badge = $("#branch-badge");
    const logoutBtn = $("#branch-logout-btn");
    const syncBtn = $("#branch-sync-btn");
    const ledgerIndicator = $("#ledger-indicator");

    const menuToggle = $("#menu-toggle");
    const menuClose = $("#menu-close");
    const sidebar = $("#branch-sidebar");
    const menuBackdrop = $("#menu-backdrop");

    const kpiModels = $("#b-kpi-models");
    const kpiStock = $("#b-kpi-stock");
    const kpiSold = $("#b-kpi-sold");
    const kpiTop = $("#b-kpi-top");

    const invTbody = $("#branch-inventory-tbody");
    const addPhoneBtn = $("#add-phone-btn");
    const phoneModel = $("#ph-model");
    const phoneColor = $("#ph-color");
    const phoneStorage = $("#ph-storage");
    const phoneSerial = $("#ph-serial");
    const phonePrice = $("#ph-price");
    const phoneSaveBtn = $("#ph-save-btn");
    const phoneClearBtn = $("#ph-clear-btn");

    const dlModel = $("#dl-model");
    const dlType = $("#dl-type");
    const dlQty = $("#dl-qty");
    const dlNotes = $("#dl-notes");
    const dlAddBtn = $("#dl-add-btn");
    const dlExportBtn = $("#dl-export-btn");
    const dlTbody = $("#dl-tbody");

    const txSerial = $("#tx-serial");
    const txCustomerPhone = $("#tx-customer-phone");
    const txChannel = $("#tx-channel");
    const txRef = $("#tx-ref");
    const txAmount = $("#tx-amount");
    const txAddBtn = $("#tx-add-btn");
    const txExportBtn = $("#tx-export-btn");
    const txTbody = $("#tx-tbody");
    const txHelper = $("#tx-helper");
    const txSms = $("#tx-sms");

    const reportBtn = $("#branch-report-btn");
    const reportCsvBtn = $("#branch-report-csv-btn");
    const reportDocBtn = $("#branch-report-doc-btn");
    const reportPdfBtn = $("#branch-report-pdf-btn");
    const chartsBtn = $("#branch-charts-btn");
    const dueDateInput = $("#report-due-date");
    const reportOut = $("#branch-report-output");

    const chartsPanel = $("#charts-panel");
    const chartsCloseBtn = $("#charts-close-btn");
    const chartStock = $("#chart-stock");
    const chartSold = $("#chart-sold");
    const chartDL = $("#chart-dl");

    const getBranch = () =>
      (data.branches || []).find((b) => b.id === session.branchId) || null;

    const normalizeBranch = (branch) => {
      if (!branch) return null;
      if (!Array.isArray(branch.inventory)) branch.inventory = [];
      if (!Array.isArray(branch.phones)) branch.phones = [];
      if (!Array.isArray(branch.soldPhones)) branch.soldPhones = [];
      if (!Array.isArray(branch.transactions)) branch.transactions = [];
      if (!Array.isArray(branch.txLog)) branch.txLog = [];
      if (!Array.isArray(branch.damageLoss)) branch.damageLoss = [];
      if (!branch.financeSummary || typeof branch.financeSummary !== "object") {
        branch.financeSummary = { mpesaIn: 0, bankIn: 0, txCount: 0, lastTxAt: "" };
      }
      if (!branch.ledger || typeof branch.ledger !== "object") {
        branch.ledger = { head: "GENESIS" };
      }
      return branch;
    };

    const persist = () => {
      data.lastUpdated = isoNow();
      saveJson(DATA_KEY, data);
    };

    const setMenuOpen = (open) => {
      document.body.classList.toggle("menu-open", !!open);
      if (menuToggle) menuToggle.setAttribute("aria-expanded", open ? "true" : "false");
    };

    const navigateTo = (key) => {
      const k = String(key || "").trim() || "overview";
      document.querySelectorAll("[data-section]").forEach((el) => {
        el.style.display = el.getAttribute("data-section") === k ? "" : "none";
      });
      document.querySelectorAll("[data-nav]").forEach((a) => {
        a.classList.toggle("active", a.getAttribute("data-nav") === k);
      });
      if (window.innerWidth <= 980) setMenuOpen(false);
    };

    const rebuildInventoryFromPhones = (branch) => {
      const phones = Array.isArray(branch.phones) ? branch.phones : [];
      const soldPhones = Array.isArray(branch.soldPhones) ? branch.soldPhones : [];
      const byModel = new Map();
      for (const p of [...phones, ...soldPhones]) {
        const model = String(p.model || "").trim() || "—";
        const row = byModel.get(model) || { model, stock: 0, sold: 0 };
        if (String(p.status || "in_stock") === "sold") row.sold += 1;
        else row.stock += 1;
        byModel.set(model, row);
      }
      branch.inventory = Array.from(byModel.values()).sort((a, z) =>
        String(a.model).localeCompare(String(z.model)),
      );
    };

    const renderKPIs = () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;
      rebuildInventoryFromPhones(branch);
      const totals = computeBranchTotals(branch);
      if (kpiModels) kpiModels.textContent = formatInt(totals.models);
      if (kpiStock) kpiStock.textContent = formatInt(totals.stock);
      if (kpiSold) kpiSold.textContent = formatInt(totals.sold);
      if (kpiTop) kpiTop.textContent = totals.topModel;

      if (badge) badge.textContent = branch.name || "Branch";
    };

    const renderDamageLoss = () => {
      if (!dlTbody) return;
      const branch = normalizeBranch(getBranch());
      if (!branch) return;
      const items = Array.isArray(branch.damageLoss) ? branch.damageLoss : [];
      dlTbody.textContent = "";

      for (const r of items.slice().reverse().slice(0, 60)) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td></td>
          <td></td>
          <td></td>
          <td class="num"></td>
          <td></td>
        `;
        tr.children[0].textContent = new Date(r.at).toLocaleString();
        tr.children[1].textContent = String(r.type || "").toUpperCase();
        tr.children[2].textContent = r.model || "—";
        tr.children[3].textContent = formatInt(r.qty || 0);
        tr.children[4].textContent = r.notes || "";
        dlTbody.appendChild(tr);
      }
    };

    const addDamageLoss = () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;

      const model = String(dlModel?.value || "").trim();
      const type = String(dlType?.value || "damaged");
      const qty = Math.max(0, Number(dlQty?.value || 0));
      const notes = String(dlNotes?.value || "").trim();

      if (!model) {
        dlModel?.focus?.();
        return;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        dlQty?.focus?.();
        return;
      }

      const list = Array.isArray(branch.damageLoss) ? branch.damageLoss : [];
      list.push({
        at: isoNow(),
        type: type === "lost" ? "lost" : "damaged",
        model,
        qty,
        notes,
      });
      branch.damageLoss = list;
      branch.updatedAt = isoNow();
      persist();

      if (dlModel) dlModel.value = "";
      if (dlQty) dlQty.value = "";
      if (dlNotes) dlNotes.value = "";
      renderDamageLoss();
      renderKPIs();
    };

    const exportDamageLossCsv = () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;
      const rows = [["Date", "Type", "Model", "Quantity", "Notes"]];
      for (const r of branch.damageLoss || []) {
        rows.push([r.at, r.type, r.model, r.qty, r.notes || ""]);
      }
      const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
      downloadText(
        `jixels-${branch.id}-damage-loss-${new Date().toISOString().slice(0, 10)}.csv`,
        csv,
      );
    };

    const renderInventory = () => {
      if (!invTbody) return;
      const branch = normalizeBranch(getBranch());
      if (!branch) return;
      const phones = Array.isArray(branch.phones) ? branch.phones : [];
      rebuildInventoryFromPhones(branch);

      invTbody.textContent = "";
      for (const [idx, p] of phones
        .slice()
        .sort((a, z) => String(a.serial || "").localeCompare(String(z.serial || "")))
        .entries()) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td class="num"></td>
          <td></td>
          <td class="num"></td>
        `;

        tr.children[0].textContent = p.serial || "—";
        tr.children[1].textContent = p.model || "—";
        tr.children[2].textContent = p.color || "—";
        tr.children[3].textContent = p.storage || "—";
        tr.children[4].textContent = formatInt(p.price || 0);
        tr.children[5].textContent = String(p.status || "in_stock").replace("_", " ");

        const delBtn = document.createElement("button");
        delBtn.className = "btn";
        delBtn.type = "button";
        delBtn.textContent = String(p.status || "in_stock") === "sold" ? "Sold" : "Remove";
        delBtn.disabled = String(p.status || "in_stock") === "sold";
        delBtn.addEventListener("click", () => {
          const serial = String(p.serial || "");
          const pos = branch.phones.findIndex((x) => String(x.serial || "") === serial);
          if (pos === -1) return;
          branch.phones.splice(pos, 1);
          rebuildInventoryFromPhones(branch);
          branch.updatedAt = isoNow();
          persist();
          renderInventory();
          renderKPIs();
        });

        tr.children[6].appendChild(delBtn);
        invTbody.appendChild(tr);
      }
    };

    const clearPhoneForm = () => {
      if (phoneModel) phoneModel.value = "";
      if (phoneColor) phoneColor.value = "";
      if (phoneStorage) phoneStorage.value = "";
      if (phoneSerial) phoneSerial.value = "";
      if (phonePrice) phonePrice.value = "";
    };

    const addPhone = () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;

      const model = String(phoneModel?.value || "").trim();
      const color = String(phoneColor?.value || "").trim();
      const storage = String(phoneStorage?.value || "").trim();
      const serial = String(phoneSerial?.value || "").trim();
      const price = Math.max(0, Number(phonePrice?.value || 0));

      if (!model) return phoneModel?.focus?.();
      if (!serial) return phoneSerial?.focus?.();
      if (!Number.isFinite(price) || price <= 0) return phonePrice?.focus?.();

      const exists = (branch.phones || []).some(
        (p) => String(p.serial || "").toLowerCase() === serial.toLowerCase(),
      );
      if (exists) {
        phoneSerial?.focus?.();
        return;
      }
      const previouslySold = (branch.soldPhones || []).some(
        (p) => String(p.serial || "").toLowerCase() === serial.toLowerCase(),
      );
      if (previouslySold) {
        phoneSerial?.focus?.();
        return;
      }

      branch.phones.push({
        serial,
        model,
        color,
        storage,
        price,
        status: "in_stock",
        createdAt: isoNow(),
      });

      rebuildInventoryFromPhones(branch);
      branch.updatedAt = isoNow();
      persist();
      clearPhoneForm();
      renderInventory();
      renderKPIs();
    };

    const updateTxFromSerial = () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;
      const serial = String(txSerial?.value || "").trim();
      if (!serial) {
        if (txHelper) txHelper.textContent = "";
        if (txSms) txSms.textContent = "";
        return;
      }
      const phone =
        (branch.phones || []).find(
          (p) => String(p.serial || "").toLowerCase() === serial.toLowerCase(),
        ) || null;
      if (!phone) {
        if (txHelper) txHelper.textContent = "Serial not found in inventory.";
        if (txSms) txSms.textContent = "";
        if (txCustomerPhone) txCustomerPhone.value = "";
        return;
      }
      if (txCustomerPhone) txCustomerPhone.disabled = false;
      if (txAmount && !String(txAmount.value || "").trim()) {
        txAmount.value = String(Number(phone.price || 0));
      }
      if (txHelper) {
        txHelper.textContent = `${phone.model || "Phone"} • ${phone.color || "—"} • ${phone.storage || "—"} • KES ${formatInt(phone.price || 0)}`;
      }
      if (txSms) txSms.textContent = "";
    };

    const setTxButtonState = () => {
      if (!txAddBtn) return;
      const serial = String(txSerial?.value || "").trim();
      const customerPhone = String(txCustomerPhone?.value || "").trim();
      txAddBtn.disabled = !serial || !customerPhone;
    };

    const sendSmsReceipt = (to, message) => {
      const OUTBOX_KEY = "jixels_sms_outbox_v1";
      const entry = { at: isoNow(), to, message };
      try {
        const raw = localStorage.getItem(OUTBOX_KEY);
        const list = raw ? safeJsonParse(raw, []) : [];
        const arr = Array.isArray(list) ? list : [];
        arr.push(entry);
        localStorage.setItem(OUTBOX_KEY, JSON.stringify(arr.slice(-200)));
      } catch {
        // ignore
      }
      if (txSms) txSms.textContent = `SMS sent to ${to}: ${message}`;
    };

    const postJson = async (url, body) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
      });
      const data = await res.json().catch(() => null);
      return { ok: res.ok && data?.ok !== false, status: res.status, data };
    };

    const requestMpesaStk = async ({ amount, phoneNumber, accountReference, transactionDesc }) => {
      const callbackUrl = `${window.location.origin}/api/mpesa/callback`;
      const result = await postJson("/api/mpesa/stkpush", {
        amount,
        phoneNumber,
        accountReference,
        transactionDesc,
        callbackUrl,
      });
      if (!result.ok) throw new Error(result.data?.error || "M-Pesa STK push failed");
      return result.data;
    };

    const notifyTransaction = (tx, branch) => {
      const amount = Number(tx?.amount || 0) || 0;
      const title = "Transaction recorded";
      const body = `${branch?.name || branch?.id || "Branch"}: KES ${formatInt(amount)} via ${String(tx?.channel || "payment").toUpperCase()} (${tx?.ref || "no reference"})`;
      postJson("/api/onesignal/notify", {
        included_segments: ["Finance", "Sales", "Branches"],
        headings: { en: title },
        contents: { en: body },
        data: { type: "transaction", branchId: branch?.id || "", amountKes: amount, reference: tx?.ref || "" },
      }).catch(() => null);
    };

    const renderTransactions = async () => {
      if (!txTbody) return;
      const branch = normalizeBranch(getBranch());
      if (!branch) return;
      txTbody.textContent = "";

      const txLog = Array.isArray(branch.txLog) ? branch.txLog : [];
      const soldPhones = Array.isArray(branch.soldPhones) ? branch.soldPhones : [];

      const rows = txLog.length
        ? txLog.slice().reverse().slice(0, 60)
        : soldPhones
            .slice()
            .reverse()
            .slice(0, 60)
            .map((p) => ({
              at: p.soldAt,
              channel: p.soldChannel || "",
              ref: p.soldRef || "",
              serial: p.serial || "",
              customerPhone: p.soldTo || "",
              amount: Number(p.soldAmount || p.price || 0) || 0,
              phone: { model: p.model, color: p.color, storage: p.storage, price: p.price },
              agent: { username: p.soldBy || "" },
            }));

      for (const obj of rows) {
        const modelRaw = obj?.phone?.model ?? obj?.model ?? "—";
        const soldBy = obj?.agent?.username ?? obj?.soldBy ?? "";
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td></td>
          <td class="num"></td>
          <td></td>
          <td></td>
        `;
        tr.children[0].textContent = obj.at ? new Date(obj.at).toLocaleString() : "—";
        tr.children[1].textContent = String(modelRaw || "—") || "—";
        tr.children[2].textContent = obj.serial || "—";
        tr.children[3].textContent = obj.customerPhone || "—";
        tr.children[4].textContent = String(obj.channel || "").toUpperCase() || "—";
        tr.children[5].textContent = obj.ref || "—";
        tr.children[6].textContent = formatInt(obj.amount);
        tr.children[7].textContent = "Transaction completed";
        tr.children[8].textContent = soldBy || "—";
        txTbody.appendChild(tr);
      }

      if (ledgerIndicator) {
        const ok = await verifyLedger(branch, keyBytes);
        ledgerIndicator.textContent = ok ? "Ledger OK" : "Ledger Tampered";
        ledgerIndicator.classList.toggle("offline", !ok);
      }
    };

    const addTransaction = async () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;
      const channel = String(txChannel?.value || "mpesa");
      const serial = String(txSerial?.value || "").trim();
      const customerPhone = String(txCustomerPhone?.value || "").trim();
      let ref = String(txRef?.value || "").trim();

      if (!serial) return txSerial?.focus?.();
      if (!customerPhone) return txCustomerPhone?.focus?.();

      const phone =
        (branch.phones || []).find(
          (p) => String(p.serial || "").toLowerCase() === serial.toLowerCase(),
        ) || null;
      if (!phone) {
        if (txHelper) txHelper.textContent = "Serial not found in inventory.";
        if (txSms) txSms.textContent = "";
        return txSerial?.focus?.();
      }

      const amount = Math.max(0, Number(txAmount?.value || phone.price || 0));
      if (!Number.isFinite(amount) || amount <= 0) return txAmount?.focus?.();

      if (!ref) {
        const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
        ref = `${channel.toUpperCase()}-${branch.id}-${stamp}`;
      }

      let mpesaResponse = null;
      if (channel === "mpesa") {
        if (txSms) txSms.textContent = "Sending M-Pesa STK push...";
        try {
          mpesaResponse = await requestMpesaStk({
            amount,
            phoneNumber: customerPhone,
            accountReference: ref,
            transactionDesc: `Jixels ${phone.model || "phone"} sale`,
          });
        } catch (err) {
          if (txSms) txSms.textContent = String(err?.message || "M-Pesa STK push failed.");
          return;
        }
      }

      const txObj = {
        at: isoNow(),
        channel,
        ref,
        amount,
        serial: phone.serial,
        customerPhone,
        phone: {
          model: phone.model,
          color: phone.color,
          storage: phone.storage,
          price: phone.price,
        },
        mpesa: mpesaResponse?.response || null,
      };
      const plain = JSON.stringify(txObj);

      const payload = await aesEncrypt(keyBytes, plain);
      const txs = Array.isArray(branch.transactions) ? branch.transactions : [];

      const prevHead = String(branch.ledger?.head || "GENESIS");
      const hash = await hashHex(`${prevHead}:${plain}`);

      txs.push({ payload, hash });
      branch.transactions = txs;

      const txLog = Array.isArray(branch.txLog) ? branch.txLog : [];
      txLog.push(txObj);
      branch.txLog = txLog.slice(-200);
      branch.ledger = { head: hash };
      if (!branch.financeSummary || typeof branch.financeSummary !== "object") {
        branch.financeSummary = { mpesaIn: 0, bankIn: 0, txCount: 0, lastTxAt: "" };
      }
      if (channel === "bank") branch.financeSummary.bankIn += amount;
      else branch.financeSummary.mpesaIn += amount;
      branch.financeSummary.txCount += 1;
      branch.financeSummary.lastTxAt = isoNow();

      // Remove serial from available inventory (move to sold list for reporting).
      const sold = {
        ...phone,
        status: "sold",
        soldAt: isoNow(),
        soldTo: customerPhone,
        soldRef: ref,
      };
      const pos = branch.phones.findIndex(
        (p) => String(p.serial || "").toLowerCase() === serial.toLowerCase(),
      );
      if (pos !== -1) branch.phones.splice(pos, 1);
      branch.soldPhones = Array.isArray(branch.soldPhones) ? branch.soldPhones : [];
      branch.soldPhones.push(sold);
      rebuildInventoryFromPhones(branch);
      branch.updatedAt = isoNow();
      persist();
      notifyTransaction(txObj, branch);

      if (txRef) txRef.value = "";
      if (txAmount) txAmount.value = "";
      if (txSerial) txSerial.value = "";
      if (txCustomerPhone) {
        txCustomerPhone.value = "";
        txCustomerPhone.disabled = true;
      }
      if (txHelper) txHelper.textContent = "";

      if (channel === "mpesa") {
        const promptMsg = `M-Pesa prompt sent. Enter your M-Pesa PIN to pay KES ${formatInt(amount)} for ${sold.model} (${sold.storage}, ${sold.color}) [SN:${sold.serial}]. Ref ${ref}.`;
        if (txSms) txSms.textContent = promptMsg;
      } else {
        if (txSms) txSms.textContent = `Bank transaction recorded. Ref ${ref}.`;
      }

      sendSmsReceipt(
        customerPhone,
        `Jixels Technologies: Payment received KES ${formatInt(amount)} for ${sold.model} (${sold.storage}, ${sold.color}). Serial: ${sold.serial}. Ref: ${ref}. Thank you.`,
      );

      await renderTransactions();
      renderInventory();
      renderKPIs();
      setTxButtonState();
    };

    const exportTransactionsCsv = async () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;

      const rows = [
        [
          "Date",
          "Model",
          "Serial",
          "CustomerPhone",
          "Channel",
          "Reference",
          "AmountKES",
          "Status",
          "SoldBy",
        ],
      ];

      const txLog = Array.isArray(branch.txLog) ? branch.txLog : [];
      const soldPhones = Array.isArray(branch.soldPhones) ? branch.soldPhones : [];

      if (txLog.length) {
        for (const tx of txLog) {
          const modelRaw = tx?.phone?.model ?? tx?.model ?? "";
          rows.push([
            tx.at || "",
            modelRaw || "",
            tx.serial || "",
            tx.customerPhone || "",
            tx.channel || "",
            tx.ref || "",
            tx.amount || 0,
            "completed",
            tx?.agent?.username || "",
          ]);
        }
      } else {
        for (const p of soldPhones) {
          rows.push([
            p.soldAt || "",
            p.model || "",
            p.serial || "",
            p.soldTo || "",
            p.soldChannel || "",
            p.soldRef || "",
            Number(p.soldAmount || p.price || 0) || 0,
            "completed",
            p.soldBy || "",
          ]);
        }
      }

      const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
      downloadText(
        `jixels-${branch.id}-sales-${new Date().toISOString().slice(0, 10)}.csv`,
        csv,
      );
    };

    const setReportHtml = (html) => {
      if (!reportOut) return;
      reportOut.innerHTML = html;
    };

    const getDueDateIso = () => {
      const v = String(dueDateInput?.value || "").trim();
      if (v) return v;
      const d = new Date();
      d.setDate(d.getDate() + 7);
      return d.toISOString().slice(0, 10);
    };

    const makeReportModelRows = (branch) =>
      (branch.inventory || [])
        .slice()
        .sort((a, z) => (z.sold || 0) - (a.sold || 0))
        .map(
          (row) => `
            <tr>
              <td>${row.model}</td>
              <td class="num">${formatInt(row.stock)}</td>
              <td class="num">${formatInt(row.sold)}</td>
            </tr>`,
        )
        .join("");

    const makeReportDlRows = (branch) =>
      (branch.damageLoss || [])
        .slice()
        .sort((a, z) => String(z.at).localeCompare(String(a.at)))
        .slice(0, 40)
        .map(
          (r) => `
            <tr>
              <td>${new Date(r.at).toLocaleString()}</td>
              <td>${String(r.type || "").toUpperCase()}</td>
              <td>${r.model}</td>
              <td class="num">${formatInt(r.qty)}</td>
              <td>${r.notes || ""}</td>
            </tr>`,
        )
        .join("");

    const makeReportTxRows = (branch) =>
      (branch.txLog || [])
        .slice()
        .sort((a, z) => String(z.at || "").localeCompare(String(a.at || "")))
        .slice(0, 30)
        .map(
          (t) => `
            <tr>
              <td>${new Date(t.at).toLocaleString()}</td>
              <td>${String(t.channel || "").toUpperCase()}</td>
              <td>${t.ref || "—"}</td>
              <td>${t.serial || "—"}</td>
              <td>${t.customerPhone || "—"}</td>
              <td class="num">${formatInt(t.amount || 0)}</td>
            </tr>`,
        )
        .join("");

    const buildReportHtml = (branch) => {
      const totals = computeBranchTotals(branch);
      const generatedAt = new Date();
      const dueIso = getDueDateIso();
      const dueDate = new Date(`${dueIso}T00:00:00`);
      const updated = branch.updatedAt ? new Date(branch.updatedAt) : generatedAt;

      const txCount = Array.isArray(branch.txLog)
        ? branch.txLog.length
        : Array.isArray(branch.transactions)
          ? branch.transactions.length
          : 0;

      const modelRows = makeReportModelRows(branch);
      const dlRows = makeReportDlRows(branch);
      const txRows = makeReportTxRows(branch);

      return `
        <h3>Branch Operations Report</h3>
        <p><strong>${branch.name}</strong></p>
        <div class="report-grid">
          <div class="report-card">
            <div class="label">Generated</div>
            <div class="value" style="font-size:16px;">${generatedAt.toLocaleString()}</div>
          </div>
          <div class="report-card">
            <div class="label">Due date</div>
            <div class="value" style="font-size:16px;">${dueDate.toDateString()}</div>
          </div>
          <div class="report-card">
            <div class="label">Last branch update</div>
            <div class="value" style="font-size:16px;">${updated.toLocaleString()}</div>
          </div>
        </div>

        <p style="margin-top:12px; font-weight:800;">Executive summary</p>
        <div class="report-grid">
          <div class="report-card">
            <div class="label">Models</div>
            <div class="value">${formatInt(totals.models)}</div>
          </div>
          <div class="report-card">
            <div class="label">In stock</div>
            <div class="value">${formatInt(totals.stock)}</div>
          </div>
          <div class="report-card">
            <div class="label">Sold</div>
            <div class="value">${formatInt(totals.sold)}</div>
          </div>
          <div class="report-card">
            <div class="label">Damaged</div>
            <div class="value">${formatInt(totals.damaged)}</div>
          </div>
          <div class="report-card">
            <div class="label">Lost</div>
            <div class="value">${formatInt(totals.lost)}</div>
          </div>
          <div class="report-card">
            <div class="label">Transactions</div>
            <div class="value">${formatInt(txCount)}</div>
          </div>
        </div>

        <p style="margin-top:12px; font-weight:800;">Inventory details</p>
        <div class="table-wrap" style="padding:12px 0 0;">
          <table class="table" aria-label="Branch inventory report">
            <thead>
              <tr>
                <th>Model</th>
                <th class="num">In stock</th>
                <th class="num">Sold</th>
              </tr>
            </thead>
            <tbody>${modelRows || ""}</tbody>
          </table>
        </div>

        <p style="margin-top:12px; font-weight:800;">Damages & loss (latest)</p>
        <div class="table-wrap" style="padding:12px 0 0;">
          <table class="table" aria-label="Damage and loss report">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Model</th>
                <th class="num">Qty</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>${dlRows || ""}</tbody>
          </table>
        </div>

        <p style="margin-top:12px; font-weight:800;">Transactions (latest)</p>
        <div class="table-wrap" style="padding:12px 0 0;">
          <table class="table" aria-label="Transactions report">
            <thead>
              <tr>
                <th>Date</th>
                <th>Channel</th>
                <th>Reference</th>
                <th>Serial</th>
                <th>Customer</th>
                <th class="num">Amount (KES)</th>
              </tr>
            </thead>
            <tbody>${txRows || ""}</tbody>
          </table>
        </div>
      `;
    };

    const generateReport = () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;

      setReportHtml(buildReportHtml(branch));
    };

    const downloadReportCsv = () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;
      const rows = [["BranchId", "Branch", "Model", "Stock", "Sold"]];
      for (const row of branch.inventory || []) {
        rows.push([branch.id, branch.name, row.model, row.stock, row.sold]);
      }
      const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
      downloadText(
        `jixels-${branch.id}-inventory-${new Date().toISOString().slice(0, 10)}.csv`,
        csv,
      );
    };

    const downloadReportDoc = () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;
      const body = buildReportHtml(branch);

      const doc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Branch Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; }
    h3 { margin: 0 0 6px; }
    p { margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; }
    th { background: #f6f6f6; text-align: left; }
    .num { text-align: right; }
  </style>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument xmlns:w="urn:schemas-microsoft-com:office:word">
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
    </w:WordDocument>
  </xml>
  <![endif]-->
</head>
<body>${body}</body>
</html>`;

      const blob = new Blob([doc], { type: "application/msword;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jixels-${branch.id}-report-${new Date()
        .toISOString()
        .slice(0, 10)}.doc`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    };

    const printReport = () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;
      const html = buildReportHtml(branch);
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.open();
      w.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Branch Report</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; padding: 18px; }
    h3 { margin: 0 0 6px; }
    p { margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    th, td { border: 1px solid #ddd; padding: 8px; font-size: 12px; }
    th { background: #f6f6f6; text-align: left; }
    .num { text-align: right; }
  </style>
</head>
<body>${html}</body>
</html>`);
      w.document.close();
      w.focus();
      w.print();
    };

    const chartColors = () => [
      "rgba(34, 211, 238, 0.85)",
      "rgba(124, 58, 237, 0.85)",
      "rgba(52, 211, 153, 0.85)",
      "rgba(251, 191, 36, 0.85)",
      "rgba(251, 113, 133, 0.85)",
    ];

    const drawBarChart = (canvas, labels, values, color) => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);

      const padding = 28;
      const w = width - padding * 2;
      const h = height - padding * 2;
      const max = Math.max(1, ...values);

      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(0, 0, width, height);

      const barW = w / Math.max(1, values.length);
      ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.textBaseline = "top";

      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        const barH = (v / max) * h;
        const x = padding + i * barW + 6;
        const y = padding + (h - barH);

        ctx.fillStyle = color;
        ctx.fillRect(x, y, Math.max(6, barW - 12), barH);

        ctx.fillStyle = "rgba(255,255,255,0.75)";
        const short = String(labels[i] || "").slice(0, 10);
        ctx.save();
        ctx.translate(x, padding + h + 6);
        ctx.rotate(-Math.PI / 6);
        ctx.fillText(short, 0, 0);
        ctx.restore();
      }
    };

    const drawPie = (canvas, values, labels) => {
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const width = canvas.width;
      const height = canvas.height;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "rgba(255,255,255,0.06)";
      ctx.fillRect(0, 0, width, height);

      const total = values.reduce((s, v) => s + v, 0) || 1;
      const colors = chartColors();
      const cx = width / 2;
      const cy = height / 2;
      const r = Math.min(width, height) / 2 - 26;

      let start = -Math.PI / 2;
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        const ang = (v / total) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, start, start + ang);
        ctx.closePath();
        ctx.fillStyle = colors[i % colors.length];
        ctx.fill();
        start += ang;
      }

      ctx.font = "12px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.textBaseline = "top";
      for (let i = 0; i < labels.length; i++) {
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(16, 16 + i * 18, 10, 10);
        ctx.fillStyle = "rgba(255,255,255,0.8)";
        ctx.fillText(`${labels[i]}: ${formatInt(values[i])}`, 32, 14 + i * 18);
      }
    };

    const openCharts = () => {
      const branch = normalizeBranch(getBranch());
      if (!branch || !chartsPanel) return;

      chartsPanel.style.display = "";

      const inv = Array.isArray(branch.inventory) ? branch.inventory : [];
      const topInv = inv
        .slice()
        .sort((a, z) => (z.stock || 0) - (a.stock || 0))
        .slice(0, 8);
      const labelsStock = topInv.map((x) => x.model || "—");
      const valuesStock = topInv.map((x) => Number(x.stock || 0));

      const topSold = inv
        .slice()
        .sort((a, z) => (z.sold || 0) - (a.sold || 0))
        .slice(0, 8);
      const labelsSold = topSold.map((x) => x.model || "—");
      const valuesSold = topSold.map((x) => Number(x.sold || 0));

      const totals = computeBranchTotals(branch);
      const dlValues = [totals.damaged, totals.lost];
      const dlLabels = ["Damaged", "Lost"];

      // Ensure crisp rendering
      for (const c of [chartStock, chartSold, chartDL]) {
        if (!c) continue;
        const rect = c.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        c.width = Math.max(320, Math.floor(rect.width * dpr));
        c.height = Math.max(220, Math.floor(Number(c.getAttribute("height") || 220) * dpr));
      }

      drawBarChart(chartStock, labelsStock, valuesStock, "rgba(34, 211, 238, 0.85)");
      drawBarChart(chartSold, labelsSold, valuesSold, "rgba(124, 58, 237, 0.85)");
      drawPie(chartDL, dlValues, dlLabels);
    };

    const closeCharts = () => {
      if (chartsPanel) chartsPanel.style.display = "none";
    };

    const sync = async () => {
      const saved = loadJson(DATA_KEY, null);
      if (saved && typeof saved === "object") data = saved;
      renderKPIs();
      renderInventory();
      renderDamageLoss();
      await renderTransactions();
    };

    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        clearSession();
        window.location.href = "branch-login.html";
      });
    }

    if (syncBtn) syncBtn.addEventListener("click", () => sync());

    if (menuToggle) menuToggle.addEventListener("click", () => setMenuOpen(true));
    if (menuClose) menuClose.addEventListener("click", () => setMenuOpen(false));
    if (menuBackdrop) menuBackdrop.addEventListener("click", () => setMenuOpen(false));
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    });
    if (sidebar) {
      sidebar.addEventListener("click", (e) => {
        const a = e.target?.closest?.("[data-nav]");
        if (!a) return;
        const key = a.getAttribute("data-nav");
        if (!key) return;
        navigateTo(key);
      });
    }

    window.addEventListener("hashchange", () => {
      const key = String(window.location.hash || "").replace("#", "");
      if (key) navigateTo(key);
    });

    if (addPhoneBtn) addPhoneBtn.addEventListener("click", () => phoneModel?.focus?.());
    if (phoneSaveBtn) phoneSaveBtn.addEventListener("click", () => addPhone());
    if (phoneClearBtn) phoneClearBtn.addEventListener("click", () => clearPhoneForm());
    if (phoneSerial) phoneSerial.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addPhone();
      }
    });

    if (dlAddBtn) dlAddBtn.addEventListener("click", () => addDamageLoss());
    if (dlExportBtn) dlExportBtn.addEventListener("click", () => exportDamageLossCsv());

    if (txAddBtn) txAddBtn.addEventListener("click", () => addTransaction());
    if (txExportBtn)
      txExportBtn.addEventListener("click", () => exportTransactionsCsv());
    if (txSerial) txSerial.addEventListener("input", () => updateTxFromSerial());
    if (txSerial) txSerial.addEventListener("input", () => setTxButtonState());
    if (txCustomerPhone) txCustomerPhone.addEventListener("input", () => setTxButtonState());

    if (reportBtn) reportBtn.addEventListener("click", () => generateReport());
    if (reportCsvBtn)
      reportCsvBtn.addEventListener("click", () => downloadReportCsv());
    if (reportDocBtn) reportDocBtn.addEventListener("click", () => downloadReportDoc());
    if (reportPdfBtn) reportPdfBtn.addEventListener("click", () => printReport());
    if (chartsBtn) chartsBtn.addEventListener("click", () => openCharts());
    if (chartsCloseBtn) chartsCloseBtn.addEventListener("click", () => closeCharts());

    // First render
    sync();
    generateReport();
    navigateTo(String(window.location.hash || "").replace("#", "") || "overview");
    if (txCustomerPhone) txCustomerPhone.disabled = true;
    setTxButtonState();

    // Cross-tab sync with Director/other sessions
    window.addEventListener("storage", (e) => {
      if (e.key !== DATA_KEY) return;
      sync();
    });
  };

  const main = async () => {
    await bootstrapKeyFromApi(DATA_KEY);
    initBranchDashboard();
  };

  main();
})();
