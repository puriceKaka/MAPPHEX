(() => {
  "use strict";

  const PAGE = document.body?.dataset?.page || "";

  const SESSION_LOCAL_KEY = "jixels_session_agent_v1";
  const SESSION_SESSION_KEY = "jixels_session_agent_tmp_v1";
  const AGENT_ACCOUNTS_KEY = "jixels_agent_accounts_v1";
  const ERP_KEY = "jixels_erp_v1";
  const API_ENABLED_KEY = "jixels_api_enabled_v1";
  const SMS_OUTBOX_KEY = "jixels_sms_outbox_v1";
  const BRANCH_COUNT = 47;

  const $ = (selector, root = document) => root.querySelector(selector);

  const safeJsonParse = (raw, fallback) => {
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  };

  const loadJson = (key, fallback) => {
    const store = window.JixelsStore || null;
    if (store?.getJson) {
      const value = store.getJson(key, undefined);
      if (typeof value !== "undefined" && value !== null) return value;
    }
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return safeJsonParse(raw, fallback);
  };

  const apiEnabled = () => {
    try {
      return localStorage.getItem(API_ENABLED_KEY) === "1";
    } catch {
      return false;
    }
  };

  const apiPostKv = (key, value) => {
    if (!apiEnabled()) return;
    fetch("/api/kv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    }).catch(() => null);
  };

  const saveJson = (key, value) => {
    try {
      window.JixelsStore?.setJson?.(key, value);
    } catch {
      // fall back below
    }
    localStorage.setItem(key, JSON.stringify(value));
    try {
      apiPostKv(key, value);
    } catch {
      // ignore
    }
  };

  const bootstrapKeyFromApi = async (key) => {
    const store = window.JixelsStore || null;
    if (store?.bootstrap) {
      const res = await store.bootstrap([key]);
      return !!res?.ok;
    }
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

  const ensureERP = () => {
    const existing = loadJson(ERP_KEY, null);
    if (
      existing &&
      typeof existing === "object" &&
      Array.isArray(existing.branches) &&
      existing.branches.length === BRANCH_COUNT
    ) {
      let changed = false;
      for (const b of existing.branches) {
        if (!b || typeof b !== "object") continue;
        if (!Array.isArray(b.inventory)) {
          b.inventory = [];
          changed = true;
        }
        if (!Array.isArray(b.phones)) {
          b.phones = [];
          changed = true;
        }
        if (!Array.isArray(b.soldPhones)) {
          b.soldPhones = [];
          changed = true;
        }
        if (!Array.isArray(b.transactions)) {
          b.transactions = [];
          changed = true;
        }
        if (!Array.isArray(b.txLog)) {
          b.txLog = [];
          changed = true;
        }
        if (!Array.isArray(b.damageLoss)) {
          b.damageLoss = [];
          changed = true;
        }
        if (!b.financeSummary || typeof b.financeSummary !== "object") {
          b.financeSummary = { mpesaIn: 0, bankIn: 0, txCount: 0, lastTxAt: "" };
          changed = true;
        }
        if (!b.ledger || typeof b.ledger !== "object") {
          b.ledger = { head: "GENESIS" };
          changed = true;
        }
        if (!b.updatedAt) {
          b.updatedAt = isoNow();
          changed = true;
        }
      }
      if (changed) {
        existing.lastUpdated = isoNow();
        saveJson(ERP_KEY, existing);
      }
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

    const seeded = { version: 1, lastUpdated: isoNow(), branches, departments: {} };
    saveJson(ERP_KEY, seeded);
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

  const requireAgent = () => {
    const session = getSession();
    if (!session || session.role !== "agent" || !session.branchId) {
      window.location.href = "agent-login.html";
      return null;
    }
    return session;
  };

  const loadAgentAccounts = () => {
    const accounts = loadJson(AGENT_ACCOUNTS_KEY, []);
    return Array.isArray(accounts) ? accounts : [];
  };

  const getAgentAccount = (session) => {
    const accounts = loadAgentAccounts();
    return accounts.find((a) => a.id === session.userId) || null;
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

  const computeBranchTotals = (branch) => {
    const inventory = Array.isArray(branch.inventory) ? branch.inventory : [];
    let stock = 0;
    let sold = 0;
    let topModel = { model: "—", sold: -1 };
    for (const row of inventory) {
      const rowStock = Number(row.stock || 0);
      const rowSold = Number(row.sold || 0);
      stock += rowStock;
      sold += rowSold;
      if (rowSold > topModel.sold) topModel = { model: row.model, sold: rowSold };
    }
    return { stock, sold, topModel: topModel.model || "—" };
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

  const queueSms = (to, message) => {
    const entry = { at: isoNow(), to, message };
    try {
      const raw = localStorage.getItem(SMS_OUTBOX_KEY);
      const list = raw ? safeJsonParse(raw, []) : [];
      const arr = Array.isArray(list) ? list : [];
      arr.push(entry);
      localStorage.setItem(SMS_OUTBOX_KEY, JSON.stringify(arr.slice(-200)));
    } catch {
      // ignore
    }
    return entry;
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
    const branchName = String(branch?.name || tx?.branchId || "Branch");
    const title = "Transaction recorded";
    const body = `${branchName}: KES ${formatInt(amount)} via ${String(tx?.channel || "payment").toUpperCase()} (${tx?.ref || "no reference"})`;
    postJson("/api/onesignal/notify", {
      included_segments: ["Finance", "Sales", "Branches"],
      headings: { en: title },
      contents: { en: body },
      data: { type: "transaction", branchId: branch?.id || "", amountKes: amount, reference: tx?.ref || "" },
    }).catch(() => null);
  };

  const initAgentDashboard = () => {
    if (PAGE !== "agent-dashboard") return;

    const session = requireAgent();
    if (!session) return;

    let erp = ensureERP();
    const account = getAgentAccount(session);
    if (!account) {
      clearSession();
      window.location.href = "agent-login.html";
      return;
    }

    const badge = $("#agent-badge");
    const logoutBtn = $("#agent-logout-btn");
    const syncBtn = $("#agent-sync-btn");
    const indicator = $("#agent-indicator");

    const menuToggle = $("#menu-toggle");
    const menuClose = $("#menu-close");
    const sidebar = $("#agent-sidebar");
    const menuBackdrop = $("#menu-backdrop");

    const kpiStock = $("#a-kpi-stock");
    const kpiSold = $("#a-kpi-sold");
    const kpiTx = $("#a-kpi-tx");
    const kpiTop = $("#a-kpi-top");

    const serialInput = $("#tx-serial");
    const serialList = $("#serial-list");
    const customerPhone = $("#tx-customer-phone");
    const channelSel = $("#tx-channel");
    const saleTypeSel = $("#tx-sale-type");
    const refInput = $("#tx-ref");
    const amountInput = $("#tx-amount");
    const paidInput = $("#tx-paid");
    const creditDueInput = $("#tx-credit-due");
    const addBtn = $("#tx-add-btn");
    const exportBtn = $("#tx-export-btn");
    const helper = $("#tx-helper");
    const smsLine = $("#tx-sms");
    const creditSerial = $("#credit-serial");
    const creditChannel = $("#credit-channel");
    const creditAmount = $("#credit-amount");
    const creditRef = $("#credit-ref");
    const creditPayBtn = $("#credit-pay-btn");
    const creditHelper = $("#credit-helper");

    const txTbody = $("#tx-tbody");
    const invTbody = $("#inv-tbody");

    const getBranch = () => (erp.branches || []).find((b) => b.id === session.branchId) || null;

    const normalizeBranch = (branch) => {
      if (!branch) return null;
      if (!Array.isArray(branch.inventory)) branch.inventory = [];
      if (!Array.isArray(branch.phones)) branch.phones = [];
      if (!Array.isArray(branch.soldPhones)) branch.soldPhones = [];
      if (!Array.isArray(branch.txLog)) branch.txLog = [];
      if (!branch.financeSummary || typeof branch.financeSummary !== "object") {
        branch.financeSummary = { mpesaIn: 0, bankIn: 0, txCount: 0, lastTxAt: "" };
      }
      return branch;
    };

    const persist = () => {
      erp.lastUpdated = isoNow();
      saveJson(ERP_KEY, erp);
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

    const renderKPIs = () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;
      rebuildInventoryFromPhones(branch);
      const totals = computeBranchTotals(branch);
      if (kpiStock) kpiStock.textContent = formatInt(totals.stock);
      if (kpiSold) kpiSold.textContent = formatInt(totals.sold);
      if (kpiTop) kpiTop.textContent = totals.topModel;
      if (kpiTx) kpiTx.textContent = formatInt((branch.txLog || []).length);
      if (badge) badge.textContent = `${account.username || "Agent"} • ${branch.name || branch.id || ""}`.trim();
    };

    const renderInventory = () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;

      const phones = Array.isArray(branch.phones) ? branch.phones : [];
      if (serialList) {
        serialList.textContent = "";
        for (const p of phones.slice().sort((a, z) => String(a.serial || "").localeCompare(String(z.serial || "")))) {
          const opt = document.createElement("option");
          opt.value = String(p.serial || "");
          serialList.appendChild(opt);
        }
      }

      if (!invTbody) return;
      invTbody.textContent = "";
      for (const p of phones.slice().sort((a, z) => String(a.model || "").localeCompare(String(z.model || ""))).slice(0, 120)) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td></td><td></td><td></td><td></td><td class="num"></td>`;
        tr.children[0].textContent = p.serial || "—";
        tr.children[1].textContent = p.model || "—";
        tr.children[2].textContent = p.color || "—";
        tr.children[3].textContent = p.storage || "—";
        tr.children[4].textContent = formatInt(Number(p.price || 0) || 0);
        invTbody.appendChild(tr);
      }
    };

    const renderHistory = () => {
      if (!txTbody) return;
      const branch = normalizeBranch(getBranch());
      if (!branch) return;
      txTbody.textContent = "";

      const txLog = Array.isArray(branch.txLog) ? branch.txLog : [];
      const rows = txLog.slice().reverse().slice(0, 80);
      for (const tx of rows) {
        const saleType = String(tx.saleType || "cash").toLowerCase();
        const amount = Number(tx.amount || 0) || 0;
        const paid = saleType === "credit"
          ? Number(tx.creditPaidTotal ?? tx.amountPaid ?? tx.paidAmount ?? 0) || 0
          : Number(tx.amountPaid ?? tx.paidAmount ?? amount) || 0;
        const balance = Math.max(0, Number(tx.balance ?? (amount - paid)) || 0);
        const status =
          saleType === "credit_payment"
            ? `Credit payment • balance KES ${formatInt(balance)}`
            : saleType === "credit"
              ? balance > 0
                ? `Credit due${tx.creditDueDate ? ` ${tx.creditDueDate}` : ""}`
                : "Credit cleared"
              : "Completed";
        const tr = document.createElement("tr");
        tr.innerHTML = `<td></td><td></td><td></td><td></td><td></td><td></td><td class="num"></td><td class="num"></td><td class="num"></td><td></td>`;
        tr.children[0].textContent = tx.at ? new Date(tx.at).toLocaleString() : "—";
        tr.children[1].textContent = String(tx?.phone?.model ?? tx?.model ?? "—") || "—";
        tr.children[2].textContent = tx.serial || "—";
        tr.children[3].textContent = tx.customerPhone || "—";
        tr.children[4].textContent = String(tx.channel || "").toUpperCase() || "—";
        tr.children[5].textContent = tx.ref || "—";
        tr.children[6].textContent = formatInt(amount);
        tr.children[7].textContent = formatInt(paid);
        tr.children[8].textContent = formatInt(balance);
        tr.children[9].textContent = status;
        txTbody.appendChild(tr);
      }
    };

    const findOpenCreditSale = (branch, serialRaw) => {
      const serial = String(serialRaw || "").trim().toLowerCase();
      if (!serial) return null;
      const txLog = Array.isArray(branch?.txLog) ? branch.txLog : [];
      for (let i = txLog.length - 1; i >= 0; i -= 1) {
        const tx = txLog[i];
        if (String(tx?.saleType || "").toLowerCase() !== "credit") continue;
        if (String(tx.serial || "").toLowerCase() !== serial) continue;
        const amount = Number(tx.amount || 0) || 0;
        const paid = Number(tx.amountPaid ?? tx.paidAmount ?? 0) || 0;
        const balance = Math.max(0, Number(tx.balance ?? (amount - paid)) || 0);
        if (balance > 0) return { tx, index: i, balance };
      }
      return null;
    };

    const updateSoldCreditRecord = (branch, saleTx, paidNow, nextBalance, at, ref) => {
      branch.soldPhones = Array.isArray(branch.soldPhones) ? branch.soldPhones : [];
      const sold = branch.soldPhones.find((p) => String(p.serial || "").toLowerCase() === String(saleTx.serial || "").toLowerCase());
      if (!sold) return;
      sold.soldPaid = (Number(sold.soldPaid ?? sold.soldAmount ?? 0) || 0) + paidNow;
      sold.creditPaidTotal = sold.soldPaid;
      sold.creditBalance = nextBalance;
      sold.creditStatus = nextBalance > 0 ? "open" : "cleared";
      sold.lastCreditPaymentAt = at;
      sold.lastCreditPaymentRef = ref;
    };

    const recordCreditPayment = async () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;
      const serial = String(creditSerial?.value || "").trim();
      const channel = String(creditChannel?.value || "mpesa").toLowerCase();
      let ref = String(creditRef?.value || "").trim();
      const rawAmount = Number(creditAmount?.value || 0);
      if (!serial) {
        if (creditHelper) creditHelper.textContent = "Enter the sold phone serial for the open credit sale.";
        return creditSerial?.focus?.();
      }
      if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
        if (creditHelper) creditHelper.textContent = "Enter a valid payment amount.";
        return creditAmount?.focus?.();
      }

      const found = findOpenCreditSale(branch, serial);
      if (!found) {
        if (creditHelper) creditHelper.textContent = "No open credit sale found for this serial.";
        return creditSerial?.focus?.();
      }

      const saleTx = found.tx;
      const paidNow = Math.min(rawAmount, found.balance);
      const nextBalance = Math.max(0, found.balance - paidNow);
      const at = isoNow();
      if (!ref) {
        const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
        ref = `${channel.toUpperCase()}-${branch.id}-CREDIT-${stamp}`;
      }

      let mpesaResponse = null;
      if (channel === "mpesa" && paidNow > 0) {
        if (creditHelper) creditHelper.textContent = "Sending M-Pesa STK push for credit payment...";
        try {
          mpesaResponse = await requestMpesaStk({
            amount: paidNow,
            phoneNumber: saleTx.customerPhone,
            accountReference: ref,
            transactionDesc: `Jixels credit payment ${saleTx.serial || ""}`.trim(),
          });
        } catch (err) {
          if (creditHelper) creditHelper.textContent = String(err?.message || "M-Pesa STK push failed.");
          return;
        }
      }

      saleTx.creditPaidTotal = (Number(saleTx.creditPaidTotal ?? saleTx.amountPaid ?? saleTx.paidAmount ?? 0) || 0) + paidNow;
      saleTx.balance = nextBalance;
      saleTx.creditStatus = nextBalance > 0 ? "open" : "cleared";
      saleTx.creditPayments = Array.isArray(saleTx.creditPayments) ? saleTx.creditPayments : [];
      saleTx.creditPayments.push({ at, channel, ref, amount: paidNow, balanceAfter: nextBalance });

      const paymentTx = {
        at,
        channel,
        ref,
        amount: paidNow,
        amountPaid: paidNow,
        balance: nextBalance,
        saleType: "credit_payment",
        creditParentRef: saleTx.ref || "",
        creditDueDate: saleTx.creditDueDate || "",
        creditStatus: nextBalance > 0 ? "open" : "cleared",
        serial: saleTx.serial,
        customerPhone: saleTx.customerPhone,
        agent: { id: account.id, username: account.username },
        phone: saleTx.phone || null,
        mpesa: mpesaResponse?.response || null,
      };

      branch.txLog = Array.isArray(branch.txLog) ? branch.txLog : [];
      branch.txLog.push(paymentTx);
      branch.txLog = branch.txLog.slice(-400);
      if (!branch.financeSummary || typeof branch.financeSummary !== "object") {
        branch.financeSummary = { mpesaIn: 0, bankIn: 0, txCount: 0, lastTxAt: "" };
      }
      if (channel === "bank") branch.financeSummary.bankIn += paidNow;
      else branch.financeSummary.mpesaIn += paidNow;
      branch.financeSummary.txCount += 1;
      branch.financeSummary.lastTxAt = at;
      updateSoldCreditRecord(branch, saleTx, paidNow, nextBalance, at, ref);
      branch.updatedAt = at;
      persist();
      notifyTransaction(paymentTx, branch);
      queueSms(
        saleTx.customerPhone,
        nextBalance > 0
          ? `Jixels Technologies: Credit payment received KES ${formatInt(paidNow)} for serial ${saleTx.serial}. Balance KES ${formatInt(nextBalance)}. Ref: ${ref}.`
          : `Jixels Technologies: Credit cleared for serial ${saleTx.serial}. Last payment KES ${formatInt(paidNow)}. Ref: ${ref}. Thank you.`,
      );

      if (creditSerial) creditSerial.value = "";
      if (creditAmount) creditAmount.value = "";
      if (creditRef) creditRef.value = "";
      if (creditHelper) creditHelper.textContent = nextBalance > 0
        ? `Payment recorded. Remaining balance KES ${formatInt(nextBalance)}.`
        : "Payment recorded. Credit cleared.";
      renderKPIs();
      renderHistory();
    };

    const updateTxFromSerial = () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;
      const serial = String(serialInput?.value || "").trim();
      if (!serial) {
        if (helper) helper.textContent = "";
        if (amountInput) amountInput.value = "";
        return;
      }

      const phone =
        (branch.phones || []).find(
          (p) => String(p.serial || "").toLowerCase() === serial.toLowerCase(),
        ) || null;

      if (!phone) {
        if (helper) helper.textContent = "Serial not found in inventory.";
        if (amountInput) amountInput.value = "";
        return;
      }

      if (helper) {
        helper.textContent = `${phone.model || "Phone"} • ${phone.storage || ""} ${phone.color ? `• ${phone.color}` : ""} • KES ${formatInt(Number(phone.price || 0) || 0)}`.replaceAll("  ", " ").trim();
      }
      if (amountInput && !String(amountInput.value || "").trim()) {
        amountInput.value = String(Math.max(0, Number(phone.price || 0) || 0));
      }
      if (paidInput && !String(paidInput.value || "").trim()) {
        paidInput.value = String(Math.max(0, Number(phone.price || 0) || 0));
      }
    };

    const completeSale = async () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;

      const channel = String(channelSel?.value || "mpesa");
      const saleType = String(saleTypeSel?.value || "cash").toLowerCase() === "credit" ? "credit" : "cash";
      const serial = String(serialInput?.value || "").trim();
      const cust = String(customerPhone?.value || "").trim();
      let ref = String(refInput?.value || "").trim();

      if (!serial) return serialInput?.focus?.();
      if (!cust) return customerPhone?.focus?.();

      const phone =
        (branch.phones || []).find(
          (p) => String(p.serial || "").toLowerCase() === serial.toLowerCase(),
        ) || null;
      if (!phone) {
        if (helper) helper.textContent = "Serial not found in inventory.";
        return serialInput?.focus?.();
      }

      const amount = Math.max(0, Number(amountInput?.value || phone.price || 0));
      if (!Number.isFinite(amount) || amount <= 0) return amountInput?.focus?.();
      const paidRaw = saleType === "credit" ? Number(paidInput?.value || 0) : amount;
      const amountPaid = Math.max(0, Math.min(amount, Number.isFinite(paidRaw) ? paidRaw : 0));
      const balance = Math.max(0, amount - amountPaid);
      const creditDueDate = saleType === "credit" ? String(creditDueInput?.value || "").trim() : "";
      if (saleType === "credit" && balance <= 0) return paidInput?.focus?.();
      if (saleType === "credit" && !creditDueDate) return creditDueInput?.focus?.();

      if (!ref) {
        const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
        ref = `${channel.toUpperCase()}-${branch.id}-${stamp}`;
      }

      const at = isoNow();

      let mpesaResponse = null;
      if (channel === "mpesa" && amountPaid > 0) {
        if (smsLine) smsLine.textContent = "Sending M-Pesa STK push...";
        try {
          mpesaResponse = await requestMpesaStk({
            amount: amountPaid,
            phoneNumber: cust,
            accountReference: ref,
            transactionDesc: `Jixels ${phone.model || "phone"} sale`,
          });
        } catch (err) {
          if (smsLine) smsLine.textContent = String(err?.message || "M-Pesa STK push failed.");
          return;
        }
      }

      const txObj = {
        at,
        channel,
        ref,
        amount,
        amountPaid,
        creditPaidTotal: saleType === "credit" ? amountPaid : undefined,
        balance,
        saleType,
        creditDueDate,
        creditStatus: saleType === "credit" ? (balance > 0 ? "open" : "cleared") : "paid",
        serial: phone.serial,
        customerPhone: cust,
        agent: { id: account.id, username: account.username },
        phone: {
          model: phone.model,
          color: phone.color,
          storage: phone.storage,
          price: phone.price,
        },
        mpesa: mpesaResponse?.response || null,
      };

      branch.txLog = Array.isArray(branch.txLog) ? branch.txLog : [];
      branch.txLog.push(txObj);
      branch.txLog = branch.txLog.slice(-400);

      if (!branch.financeSummary || typeof branch.financeSummary !== "object") {
        branch.financeSummary = { mpesaIn: 0, bankIn: 0, txCount: 0, lastTxAt: "" };
      }
      if (channel === "bank") branch.financeSummary.bankIn += amountPaid;
      else branch.financeSummary.mpesaIn += amountPaid;
      branch.financeSummary.txCount += 1;
      branch.financeSummary.lastTxAt = at;

      const sold = {
        ...phone,
        status: "sold",
        soldAt: at,
        soldTo: cust,
        soldRef: ref,
        soldAmount: amount,
        soldPaid: amountPaid,
        creditPaidTotal: saleType === "credit" ? amountPaid : undefined,
        creditBalance: balance,
        saleType,
        creditDueDate,
        creditStatus: saleType === "credit" ? (balance > 0 ? "open" : "cleared") : "paid",
        soldChannel: channel,
        soldBy: account.username || "",
      };
      const pos = branch.phones.findIndex(
        (p) => String(p.serial || "").toLowerCase() === serial.toLowerCase(),
      );
      if (pos !== -1) branch.phones.splice(pos, 1);
      branch.soldPhones = Array.isArray(branch.soldPhones) ? branch.soldPhones : [];
      branch.soldPhones.push(sold);

      rebuildInventoryFromPhones(branch);
      branch.updatedAt = at;
      persist();
      notifyTransaction(txObj, branch);

      // UI cleanup
      if (refInput) refInput.value = "";
      if (amountInput) amountInput.value = "";
      if (paidInput) paidInput.value = "";
      if (creditDueInput) creditDueInput.value = "";
      if (serialInput) serialInput.value = "";
      if (customerPhone) customerPhone.value = "";
      if (helper) helper.textContent = "";

      const msg =
        saleType === "credit"
          ? `Credit sale recorded. Paid KES ${formatInt(amountPaid)}, balance KES ${formatInt(balance)}. Ref ${ref}.`
          : channel === "mpesa"
            ? `M-Pesa payment recorded. Ref ${ref}.`
            : `Bank payment recorded. Ref ${ref}.`;
      if (smsLine) smsLine.textContent = msg;

      queueSms(
        cust,
        saleType === "credit"
          ? `Jixels Technologies: Credit sale for ${sold.model} (${sold.storage}, ${sold.color}). Paid KES ${formatInt(amountPaid)}, balance KES ${formatInt(balance)}, due ${creditDueDate}. Serial: ${sold.serial}. Ref: ${ref}.`
          : `Jixels Technologies: Payment received KES ${formatInt(amount)} for ${sold.model} (${sold.storage}, ${sold.color}). Serial: ${sold.serial}. Ref: ${ref}. Thank you.`,
      );

      renderKPIs();
      renderInventory();
      renderHistory();
      updateTxFromSerial();
    };

    const exportCsv = () => {
      const branch = normalizeBranch(getBranch());
      if (!branch) return;
      const rows = [
        ["Date", "Channel", "Reference", "Serial", "CustomerPhone", "AmountKES", "PaidKES", "CreditPaidToDateKES", "BalanceKES", "SaleType", "CreditDueDate", "CreditStatus", "CreditParentRef", "Model", "Agent"],
      ];
      for (const tx of branch.txLog || []) {
        const modelRaw = tx?.phone?.model ?? tx?.model ?? "";
        const amount = Number(tx.amount || 0) || 0;
        const paid = Number(tx.amountPaid ?? tx.paidAmount ?? amount) || 0;
        const creditPaidTotal = Number(tx.creditPaidTotal ?? paid) || 0;
        const balance = Math.max(0, Number(tx.balance ?? (amount - paid)) || 0);
        rows.push([
          tx.at || "",
          tx.channel || "",
          tx.ref || "",
          tx.serial || "",
          tx.customerPhone || "",
          amount,
          paid,
          creditPaidTotal,
          balance,
          tx.saleType || "cash",
          tx.creditDueDate || "",
          tx.creditStatus || "",
          tx.creditParentRef || "",
          modelRaw || "",
          tx?.agent?.username || "",
        ]);
      }
      const csv = rows.map((r) => r.map(csvEscape).join(",")).join("\n");
      downloadText(
        `jixels-${branch.id}-sales-${new Date().toISOString().slice(0, 10)}.csv`,
        csv,
      );
    };

    const sync = () => {
      const saved = loadJson(ERP_KEY, null);
      if (saved && typeof saved === "object") erp = saved;
      renderKPIs();
      renderInventory();
      renderHistory();
      updateTxFromSerial();
      if (indicator) {
        indicator.textContent = "Live";
        indicator.classList.remove("offline");
      }
    };

    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        clearSession();
        window.location.href = "agent-login.html";
      });
    }

    if (syncBtn) syncBtn.addEventListener("click", () => sync());

    if (menuToggle) menuToggle.addEventListener("click", () => setMenuOpen(true));
    if (menuClose) menuClose.addEventListener("click", () => setMenuOpen(false));
    if (menuBackdrop) menuBackdrop.addEventListener("click", () => setMenuOpen(false));
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 980) setMenuOpen(false);
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

    if (serialInput) serialInput.addEventListener("input", () => updateTxFromSerial());
    if (addBtn) addBtn.addEventListener("click", () => completeSale());
    if (exportBtn) exportBtn.addEventListener("click", () => exportCsv());
    if (creditPayBtn) creditPayBtn.addEventListener("click", () => recordCreditPayment());

    sync();
    navigateTo(String(window.location.hash || "").replace("#", "") || "overview");

    const store = window.JixelsStore || null;
    if (store?.subscribe) {
      store.subscribe((ev) => {
        if (!ev || ev.type !== "set" || ev.key !== ERP_KEY) return;
        sync();
      });
    } else {
      window.addEventListener("storage", (e) => {
        if (e.key !== ERP_KEY) return;
        sync();
      });
    }
  };

  const main = async () => {
    await bootstrapKeyFromApi(ERP_KEY);
    initAgentDashboard();
  };

  main();
})();
