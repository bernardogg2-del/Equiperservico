// Service worker do EquipER — existe apenas para o Chrome/Android tratar o site como Web App
// instalável. NÃO faz cache: toda requisição vai direto para a rede, então nunca serve uma
// versão antiga do app nem interfere no Firebase.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => { event.respondWith(fetch(event.request)); });
