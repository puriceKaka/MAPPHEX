(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const setMenuOpen = (open) => {
    document.body.classList.toggle("menu-open", !!open);
    const toggle = $("#menu-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", open ? "true" : "false");
  };

  window.addEventListener("DOMContentLoaded", () => {
    const toggle = $("#menu-toggle");
    const close = $("#menu-close");
    const backdrop = $("#menu-backdrop");

    if (toggle) toggle.addEventListener("click", () => setMenuOpen(true));
    if (close) close.addEventListener("click", () => setMenuOpen(false));
    if (backdrop) backdrop.addEventListener("click", () => setMenuOpen(false));

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    });
  });
})();

