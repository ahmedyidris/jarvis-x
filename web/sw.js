self.addEventListener('install', (event) => {
  console.log('Jarvis X Service Worker installed');
});

self.addEventListener('fetch', (event) => {
  // Simple pass-through for now
});
