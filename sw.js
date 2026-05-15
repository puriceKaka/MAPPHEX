const CACHE_NAME = "enterprise-erp-v14";
const APP_SHELL = [
  "./",
  "./index.html",
  "./TeamLeader.html",
  "./teamleader-login.html",
  "./teamleader-register.html",
  "./organization-register.html",
  "./organization-login.html",
  "./organization-agreement.html",
  "./portal-selection.html",
  "./organization-workspace.html",
  "./organization-module.html",
  "./organization-admin.html",
  "./staff-portal.html",
  "./director.css",
  "./teamleader.css",
  "./departments.css",
  "./home.css",
  "./portal.css",
  "./management.css",
  "./onboarding.css",
  "./enterprise-platform.css",
  "./enterprise-core.js",
  "./enterprise-platform.js",
  "./kv-client.js",
  "./enterprise-store.js",
  "./pwa.js",
  "./home.js",
  "./organization-register.js",
  "./organization-login.js",
  "./organization-agreement.js",
  "./portal-selection.js",
  "./organization-workspace.js",
  "./organization-module.js",
  "./organization-admin.js",
  "./teamleader.js",
  "./teamleader-login.js",
  "./teamleader-register.js",
  "./ui-menu.js",
  "./images/enterprise-logo.png",
  "./images/enterprise-icon-192.png",
  "./images/enterprise-icon-512.png",
  "./images/bytewave-logo.jpg",
  "./images/bytewave-icon-192.png",
  "./images/bytewave-icon-512.png",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return;
  if (req.method !== "GET") return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => null);
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match("./index.html")))
  );
});
