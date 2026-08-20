// Service worker.
//
// Estratégia: cache primeiro para o que é o app, rede nunca para os dados —
// porque não existem dados na rede. Tudo que este arquivo guarda é o próprio
// programa. O cofre vive no IndexedDB e o service worker nem o enxerga.
//
// Trocar CACHE ao publicar uma versão nova é o que faz o iPhone pegar a
// atualização: o navegador serve o cache antigo até alguém apagá-lo.

const CACHE = 'zero-v1';

const ARQUIVOS = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './icon.svg',
  './icon-maskable.svg',
  './src/config.js',
  './src/core/money.js',
  './src/core/dates.js',
  './src/core/statements.js',
  './src/core/installments.js',
  './src/core/projection.js',
  './src/core/debts.js',
  './src/core/budget.js',
  './src/core/categorize.js',
  './src/core/leaks.js',
  './src/core/health.js',
  './src/core/parse.js',
  './src/data/db.js',
  './src/data/crypto.js',
  './src/data/recovery.js',
  './src/data/migrations.js',
  './src/data/backup.js',
  './src/io/csv.js',
  './src/io/ofx.js',
  './src/io/ics.js',
  './src/seed/categories.js',
  './src/seed/seed.js',
  './src/ui/app.js',
  './src/ui/screens.js',
  './src/ui/actions.js',
  './src/ui/state.js',
  './src/ui/dom.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll falha inteiro se um arquivo faltar; guardamos um a um para que
      // um caminho errado não derrube a instalação toda.
      .then((c) => Promise.all(ARQUIVOS.map((a) => c.add(a).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // As fontes do Google entram no cache na primeira visita e depois o app abre
  // offline com a tipografia certa.
  const externa = url.origin !== location.origin;

  e.respondWith(
    caches.match(req).then((achado) => {
      if (achado) return achado;
      return fetch(req)
        .then((resposta) => {
          if (resposta.ok && (externa || url.origin === location.origin)) {
            const copia = resposta.clone();
            caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
          }
          return resposta;
        })
        .catch(() => caches.match('./index.html'));
    })
  );
});
