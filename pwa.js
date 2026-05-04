(() => {
  "use strict";

  let deferredPrompt = null;
  let installed = false;

  const isStandalone = () =>
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true ||
    installed;

  const injectStyles = () => {
    if (document.getElementById("pwa-install-style")) return;
    const style = document.createElement("style");
    style.id = "pwa-install-style";
    style.textContent = `
      .pwa-install-btn {
        position: fixed;
        left: 14px;
        bottom: 18px;
        z-index: 80;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-width: 132px;
        min-height: 44px;
        padding: 10px 14px;
        border-radius: 14px;
        border: 1px solid rgba(34, 211, 238, 0.48);
        background: linear-gradient(135deg, rgba(124, 58, 237, 0.94), rgba(34, 211, 238, 0.76));
        color: rgba(255, 255, 255, 0.96);
        font: 800 13px/1.1 ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
        box-shadow: 0 14px 34px rgba(0, 0, 0, 0.36);
        cursor: pointer;
        transition: transform 140ms ease, filter 140ms ease, opacity 140ms ease;
      }
      .pwa-install-btn:hover {
        transform: translateY(-1px);
        filter: brightness(1.05);
      }
      .pwa-install-btn:active {
        transform: translateY(0);
      }
      .pwa-install-btn[hidden] {
        display: none;
      }
      body:has(.pwa-install-btn:not([hidden])) {
        padding-bottom: calc(108px + env(safe-area-inset-bottom, 0px));
      }
      body.has-pwa-install {
        padding-bottom: calc(108px + env(safe-area-inset-bottom, 0px));
      }
      .pwa-install-btn.is-muted {
        background: rgba(10, 12, 22, 0.88);
        border-color: rgba(255, 255, 255, 0.18);
      }
      @media (max-width: 520px) {
        .pwa-install-btn {
          left: 10px;
          bottom: calc(56px + env(safe-area-inset-bottom, 0px));
          min-width: 118px;
          min-height: 40px;
          padding: 9px 12px;
        }
      }
    `;
    document.head.appendChild(style);
  };

  const getButton = () => document.getElementById("pwa-install-btn");

  const setButtonState = (label, muted = false) => {
    const btn = getButton();
    if (!btn) return;
    btn.textContent = label;
    btn.classList.toggle("is-muted", !!muted);
  };

  const hideButtonIfInstalled = () => {
    const btn = getButton();
    if (!btn) return;
    btn.hidden = isStandalone();
    document.body.classList.toggle("has-pwa-install", !btn.hidden);
  };

  const createInstallButton = () => {
    if (getButton()) return;
    injectStyles();
    const btn = document.createElement("button");
    btn.id = "pwa-install-btn";
    btn.className = "pwa-install-btn";
    btn.type = "button";
    btn.textContent = "Install App";
    btn.setAttribute("aria-label", "Install Jixels ERP app");
    btn.addEventListener("click", async () => {
      if (isStandalone()) {
        setButtonState("Installed", true);
        window.setTimeout(hideButtonIfInstalled, 800);
        return;
      }

      if (!deferredPrompt) {
        setButtonState("Open Menu", true);
        window.setTimeout(() => setButtonState("Install App", false), 2400);
        return;
      }

      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      setButtonState("Installing...", true);
      promptEvent.prompt();
      const choice = await promptEvent.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") {
        installed = true;
        setButtonState("Installed", true);
        window.setTimeout(hideButtonIfInstalled, 900);
      } else {
        setButtonState("Install App", false);
      }
    });
    document.body.appendChild(btn);
    document.body.classList.add("has-pwa-install");
    hideButtonIfInstalled();
  };

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => null);
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    createInstallButton();
    hideButtonIfInstalled();
  });

  window.addEventListener("appinstalled", () => {
    installed = true;
    setButtonState("Installed", true);
    window.setTimeout(hideButtonIfInstalled, 900);
  });

  window.addEventListener("DOMContentLoaded", () => {
    createInstallButton();
  });
})();
