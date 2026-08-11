// Minimal service worker — enables "Add to Home Screen" installability.
// Deliberately does NOT cache API responses (stock data must always be
// fresh); it only lets the app shell install as a PWA.
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => self.clients.claim());
self.addEventListener("fetch", () => {}); // no-op: always go to network
