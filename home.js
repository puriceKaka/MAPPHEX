(() => {
  "use strict";

  document.body?.classList.add("js-ready");

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const nav = document.querySelector("[data-nav]");
  const navToggle = document.querySelector("[data-nav-toggle]");
  const navLinks = [...document.querySelectorAll("[data-nav-menu] a")];
  const sectionIds = navLinks.map((link) => link.getAttribute("href")).filter((href) => href?.startsWith("#"));
  const sections = sectionIds.map((id) => document.querySelector(id)).filter(Boolean);

  const setNavOpen = (open) => {
    if (!nav || !navToggle) return;
    nav.classList.toggle("nav-open", open);
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  };

  const formatNumber = (value) => {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K`;
    }
    return String(value);
  };

  const animateCounter = (element) => {
    const target = Number(element.dataset.count || 0);
    if (!target || element.dataset.done === "true") return;
    element.dataset.done = "true";

    if (prefersReducedMotion) {
      element.textContent = formatNumber(target);
      return;
    }

    const startedAt = performance.now();
    const duration = 1100;

    const tick = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      element.textContent = formatNumber(Math.round(target * eased));
      if (progress < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  };

  const revealNow = (element) => {
    element.classList.add("is-visible");
  };

  const clearSession = () => {
    window.EnterpriseCore?.clearSession?.();
  };

  const redirectActiveOrganization = async () => {
    const params = new URLSearchParams(location.search);
    if (params.get("logout") === "1") {
      clearSession();
      history.replaceState(null, "", location.pathname);
      return;
    }

    const session = window.EnterpriseCore?.getSession?.();
    if (!session?.tenantId || !["org_admin", "admin", "manager", "staff"].includes(String(session.role || "").toLowerCase())) return;

    try {
      window.EnterpriseCore?.setTenant?.(session.tenantId);
      const res = await fetch("/api/org-admin", { method: "GET" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) return;
      const tenant = encodeURIComponent(session.tenantId);
      const settings = data.settings || {};
      if (settings.agreementAccepted !== true) {
        location.replace(`organization-agreement.html?tenant=${tenant}`);
      } else if (Array.isArray(settings.installedPortals) && settings.installedPortals.length) {
        location.replace(`organization-workspace.html?tenant=${tenant}`);
      } else {
        location.replace(`portal-selection.html?tenant=${tenant}`);
      }
    } catch {
      // Keep the public homepage available when offline or unauthenticated.
    }
  };

  const setActiveLink = (id) => {
    navLinks.forEach((link) => {
      const active = link.getAttribute("href") === id;
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });
  };

  document.addEventListener("DOMContentLoaded", () => {
    redirectActiveOrganization();

    navToggle?.addEventListener("click", () => {
      setNavOpen(!nav?.classList.contains("nav-open"));
    });

    navLinks.forEach((link) => {
      link.addEventListener("click", (event) => {
        const id = link.getAttribute("href");
        const target = id?.startsWith("#") ? document.querySelector(id) : null;
        if (!target) return;
        event.preventDefault();
        setActiveLink(id);
        setNavOpen(false);
        target.classList.add("section-focus");
        target.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
        history.replaceState(null, "", id);
        setTimeout(() => target.classList.remove("section-focus"), 650);
      });
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") setNavOpen(false);
    });

    const reveals = [...document.querySelectorAll(".reveal")];
    const counters = [...document.querySelectorAll(".count-up")];

    if (!("IntersectionObserver" in window) || prefersReducedMotion) {
      reveals.forEach(revealNow);
      counters.forEach(animateCounter);
      return;
    }

    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          revealNow(entry.target);
          revealObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.16 },
    );

    const counterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          animateCounter(entry.target);
          counterObserver.unobserve(entry.target);
        });
      },
      { threshold: 0.5 },
    );

    reveals.forEach((item) => revealObserver.observe(item));
    counters.forEach((item) => counterObserver.observe(item));

    const activeObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.id) setActiveLink(`#${visible.target.id}`);
      },
      { rootMargin: "-28% 0px -58% 0px", threshold: [0.18, 0.32, 0.5] },
    );
    sections.forEach((section) => activeObserver.observe(section));
  });
})();
