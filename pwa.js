(() => {
  "use strict";

  let deferredPrompt = null;
  let installed = false;
  const installButtons = new Set();
  const listeners = new Set();

  const isStandalone = () =>
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true ||
    installed;

  const setButtonState = (label, muted = false) => {
    installButtons.forEach((btn) => {
      btn.textContent = label;
      btn.classList.toggle("is-muted", !!muted);
    });
  };

  const hideButtonIfInstalled = () => {
    installButtons.forEach((button) => {
      button.disabled = isStandalone();
      if (isStandalone()) button.textContent = "App Installed";
    });
  };

  const status = () => ({
    installed: isStandalone(),
    promptReady: !!deferredPrompt,
    supported: "serviceWorker" in navigator,
  });

  const emitStatus = () => {
    const detail = status();
    listeners.forEach((listener) => {
      try {
        listener(detail);
      } catch {
        // ignore listener failures
      }
    });
    window.dispatchEvent(new CustomEvent("mapphex:pwa-status", { detail }));
  };

  const promptInstall = async () => {
    if (isStandalone()) {
      setButtonState("App Installed", true);
      window.setTimeout(hideButtonIfInstalled, 800);
      return { ok: true, installed: true };
    }

    if (!deferredPrompt) {
      setButtonState("Use Browser Menu", true);
      window.setTimeout(() => setButtonState("Install Selected as App", false), 2400);
      emitStatus();
      return { ok: false, reason: "prompt-unavailable" };
    }

    const promptEvent = deferredPrompt;
    deferredPrompt = null;
    setButtonState("Installing...", true);
    promptEvent.prompt();
    const choice = await promptEvent.userChoice.catch(() => null);
    if (choice?.outcome === "accepted") {
      installed = true;
      setButtonState("App Installed", true);
      window.setTimeout(hideButtonIfInstalled, 900);
      emitStatus();
      return { ok: true, installed: true };
    }
    setButtonState("Install Selected as App", false);
    emitStatus();
    return { ok: false, reason: "dismissed" };
  };

  const createPoweredFooter = () => {
    if (document.getElementById("site-powered-footer")) return;
    const footer = document.createElement("footer");
    footer.id = "site-powered-footer";
    footer.className = "site-powered-footer";
    footer.textContent = "Powered by © Teams Technology";
    document.body.appendChild(footer);
  };

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => null);
    });
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    setButtonState("Install Selected as App", false);
    hideButtonIfInstalled();
    emitStatus();
  });

  window.addEventListener("appinstalled", () => {
    installed = true;
    setButtonState("Installed", true);
    window.setTimeout(hideButtonIfInstalled, 900);
    emitStatus();
  });

  window.addEventListener("DOMContentLoaded", () => {
    createPoweredFooter();
    document.querySelectorAll("[data-pwa-install]").forEach((button) => {
      installButtons.add(button);
      button.addEventListener("click", () => promptInstall());
    });
    setButtonState(isStandalone() ? "App Installed" : "Install Selected as App", isStandalone());
    emitStatus();
  });

  window.MapphexPWA = Object.freeze({
    promptInstall,
    isStandalone,
    status,
    onStatus(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      listener(status());
      return () => listeners.delete(listener);
    },
  });
})();
