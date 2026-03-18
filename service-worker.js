const CACHE_NAME = 'tap2track-exp-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './experimental.js',
  './manifest.webmanifest',
  './assets/ius-logo.png',
  './assets/drums/kick.wav',
  './assets/drums/snare.wav',
  './assets/drums/hat.wav',
  './assets/drums/perc.wav'
];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => null));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))));
});
self.addEventListener('fetch', (event) => {
  event.respondWith(caches.match(event.request).then((res) => res || fetch(event.request)));
});