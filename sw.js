const CACHE_NAME = 'subtracker-v2';
const SHELL_ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

// Network-first for our own shell files, falling back to cache only when
// offline — cache-first would keep serving a stale app.js/index.html forever
// once installed, since the browser has no reason to know the content
// changed. Everything else (Apps Script API calls, cross-origin requests)
// goes straight to the network untouched.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// --- Push notifications (Firebase Cloud Messaging) ---
// Must match CONFIG.FIREBASE_CONFIG in app.js exactly (both are public values).
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBgP_ljWRnhNfBx28itxW035p_0AC7o6rU',
  authDomain: 'subtracker-951e1.firebaseapp.com',
  projectId: 'subtracker-951e1',
  storageBucket: 'subtracker-951e1.firebasestorage.app',
  messagingSenderId: '205740684172',
  appId: '1:205740684172:web:0c82383f2a852040c99ca9',
};

if (FIREBASE_CONFIG.apiKey !== 'PASTE_YOUR_FIREBASE_API_KEY_HERE') {
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
  importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
  firebase.initializeApp(FIREBASE_CONFIG);
  const messaging = firebase.messaging();

  // Fires when a push arrives while the app isn't in the foreground — the
  // only case that matters for a reminder app. Foreground pushes are handled
  // by the Firebase SDK's default in-page behavior.
  messaging.onBackgroundMessage((payload) => {
    const notification = payload.notification || {};
    self.registration.showNotification(notification.title || 'SubTracker', {
      body: notification.body || '',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: 'subtracker-reminder',
    });
  });
}
